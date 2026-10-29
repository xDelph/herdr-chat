//! L'assemblage : brancher les cinq ports sur les `Services` du routeur.
//!
//! ⚠️ **Trois adaptateurs de plus, et ils sont honnêtes sur leurs limites.**
//! - `ResoutSessionsViaPort` / `LitSessionsViaPort` : la résolution et la page
//!   passent par le `SessionPort` (le contenu vient du fichier ou de la base,
//!   jamais de Herdr). La lecture de liste ne garde que ce que le résumé
//!   consomme : rôle, texte, outil, réglages, horodatage.
//! - `TypesViaCatalogue` : la liste des types lançables vient de
//!   `integration.list`, comme le lancement.
//!
//! ⚠️ **Aucun substitut** : une page illisible devient une `ErreurDeLecture`
//! avec sa cause ; un type absent n'est pas inventé.

use application::commands::launch::ConstructeurArgs;
use application::conversations::{
    EntreeLu, ErreurDeLecture, GenreDeLigne, GenreTache, LitSessions, OutilAppele, RoleDeSession,
    StatutTache, TacheDeFond,
};
use application::git::{LanceurGitReel, LecteurBranches};
use application::noyau::{AgentObservation, PaneId, SessionRefKind};
use application::overview::{ResoutSessions, SourceDeSession};
use application::ports::{CatalogPort, SessionPort};
use application::refresh::SourceMaintenant;
use application::sessions_types::{
    ResolvedSource, SessionHint, SessionPageOutcome, SessionPageRequest, SourceKind,
};
use application::types_installes::{ErreurInventaire, InventaireTypes, TypeInstalle};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Le pont résolution : le `SessionPort` répond, l'application lit.
pub struct ResoutSessionsViaPort {
    pub port: Arc<dyn SessionPort>,
}

/// La résolution, **partagée** par les deux adaptateurs : `LitSessions` étend
/// `ResoutSessions`, et c'est SON `source_de` que la liste appelle — un stub
/// y rendait toutes les sessions « absentes » (trouvé en interrogeant le vrai
/// démon).
fn source_de_port(port: &dyn SessionPort, agent: &AgentObservation) -> Option<SourceDeSession> {
    let hint = SessionHint {
        agent: agent.agent.clone(),
        published: agent.session.clone(),
        title: agent.terminal_title.clone(),
        cwd: agent.cwd.clone(),
    };
    // ⚠️ Le port est un futur ; la lecture de liste est synchrone côté
    // application. On l'attend au premier poll (les adaptateurs sont
    // bloquants déguisés) — `Pending` serait un branchement cassé.
    let mut futur = port.resolve(hint);
    let issue = attend_session(&mut futur).ok().flatten()?;
    Some(SourceDeSession {
        kind: match issue.kind {
            SourceKind::File => SessionRefKind::Path,
            SourceKind::Sqlite => SessionRefKind::Id,
        },
        base: Some(issue.base),
        session_id: issue.session_id,
        cwd: None,
        parent: None,
    })
}

impl ResoutSessions for ResoutSessionsViaPort {
    fn source_de(&self, agent: &AgentObservation) -> Option<SourceDeSession> {
        source_de_port(self.port.as_ref(), agent)
    }
}

/// Le pont lecture : une fenêtre bornée, convertie en entrées de résumé.
pub struct LitSessionsViaPort {
    pub port: Arc<dyn SessionPort>,
    /// ⚠️ **Le cache de fenêtres, et pourquoi il est ici.**
    ///
    /// Le banc T065 a mesuré `GET /api/conversations` à p95 72 ms contre 5 ms
    /// pour la référence : le chemin Rust relisait et ré-analysait chaque
    /// session **à chaque requête**, pour chaque client. Le cache de résumés de
    /// D19 existait mais n'était pas branché sur la lecture.
    ///
    /// La clé est l'**identité mesurée** de la source (chemin, taille, mtime) :
    /// un fichier qui grandit change de signature, donc la fenêtre est relue —
    /// jamais de résumé périmé présenté comme frais.
    pub fenetres: Arc<Mutex<CacheFenetres>>,
    /// ⚠️ La **famille** de la source résolue, gardée sous la base :
    /// `SourceDeSession` du résumé ne la porte pas, et la lecture SQLite en a
    /// besoin (opencode ≠ devin). Sans elle, toutes les sessions SQLite
    /// échouaient — constaté sur le vrai démon.
    pub familles: Arc<Mutex<HashMap<String, application::noyau::AgentKind>>>,
    /// Les tâches de fond de Claude (sous-agents, commandes en fond) — le
    /// lecteur garde l'état incrémental de chaque session, borné.
    pub taches: Arc<sessions::agents::claude::taches::LecteurTaches>,
}

