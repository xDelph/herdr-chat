//! Le client Herdr (T013) : les méthodes **réellement utilisées**, avec
//! leurs réponses vérifiées — le décodage amont vit ICI (wire), jamais dans
//! les DTO HTTP.
//!
//! ⚠️ Le discriminant de succès : `HerdrReply.result` est un **objet** au
//! fil (`Schema.Record`) — une réponse dont le result est `null`, une
//! chaîne ou un tableau n'est **pas une confirmation** (C05) : elle échoue
//! au contrat d'enveloppe et ne confirme jamais un prompt.

use crate::transport::{ErreurTransport, TransportUnix};
use crate::wire::{InfoAgent, LecturePane, ListeAgents, OngletCree, PhotoSession, Pong};
use serde_json::{Value, json};
use std::path::Path;

/// Une demande du client, telle que le fil l'attend — les orthographes
/// **exactes** (mesurées sur HerdrClient.ts) : `pane.send_text` attend
/// `pane_id` là où `agent.*` attend `target` ; les confondre échouerait sur
/// un « missing field ».
pub enum Demande {
    Ping,
    Photo,
    ListeAgents,
    FicheAgent {
        cible: String,
    },
    LectureEcran {
        cible: String,
        lignes: Option<u32>,
        source: SourceLecture,
    },
    Prompt {
        cible: String,
        texte: String,
    },
    TexteBrut {
        cible: String,
        texte: String,
    },
    Touches {
        cible: String,
        touches: Vec<String>,
    },
    Focus {
        cible: String,
    },
    CreationOnglet {
        dossier: Option<String>,
        focus: bool,
        libelle: Option<String>,
        workspace: Option<String>,
    },
    Lancement {
        genre: String,
        nom: Option<String>,
        pane: String,
        args: Vec<String>,
        delai_ms: u64,
    },
    FermetureOnglet {
        onglet: String,
    },
}

/// La source d'une lecture d'écran — `visible` lit l'écran courant **sans
/// lignes** (mesuré : la détection d'invite exige `visible`) ; `recent`
/// porte son nombre de lignes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SourceLecture {
    Recent,
    Visible,
}

impl SourceLecture {
    fn en_fil(self) -> &'static str {
        match self {
            SourceLecture::Recent => "recent",
            SourceLecture::Visible => "visible",
        }
    }
}

/// Le client : les méthodes mesurées, réponses vérifiées.
#[derive(Debug)]
pub struct ClientHerdr {
    transport: TransportUnix,
}

/// Le résultat vérifié d'une demande — le `result` amont (objet du fil).
pub type Resultat<T> = Result<T, ErreurTransport>;

impl ClientHerdr {
    pub fn connecte(chemin: &Path) -> Resultat<Self> {
        Ok(Self {
            transport: TransportUnix::connecte(chemin)?,
        })
    }

    /// Envoie la demande, exige un `result` **objet** (Record du fil) —
    /// un discriminant de succès non objet ne confirme rien (C05).
    fn demande_objet(&mut self, methode: &str, params: &Value) -> Resultat<Value> {
        let resultat = self.transport.appelle(methode, params)?;
        if resultat.is_object() {
            Ok(resultat)
        } else {
            Err(ErreurTransport::EnveloppeInvalide(format!(
                "non-object result ({methode}): {}",
                resultat
            )))
        }
    }

    pub fn ping(&mut self) -> Resultat<Pong> {
        let resultat = self.demande_objet("ping", &json!({}))?;
        serde_json::from_value(resultat)
            .map_err(|cause| ErreurTransport::EnveloppeInvalide(cause.to_string()))
    }

    /// La photo du monde.
    ///
    /// ⚠️ **Le `result` est une ENVELOPPE** : `{ type, snapshot }` (mesuré sur
    /// le socket réel). Décoder `result` directement cherchait `agents` au
    /// premier niveau et échouait — le fil lisait `payload["snapshot"]`.
    pub fn photo_session(&mut self) -> Resultat<PhotoSession> {
        let resultat = self.demande_objet("session.snapshot", &json!({}))?;
        let interieur = match resultat.get("snapshot") {
            Some(snapshot) if snapshot.is_object() => snapshot.clone(),
            // Une forme sans enveloppe reste lue telle quelle : on ne
            // l'invente pas, on la décode ou on la refuse.
            _ => resultat,
        };
        serde_json::from_value(interieur)
            .map_err(|cause| ErreurTransport::EnveloppeInvalide(cause.to_string()))
    }

    pub fn liste_agents(&mut self) -> Resultat<Vec<InfoAgent>> {
        let resultat = self.demande_objet("agent.list", &json!({}))?;
        let liste: ListeAgents = serde_json::from_value(resultat)
            .map_err(|cause| ErreurTransport::EnveloppeInvalide(cause.to_string()))?;
        Ok(liste.agents)
    }