/// Le lecteur de tâches de fond, sur la racine des projets Claude de la
/// configuration — rien n'est lu hors d'elle.
#[must_use]
pub fn lecteur_de_taches(
    config: &crate::config::Config,
) -> Arc<sessions::agents::claude::taches::LecteurTaches> {
    Arc::new(sessions::agents::claude::taches::LecteurTaches::nouveau(
        config.session_roots.claude.clone(),
    ))
}

/// La fenêtre lue pour un résumé — bornée (le résumé n'a pas besoin de tout).
pub const FENETRE_RESUME_OCTETS: u32 = 64 * 1024;

/// La capacité du cache de fenêtres : la même borne que le cache de résumés
/// (D19), pour qu'un démon qui suit 256 sessions ne garde pas 257 fenêtres.
pub const CAPACITE_FENETRES: usize = 256;

/// La signature d'une source — ce qui rend une fenêtre encore valable.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Signature {
    pub octets: u64,
    pub mtime_ns: u128,
    /// Le journal WAL d'une base SQLite (`<base>-wal`), quand il existe.
    pub wal: Option<(u64, u128)>,
}

fn taille_et_mtime(chemin: &str) -> Option<(u64, u128)> {
    let metadonnees = std::fs::metadata(chemin).ok()?;
    let mtime_ns = metadonnees
        .modified()
        .ok()
        .and_then(|instant| instant.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duree| duree.as_nanos())
        .unwrap_or(0);
    Some((metadonnees.len(), mtime_ns))
}

/// Lit la signature d'un chemin ; une erreur n'est pas une panne (le fichier
/// peut disparaître entre deux requêtes) : l'absence de signature = pas de
/// cache, donc une lecture fraîche.
///
/// ⚠️ **Le WAL compte.** opencode et Devin écrivent leur base en mode WAL :
/// un nouveau message va d'abord dans `<base>-wal`, la base elle-même ne
/// bouge (ni taille ni mtime) qu'au checkpoint. Une signature sur la seule
/// base servait donc un résumé périmé tant que le checkpoint n'avait pas eu
/// lieu.
#[must_use]
pub fn signature_de(chemin: &str) -> Option<Signature> {
    let (octets, mtime_ns) = taille_et_mtime(chemin)?;
    Some(Signature {
        octets,
        mtime_ns,
        wal: taille_et_mtime(&format!("{chemin}-wal")),
    })
}

/// Le cache des fenêtres lues — borné, à éviction de la plus ancienne.
#[derive(Default)]
pub struct CacheFenetres {
    ordre: std::collections::VecDeque<String>,
    entrees: HashMap<String, (Signature, Vec<EntreeLu>)>,
}

impl CacheFenetres {
    /// La fenêtre en cache **si la signature est la même**.
    pub fn lit(&mut self, cle: &str, signature: Signature) -> Option<Vec<EntreeLu>> {
        let (connue, entrees) = self.entrees.get(cle)?;
        (*connue == signature).then(|| entrees.clone())
    }

    /// Pose une fenêtre ; la plus ancienne sort au-delà de la capacité.
    pub fn pose(&mut self, cle: &str, signature: Signature, entrees: Vec<EntreeLu>) {
        if !self.entrees.contains_key(cle) {
            self.ordre.push_back(cle.to_string());
            while self.ordre.len() > CAPACITE_FENETRES {
                if let Some(ancienne) = self.ordre.pop_front() {
                    self.entrees.remove(&ancienne);
                }
            }
        }
        self.entrees.insert(cle.to_string(), (signature, entrees));
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entrees.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entrees.is_empty()
    }
}

/// Le nombre de fenêtres plus anciennes qu'un résumé peut remonter (D19).
pub const FENETRES_REMONTEE: usize = 32;

/// Ce qui manque encore au résumé d'une fenêtre : la dernière demande, le
/// dernier mot de l'agent, le modèle en vigueur.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Manques {
    demande: bool,
    reponse: bool,
    modele: bool,
    /// Le message qui a ouvert le tour courant (son instant, `tourDebut`).
    ouverture: bool,
}

impl Manques {
    fn de(entrees: &[EntreeLu]) -> Self {
        Self {
            demande: !entrees.iter().any(est_demande),
            reponse: !entrees.iter().any(est_reponse),
            modele: !entrees.iter().any(declare_un_modele),
            ouverture: !entrees
                .iter()
                .any(application::conversations::ouvre_un_tour),
        }
    }

    fn aucun(self) -> bool {
        !self.demande && !self.reponse && !self.modele && !self.ouverture
    }
}

fn est_demande(entree: &EntreeLu) -> bool {
    entree.role == RoleDeSession::User && entree.texte.as_deref().is_some_and(|t| !t.is_empty())
}

fn est_reponse(entree: &EntreeLu) -> bool {
    entree.role == RoleDeSession::Assistant
        && (entree.texte.as_deref().is_some_and(|t| !t.is_empty()) || entree.outil.is_some())
}

fn declare_un_modele(entree: &EntreeLu) -> bool {
    entree.modele.is_some()
}

impl LitSessionsViaPort {
    /// ⚠️ **Remonter le fil, borné, pour ce que la fenêtre n'a pas.** Une
    /// session Claude réelle portait 94 % de comptabilité : 64 Kio ne
    /// contenaient aucune demande, et la ligne de liste n'avait ni dernière
    /// demande ni aperçu. On remonte au plus [`FENETRES_REMONTEE`] fenêtres et
    /// on ne garde, de chacune, que la plus récente entrée de chaque manque :
    /// le résumé reste petit en mémoire, et la plus récente vaut toujours.
    fn remonte(
        &self,
        demande: &SessionPageRequest,
        page: &application::sessions_types::SessionPage,
        entrees: &mut Vec<EntreeLu>,
    ) {
        let mut manques = Manques::de(entrees);
        let mut avant = page.previous_cursor.clone().filter(|_| page.has_more);
        let mut fenetres = 0;
        while !manques.aucun() && fenetres < FENETRES_REMONTEE {
            let Some(curseur) = avant.take() else { break };
            let mut ancienne = demande.clone();
            ancienne.cursor = None;
            ancienne.previous_cursor = Some(curseur);
            let mut futur = self.port.page(ancienne);
            let Ok(SessionPageOutcome::Page(plus)) = attend_session(&mut futur) else {
                break;
            };
            let lues: Vec<EntreeLu> = plus.entries.iter().map(entree_lue).collect();
            let mut retenues: Vec<EntreeLu> = Vec::new();
            for (manque, critere) in [
                (manques.demande, est_demande as fn(&EntreeLu) -> bool),
                (manques.reponse, est_reponse),
                (manques.modele, declare_un_modele),
                (manques.ouverture, application::conversations::ouvre_un_tour),
            ] {
                if manque && let Some(entree) = lues.iter().rev().find(|entree| critere(entree)) {
                    retenues.push(entree.clone());
                }
            }
            if !retenues.is_empty() {
                retenues.extend(std::mem::take(entrees));
                *entrees = retenues;
                manques = Manques::de(entrees);
            }
            avant = plus.previous_cursor.clone().filter(|_| plus.has_more);
            fenetres += 1;
        }
    }
}

impl ResoutSessions for LitSessionsViaPort {
    fn source_de(&self, agent: &AgentObservation) -> Option<SourceDeSession> {
        let source = source_de_port(self.port.as_ref(), agent)?;
        if let (Some(base), Some(famille)) = (source.base.as_ref(), agent.agent.as_ref()) {
            self.familles
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(base.clone(), famille.clone());
        }
        Some(source)
    }
}

impl LitSessionsViaPort {
    /// La session Claude d'une source — `None` pour toute autre famille (une
    /// capacité absente, jamais le profil d'un autre agent).
    fn session_claude(&self, source: &SourceDeSession) -> Option<String> {
        let base = source.base.as_ref()?;
        let famille = self
            .familles
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(base)
            .cloned()?;
        (famille.as_str() == sessions::agents::claude::ProfilClaude::genre()
            && source.kind == SessionRefKind::Path)
            .then(|| base.clone())
    }
}

fn maintenant_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duree| u64::try_from(duree.as_millis()).ok())
        .unwrap_or(0)
}