    /// La fiche d'un agent — résultat **opaque** : le décodage ciblé (son
    /// type, son état) appartient à l'appelant (mesuré : decodeAgentStatus
    /// vit chez l'appelant).
    pub fn fiche_agent(&mut self, cible: &str) -> Resultat<Value> {
        self.demande_objet("agent.get", &json!({ "target": cible }))
    }

    /// Lit l'écran d'un agent — `strip_ansi: true` posé au fil (mesuré) ;
    /// `visible` n'envoie **pas** de `lines` (mesuré) ; une charge partielle
    /// (`read` absent ou texte absent) se lit **vide**, pas en panne.
    pub fn lecture_ecran(
        &mut self,
        cible: &str,
        lignes: Option<u32>,
        source: SourceLecture,
    ) -> Resultat<(String, bool)> {
        let mut params = json!({
            "target": cible,
            "source": source.en_fil(),
            "strip_ansi": true,
        });
        if source == SourceLecture::Recent {
            params["lines"] = json!(lignes.unwrap_or(200));
        }
        let resultat = self.demande_objet("agent.read", &params)?;
        let lecture: LecturePane = serde_json::from_value(resultat)
            .map_err(|cause| ErreurTransport::EnveloppeInvalide(cause.to_string()))?;
        Ok(match lecture.read {
            Some(Some(interieure)) => (
                interieure.text.unwrap_or_default(),
                interieure.truncated.unwrap_or(false),
            ),
            _ => (String::new(), false),
        })
    }

    /// Envoie un prompt — la confirmation est celle de l'enveloppe : un
    /// résultat **objet** corrélé (C05).
    pub fn prompt(&mut self, cible: &str, texte: &str) -> Resultat<Value> {
        self.demande_objet("agent.prompt", &json!({ "target": cible, "text": texte }))
    }

    /// `pane.send_text` attend `pane_id` — mesuré, l'autre nom échouerait
    /// sur « missing field `pane_id` ».
    pub fn texte_brut(&mut self, cible: &str, texte: &str) -> Resultat<Value> {
        self.demande_objet(
            "pane.send_text",
            &json!({ "pane_id": cible, "text": texte }),
        )
    }

    /// `agent.send_keys` attend `target` — le même client porte les deux
    /// orthographes, chacune à sa méthode.
    pub fn touches(&mut self, cible: &str, touches: &[String]) -> Resultat<Value> {
        self.demande_objet(
            "agent.send_keys",
            &json!({ "target": cible, "keys": touches }),
        )
    }

    pub fn focus(&mut self, cible: &str) -> Resultat<Value> {
        self.demande_objet("agent.focus", &json!({ "target": cible }))
    }

    /// `tab.create` — la réponse `{tab, root_pane}` est **vérifiée** : sans
    /// pane racine utilisable, c'est un échec de décodage nommé.
    pub fn creation_onglet(
        &mut self,
        dossier: Option<&str>,
        focus: bool,
        libelle: Option<&str>,
        workspace: Option<&str>,
    ) -> Resultat<OngletCree> {
        let resultat = self.demande_objet(
            "tab.create",
            &json!({
                "cwd": dossier,
                "focus": focus,
                "label": libelle,
                "workspace_id": workspace,
            }),
        )?;
        let cree: OngletCree = serde_json::from_value(resultat).map_err(|_| {
            ErreurTransport::EnveloppeInvalide(String::from(
                "`tab.create` without a usable root pane",
            ))
        })?;
        Ok(cree)
    }

    /// `agent.start` — le délai shell documenté (C07 : 120 s) est le défaut
    /// de la politique de lancement ; le client porte ce qu'on lui donne.
    pub fn lancement(
        &mut self,
        genre: &str,
        nom: Option<&str>,
        pane: &str,
        args: &[String],
        delai_ms: u64,
    ) -> Resultat<Value> {
        self.demande_objet(
            "agent.start",
            &json!({
                "kind": genre,
                "name": nom,
                "pane_id": pane,
                "args": args,
                "timeout_ms": delai_ms,
            }),
        )
    }

    pub fn fermeture_onglet(&mut self, onglet: &str) -> Resultat<Value> {
        self.demande_objet("tab.close", &json!({ "tab_id": onglet }))
    }

    /// `integration.list` — la SEULE source des types réellement installés
    /// (B07 : une liste écrite à la main proposait des agents inexistants).
    /// Le résultat est laissé **opaque** : le mappage en `TypeInstalle` vit
    /// dans l'adaptateur, où il est testé sur la forme mesurée.
    pub fn integrations(&mut self) -> Resultat<Value> {
        self.demande_objet("integration.list", &json!({}))
    }
}