fn tache_de(tache: sessions::agents::claude::taches::Tache) -> TacheDeFond {
    use sessions::agents::claude::taches::{GenreTache as Genre, StatutTache as Statut};
    TacheDeFond {
        id: tache.id,
        genre: match tache.genre {
            Genre::Agent => GenreTache::Agent,
            Genre::Commande => GenreTache::Commande,
        },
        description: tache.description,
        type_agent: tache.type_agent,
        statut: match tache.statut {
            Statut::EnCours => StatutTache::EnCours,
            Statut::Terminee => StatutTache::Terminee,
            Statut::Echouee => StatutTache::Echouee,
            Statut::Arretee => StatutTache::Arretee,
            Statut::Inconnu => StatutTache::Inconnu,
        },
        debut: tache.debut_ms,
        fin: tache.fin_ms,
        derniere_activite: tache.derniere_activite_ms,
        resume: tache.resume,
        transcription: tache.transcription,
    }
}

impl LitSessions for LitSessionsViaPort {
    fn taches(&self, source: &SourceDeSession) -> Option<Result<Vec<TacheDeFond>, String>> {
        let base = self.session_claude(source)?;
        Some(
            self.taches
                .taches(std::path::Path::new(&base), maintenant_ms())
                .map(|taches| taches.into_iter().map(tache_de).collect()),
        )
    }

    fn transcription_de_tache(&self, source: &SourceDeSession, id: &str) -> Option<String> {
        let base = self.session_claude(source)?;
        self.taches
            .transcription(std::path::Path::new(&base), id)
            .map(|chemin| chemin.display().to_string())
    }

    fn fenetre(
        &self,
        _pane: &PaneId,
        source: &SourceDeSession,
    ) -> Result<Vec<EntreeLu>, ErreurDeLecture> {
        let Some(base) = source.base.as_ref() else {
            return Err(ErreurDeLecture {
                benin: true,
                cause: String::from("aucune base de session"),
            });
        };
        let demande = SessionPageRequest {
            source: ResolvedSource {
                kind: match source.kind {
                    SessionRefKind::Path => SourceKind::File,
                    SessionRefKind::Id => SourceKind::Sqlite,
                },
                base: base.clone(),
                session_id: source.session_id.clone(),
                family: self
                    .familles
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .get(base)
                    .cloned(),
            },
            cursor: None,
            previous_cursor: None,
            limit: FENETRE_RESUME_OCTETS,
        };
        // 1) Le cache : même chemin, même taille, même mtime ⇒ même fenêtre.
        let signature = signature_de(base);
        let cle = format!(
            "{base}|{}",
            source
                .session_id
                .as_ref()
                .map(application::noyau::SessionId::as_str)
                .unwrap_or("")
        );
        if let Some(signature) = signature
            && let Some(entrees) = self
                .fenetres
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .lit(&cle, signature)
        {
            return Ok(entrees);
        }
        let mut futur = self.port.page(demande.clone());
        let issue = attend_session(&mut futur).map_err(|cause| ErreurDeLecture {
            benin: false,
            cause: cause.message_sur(),
        })?;
        match issue {
            SessionPageOutcome::Page(page) | SessionPageOutcome::Vide(page) => {
                let mut entrees: Vec<EntreeLu> = page.entries.iter().map(entree_lue).collect();
                self.remonte(&demande, &page, &mut entrees);
                if let Some(signature) = signature {
                    self.fenetres
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .pose(&cle, signature, entrees.clone());
                }
                Ok(entrees)
            }
            SessionPageOutcome::Absente(_) => Err(ErreurDeLecture {
                benin: true,
                cause: String::from("session absente"),
            }),
            SessionPageOutcome::Invalide { detail } => Err(ErreurDeLecture {
                benin: false,
                cause: detail,
            }),
            SessionPageOutcome::Io { detail } => Err(ErreurDeLecture {
                benin: false,
                cause: detail,
            }),
        }
    }
}

/// Une ligne de session → ce que le résumé consomme.
///
/// ⚠️ **La forme pi est la forme commune** : `message.role`, `message.content`
/// (chaîne ou blocs `text`), les blocs `toolCall` d'un message d'assistant
/// pour un appel d'outil, et `timestamp`. Ce qui n'est pas reconnu reste
/// `Autre` avec son texte brut — on ne devine ni rôle ni contenu.
#[must_use]
pub fn entree_lue(entree: &application::sessions_types::SessionEntry) -> EntreeLu {
    let valeur: serde_json::Value =
        serde_json::from_str(&entree.raw).unwrap_or(serde_json::Value::Null);
    // ⚠️ **Seule une ligne `message` parle.** La comptabilité de Claude Code
    // (`api-request-blob`) porte AUSSI un `message.role: "user"` — la requête
    // envoyée à l'API, consignes et messages compris. Lue ici, elle pouvait
    // devenir la « dernière demande » de la liste. La PWA, elle, ne rend que
    // les lignes `message` : le résumé suit la même règle.
    let message = (entree.kind == "message")
        .then(|| valeur.get("message"))
        .flatten();
    let role = message
        .and_then(|m| m.get("role"))
        .and_then(serde_json::Value::as_str)
        .map(role_de);
    let genre = match entree.kind.as_str() {
        "message" => GenreDeLigne::Message,
        "model_change" => GenreDeLigne::ChangementModele,
        "thinking_level_change" => GenreDeLigne::ChangementPensee,
        _ => GenreDeLigne::Autre,
    };
    let texte = message
        .and_then(|m| m.get("content"))
        .and_then(texte_de_contenu);
    // ⚠️ **L'appel est sur l'assistant, pas sur le résultat.** `toolName`
    // n'existe que sur les lignes `toolResult` : un agent qui n'avait fait
    // QUE des appels d'outils avait un aperçu vide. On lit le premier bloc
    // `toolCall` du message (nom + indice), comme le fil TS.
    let outil = message
        .and_then(|m| m.get("content"))
        .and_then(serde_json::Value::as_array)
        .and_then(|blocs| blocs.iter().find_map(appel_d_outil))
        .or_else(|| {
            message
                .and_then(|m| m.get("toolName"))
                .and_then(serde_json::Value::as_str)
                .map(|nom| OutilAppele {
                    nom: nom.to_string(),
                    indice: None,
                })
        });
    let details = message.and_then(|m| m.get("details"));
    EntreeLu {
        role: role.unwrap_or(RoleDeSession::Autre),
        genre,
        texte,
        outil,
        // Un message déclare `message.model` ; une ligne de changement
        // (`model_change`) déclare `modelId` à la racine — les deux comptent.
        modele: message
            .and_then(|m| m.get("model"))
            .or_else(|| valeur.get("modelId"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        // ⚠️ `model_change` / `thinking_level_change` (pi, et codex traduit)
        // portent fournisseur et niveau À LA RACINE : lus seulement dans
        // `message`, la ligne codex perdait son fournisseur « openai ».
        fournisseur: message
            .and_then(|m| m.get("provider"))
            .or_else(|| valeur.get("provider"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        niveau_pensee: message
            .and_then(|m| m.get("thinkingLevel"))
            .or_else(|| valeur.get("thinkingLevel"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        horodatage: entree.timestamp.as_deref().and_then(horodatage_ms),
        en_cours_de_tour: details
            .and_then(|details| details.get("midTurn"))
            .and_then(serde_json::Value::as_bool)
            == Some(true),
    }
}

/// Un bloc `toolCall` → l'appel résumé : le nom, et l'indice lisible des
/// arguments (`title`, `cmd`, `command`, `path`, `code` — 80 caractères).
fn appel_d_outil(bloc: &serde_json::Value) -> Option<OutilAppele> {
    if bloc.get("type").and_then(serde_json::Value::as_str) != Some("toolCall") {
        return None;
    }
    let nom = bloc
        .get("name")
        .and_then(serde_json::Value::as_str)
        .filter(|nom| !nom.is_empty())?;
    let coupe = |texte: &str| texte.chars().take(80).collect::<String>();
    let indice = match bloc.get("arguments") {
        Some(serde_json::Value::String(texte)) => texte
            .split('\n')
            .next()
            .map(str::trim)
            .filter(|ligne| !ligne.is_empty())
            .map(coupe),
        Some(serde_json::Value::Object(arguments)) => ["title", "cmd", "command", "path", "code"]
            .iter()
            .find_map(|cle| {
                arguments
                    .get(*cle)
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|valeur| !valeur.is_empty())
            })
            .map(coupe),
        _ => None,
    };
    Some(OutilAppele {
        nom: nom.to_string(),
        indice,
    })
}

fn role_de(role: &str) -> RoleDeSession {
    match role {
        "user" => RoleDeSession::User,
        "assistant" => RoleDeSession::Assistant,
        "system" => RoleDeSession::System,
        "tool" => RoleDeSession::Outil,
        "custom" => RoleDeSession::Harnais,
        _ => RoleDeSession::Autre,
    }
}

/// Le texte d'un `content` : une chaîne, ou les blocs `text` concaténés.
fn texte_de_contenu(contenu: &serde_json::Value) -> Option<String> {
    if let Some(texte) = contenu.as_str() {
        return (!texte.is_empty()).then(|| texte.to_string());
    }
    let blocs = contenu.as_array()?;
    let texte: String = blocs
        .iter()
        .filter_map(|bloc| bloc.get("text").and_then(serde_json::Value::as_str))
        .collect::<Vec<&str>>()
        .join("");
    (!texte.is_empty()).then_some(texte)
}

/// Un horodatage ISO → millisecondes. Une forme illisible reste **absente**,
/// jamais remplacée par l'heure courante.
///
/// ⚠️ Une seule conversion de date dans le produit (`sessions::metadata`) : la
/// copie qui vivait ici oubliait le `- 1` du jour de l'année et datait chaque
/// conversation du **lendemain** (mesuré : +86 400 000 ms sur toutes les
/// lignes de la liste).
fn horodatage_ms(iso: &str) -> Option<u64> {
    sessions::metadata::iso_vers_ms(iso).and_then(|ms| u64::try_from(ms).ok())
}

/// Les racines de sessions du résolveur, depuis la configuration — **nommées**
/// des deux côtés : aucune position dans une liste ne décide d'une famille.
#[must_use]
pub fn racines_de_sessions(config: &crate::config::Config) -> sessions::resolver::Racines {
    sessions::resolver::Racines {
        pi_sessions: config.session_roots.pi.clone(),
        claude_projects: config.session_roots.claude.clone(),
        codex_home: config.codex_home.clone(),
        codex_sessions: config.session_roots.codex.clone(),
        devin_db: config.devin_db_path.clone(),
        opencode_db: config.opencode_db_path.clone(),
    }
}

/// La liste des types lançables, lue sur le port de catalogues.
pub struct TypesViaCatalogue {
    pub port: Arc<dyn CatalogPort>,
}

impl InventaireTypes for TypesViaCatalogue {
    fn installes(&self) -> Result<Vec<TypeInstalle>, ErreurInventaire> {
        let mut futur = self.port.installed();
        match attend(&mut futur) {
            Ok(types) => Ok(types
                .into_iter()
                .map(|type_installe| TypeInstalle {
                    commande: type_installe.kind.as_str().to_string(),
                    cible: type_installe.kind.as_str().to_string(),
                    installe: true,
                })
                .collect()),
            Err(cause) => Err(ErreurInventaire::Illisible {
                detail: cause.description(),
            }),
        }
    }
}

/// La validation des args : la fonction du catalogue, telle quelle.
#[must_use]
pub fn constructeur_d_args() -> Arc<ConstructeurArgs> {
    Arc::new(Box::new(
        |kind: &str, modele: Option<&str>, thinking: Option<&str>| {
            let issue = catalog::args::construit_args(kind, modele, thinking);
            match issue.erreur {
                Some(erreur) => Err(erreur),
                None => Ok(issue.args),
            }
        },
    ))
}

/// Le lecteur de branches — git, borné, injecté.
#[must_use]
pub fn lecteur_de_branches(maintenant: Arc<dyn SourceMaintenant>) -> LecteurBranches {
    LecteurBranches::nouveau(Box::new(LanceurGitReel), maintenant)
}

/// Attend un port : les adaptateurs sont bloquants déguisés (convention du
/// socle). `Pending` serait un branchement cassé — on le dit.
fn attend<T: Send>(
    futur: &mut application::ports::PortFuture<'_, T>,
) -> Result<T, application::noyau::PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => {
            panic!("un port bloquant répond au premier poll ; Pending est un branchement cassé")
        }
    }
}

/// Attend un port de SESSION : ses erreurs sont des `ErreurDomaine` typées
/// (400/403/404/409/422/502/503), pas des pannes de transport.
fn attend_session<T: Send>(
    futur: &mut application::ports::SessionFuture<'_, T>,
) -> Result<T, application::noyau::ErreurDomaine> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => {
            panic!("un port bloquant répond au premier poll ; Pending est un branchement cassé")
        }
    }
}

/// L'observation des sessions par le hub (`sessions::hub`) — l'adaptateur du
/// port `application::observation` : la garde est l'observation elle-même.
pub struct ObservateurViaHub {
    pub hub: sessions::hub::SessionHub,
}

impl application::observation::ObservateurDeSessions for ObservateurViaHub {
    fn observe(&self, source: &ResolvedSource) -> application::observation::ObservationDeSession {
        let observation = self.hub.observe(source);
        let revisions = observation.revisions.clone();
        let degradation = observation.degradation().map(str::to_string);
        application::observation::ObservationDeSession::nouvelle(
            revisions,
            degradation,
            observation,
        )
    }
}
