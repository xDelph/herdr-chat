//! Les **tâches de fond** d'une session Claude Code — sous-agents lancés en
//! arrière-plan et commandes `Bash` passées en fond.
//!
//! ⚠️ **Mesuré sur disque (2026-10-29, lecture seule).** Rien de cela n'est
//! dans Herdr ; tout est dans les fichiers de Claude Code :
//!
//! - `<projet>/<sessionId>/subagents/agent-<id>.meta.json` : `agentType`,
//!   `description`, `toolUseId`, `requestShape: "background"`, parfois
//!   `finished: true` ;
//! - `<projet>/<sessionId>/subagents/agent-<id>.jsonl` : la transcription
//!   complète du sous-agent (même format, `isSidechain: true`) ;
//! - le lancement, dans la session parente : un `tool_result` dont
//!   `toolUseResult` porte `agentId` + `isAsync` (outil Agent) ou
//!   `backgroundTaskId` (Bash) — textes « Async agent launched successfully »,
//!   « Command running in background with ID: », « moved to the background
//!   (ID: …) » ;
//! - la fin : `<task-notification>` (ligne `user` ou `queued_command`
//!   `task-notification`), avec `<task-id>` et `<status>`.
//!
//! ⚠️ **Ne pas exposer un état invérifiable.** Sans fin écrite ni activité
//! récente (30 min), une tâche est `inconnu` — jamais « en cours » par défaut.
//!
//! ⚠️ **Lecture incrémentale.** Une session réelle pèse 16 Mo : la session
//! parente est lue une fois, puis seulement ce qui s'y ajoute (identité
//! dev/ino + position, comme les curseurs) ; un fichier remplacé ou tronqué
//! est relu depuis le début.

use super::harnais::notification_de;
use crate::path_policy::{VerdictChemin, resolu_sous};
use crate::storage::jsonl::identity::identite_de;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// Le silence au-delà duquel une tâche sans fin écrite devient `inconnu`.
pub const SILENCE_INCONNU_MS: u64 = 30 * 60 * 1000;

/// L'écart toléré entre la notification et les dernières écritures de la
/// transcription : au-delà, le sous-agent a été RELANCÉ après sa fin.
const REPRISE_APRES_FIN_MS: u64 = 60 * 1000;

/// Les appels `Bash` gardés en attente de leur résultat (borne mémoire).
const APPELS_EN_ATTENTE: usize = 512;

/// Les sessions dont l'état de lecture est gardé (borne mémoire).
const SESSIONS_GARDEES: usize = 128;

/// La sorte d'une tâche.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum GenreTache {
    Agent,
    Commande,
}

/// L'état d'une tâche — `Inconnu` quand rien ne le prouve.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum StatutTache {
    EnCours,
    Terminee,
    Echouee,
    Arretee,
    Inconnu,
}

impl StatutTache {
    /// Le statut écrit par le harnais (`<status>`) — une valeur inconnue
    /// reste `Inconnu` (la tâche est finie, son issue ne se lit pas).
    #[must_use]
    pub fn du_harnais(statut: Option<&str>) -> Self {
        match statut {
            Some("completed") => Self::Terminee,
            Some("failed") => Self::Echouee,
            Some("killed" | "stopped" | "cancelled" | "canceled") => Self::Arretee,
            _ => Self::Inconnu,
        }
    }
}

/// Une tâche de fond, telle que les fichiers la prouvent.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Tache {
    pub id: String,
    pub genre: GenreTache,
    pub description: Option<String>,
    /// Le type de sous-agent (`general-purpose`, `fork`…) ; absent pour une
    /// commande.
    pub type_agent: Option<String>,
    pub statut: StatutTache,
    pub debut_ms: Option<u64>,
    pub fin_ms: Option<u64>,
    pub derniere_activite_ms: Option<u64>,
    /// Le résumé écrit par le harnais à la fin (`<summary>`).
    pub resume: Option<String>,
    /// `true` quand la transcription du sous-agent est lisible.
    pub transcription: bool,
}

/// Un lancement relevé dans la session parente.
#[derive(Clone, PartialEq, Eq, Debug)]
struct Lancement {
    genre: GenreTache,
    description: Option<String>,
    debut_ms: Option<u64>,
}

/// Une fin relevée dans la session parente (la plus récente gagne).
#[derive(Clone, PartialEq, Eq, Debug)]
struct Fin {
    statut: Option<String>,
    resume: Option<String>,
    description: Option<String>,
    genre: Option<GenreTache>,
    a_ms: Option<u64>,
}

/// L'état de lecture d'une session parente.
#[derive(Default)]
struct EtatSession {
    dev: u64,
    ino: u64,
    position: u64,
    lancements: HashMap<String, Lancement>,
    ordre: Vec<String>,
    fins: HashMap<String, Fin>,
    appels_bash: HashMap<String, String>,
    appels_ordre: VecDeque<String>,
}

/// Le lecteur des tâches de fond — garde l'état incrémental de chaque
/// session lue, borné.
pub struct LecteurTaches {
    racine: PathBuf,
    etats: Mutex<(VecDeque<PathBuf>, HashMap<PathBuf, EtatSession>)>,
}

impl LecteurTaches {
    /// `racine` : le dossier des projets Claude (`~/.claude/projects`) —
    /// rien n'est lu hors de lui.
    #[must_use]
    pub fn nouveau(racine: PathBuf) -> Self {
        Self {
            racine,
            etats: Mutex::new((VecDeque::new(), HashMap::new())),
        }
    }

    fn garde(&self, chemin: &Path) -> Result<PathBuf, String> {
        match resolu_sous(std::slice::from_ref(&self.racine), chemin) {
            VerdictChemin::Autorise { resolu } => Ok(resolu),
            VerdictChemin::Refuse { raison } => {
                Err(format!("{} : {}", raison.message(), chemin.display()))
            }
        }
    }

    /// Les tâches de fond de la session `session` (le JSONL parent),
    /// évaluées à l'instant `maintenant_ms`.
    ///
    /// # Errors
    /// Le chemin sort de la racine, ou la session est illisible — la cause
    /// est nommée, jamais une liste vide déguisée.
    pub fn taches(&self, session: &Path, maintenant_ms: u64) -> Result<Vec<Tache>, String> {
        let session = self.garde(session)?;
        let (lancements, ordre, fins) = self.lit_session(&session)?;
        let mut taches: Vec<Tache> = Vec::new();
        let mut vus: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 1) Les sous-agents de fond : leurs méta-données sur disque.
        for meta in self.metas_de(&session) {
            vus.insert(meta.id.clone());
            let lancement = lancements.get(&meta.id);
            let fin = fins.get(&meta.id);
            let derniere = meta.mtime_transcription_ms;
            let debut = lancement
                .and_then(|lancement| lancement.debut_ms)
                .or(meta.debut_ms);
            let (statut, fin_ms) = statut_agent(fin, meta.finie, derniere, maintenant_ms);
            taches.push(Tache {
                id: meta.id.clone(),
                genre: GenreTache::Agent,
                description: meta
                    .description
                    .clone()
                    .or_else(|| lancement.and_then(|lancement| lancement.description.clone()))
                    .or_else(|| fin.and_then(|fin| fin.description.clone())),
                type_agent: meta.type_agent.clone(),
                statut,
                debut_ms: debut,
                fin_ms,
                derniere_activite_ms: derniere,
                resume: fin.and_then(|fin| fin.resume.clone()),
                transcription: meta.transcription,
            });
        }

        // 2) Les lancements de la session sans méta-données : commandes, et
        //    sous-agents dont le fichier manque.
        for id in &ordre {
            if vus.contains(id) {
                continue;
            }
            let Some(lancement) = lancements.get(id) else {
                continue;
            };
            vus.insert(id.clone());
            let fin = fins.get(id);
            let (statut, fin_ms) = match fin {
                Some(fin) => (StatutTache::du_harnais(fin.statut.as_deref()), fin.a_ms),
                None => (silence(lancement.debut_ms, maintenant_ms), None),
            };
            taches.push(Tache {
                id: id.clone(),
                genre: lancement.genre,
                description: lancement
                    .description
                    .clone()
                    .or_else(|| fin.and_then(|fin| fin.description.clone())),
                type_agent: None,
                statut,
                debut_ms: lancement.debut_ms,
                fin_ms,
                derniere_activite_ms: lancement.debut_ms,
                resume: fin.and_then(|fin| fin.resume.clone()),
                transcription: false,
            });
        }

        // En cours d'abord, puis la plus récente.
        taches.sort_by(|a, b| {
            let rang = |tache: &Tache| u8::from(tache.statut != StatutTache::EnCours);
            rang(a)
                .cmp(&rang(b))
                .then_with(|| b.debut_ms.cmp(&a.debut_ms))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(taches)
    }

    /// Le chemin de la transcription d'un sous-agent — `None` pour un
    /// identifiant qui n'en est pas un (rien d'autre que `[A-Za-z0-9_-]`),
    /// un fichier absent ou hors racine.
    #[must_use]
    pub fn transcription(&self, session: &Path, id: &str) -> Option<PathBuf> {
        let chemin = chemin_transcription(session, id)?;
        self.garde(&chemin).ok()
    }

    /// Lit ce qui s'est ajouté à la session depuis la dernière fois.
    #[allow(clippy::type_complexity)]
    fn lit_session(
        &self,
        session: &Path,
    ) -> Result<
        (
            HashMap<String, Lancement>,
            Vec<String>,
            HashMap<String, Fin>,
        ),
        String,
    > {
        let identite = identite_de(session).map_err(|cause| format!("{cause}"))?;
        let mut garde = self.etats.lock().unwrap_or_else(PoisonError::into_inner);
        let (ordre_sessions, etats) = &mut *garde;
        let cle = session.to_path_buf();
        if !etats.contains_key(&cle) {
            ordre_sessions.push_back(cle.clone());
            while ordre_sessions.len() > SESSIONS_GARDEES {
                if let Some(ancienne) = ordre_sessions.pop_front() {
                    etats.remove(&ancienne);
                }
            }
        }
        let etat = etats.entry(cle).or_default();
        let remplace = etat.dev != identite.curseur.dev
            || etat.ino != identite.curseur.ino
            || etat.position > identite.taille;
        if remplace {
            *etat = EtatSession {
                dev: identite.curseur.dev,
                ino: identite.curseur.ino,
                ..EtatSession::default()
            };
        }
        if etat.position < identite.taille {
            let mut fichier = std::fs::File::open(session).map_err(|cause| format!("{cause}"))?;
            fichier
                .seek(SeekFrom::Start(etat.position))
                .map_err(|cause| format!("{cause}"))?;
            // Lecture EN FLUX, ligne à ligne : une session réelle pèse plus
            // de 100 Mo, jamais chargée d'un bloc en mémoire.
            let mut lecteur =
                std::io::BufReader::new(fichier.take(identite.taille - etat.position));
            let mut ligne = Vec::new();
            loop {
                ligne.clear();
                let lus = lecteur
                    .read_until(b'\n', &mut ligne)
                    .map_err(|cause| format!("{cause}"))?;
                // Seules les lignes COMPLÈTES avancent la position : une ligne
                // en cours d'écriture sera relue entière la fois suivante.
                if lus == 0 || ligne.last() != Some(&b'\n') {
                    break;
                }
                if let Ok(texte) = std::str::from_utf8(&ligne) {
                    etat.lit_ligne(texte);
                }
                etat.position += lus as u64;
            }
        }
        Ok((
            etat.lancements.clone(),
            etat.ordre.clone(),
            etat.fins.clone(),
        ))
    }

    /// Les sous-agents de fond déclarés sur disque.
    fn metas_de(&self, session: &Path) -> Vec<MetaAgent> {
        let Some(dossier) = dossier_sous_agents(session) else {
            return Vec::new();
        };
        let Ok(dossier) = self.garde(&dossier) else {
            return Vec::new();
        };
        let Ok(lecture) = std::fs::read_dir(&dossier) else {
            return Vec::new();
        };
        let mut metas: Vec<MetaAgent> = lecture
            .filter_map(Result::ok)
            .filter_map(|entree| {
                let nom = entree.file_name().to_string_lossy().to_string();
                let id = nom.strip_prefix("agent-")?.strip_suffix(".meta.json")?;
                id_valide(id).then(|| meta_agent(&dossier, id))?
            })
            .collect();
        metas.sort_by(|a, b| a.id.cmp(&b.id));
        metas
    }
}

/// Le dossier `subagents` d'une session (`<id>.jsonl` → `<id>/subagents`).
#[must_use]
pub fn dossier_sous_agents(session: &Path) -> Option<PathBuf> {
    let parent = session.parent()?;
    let souche = session.file_stem()?;
    Some(parent.join(souche).join("subagents"))
}

/// Le chemin de la transcription d'un sous-agent — sans garde de racine
/// (l'appelant la pose) ; `None` pour un identifiant invalide.
#[must_use]
pub fn chemin_transcription(session: &Path, id: &str) -> Option<PathBuf> {
    if !id_valide(id) {
        return None;
    }
    Some(dossier_sous_agents(session)?.join(format!("agent-{id}.jsonl")))
}

/// Un identifiant de tâche : `[A-Za-z0-9_-]`, 1 à 64 caractères — jamais un
/// morceau de chemin.
#[must_use]
pub fn id_valide(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|octet| octet.is_ascii_alphanumeric() || octet == b'-' || octet == b'_')
}

/// Le statut d'un sous-agent : la fin écrite, sauf reprise ; sinon le
/// drapeau `finished` ; sinon l'activité récente — sinon `inconnu`.
fn statut_agent(
    fin: Option<&Fin>,
    finie: bool,
    derniere: Option<u64>,
    maintenant_ms: u64,
) -> (StatutTache, Option<u64>) {
    if let Some(fin) = fin {
        let reprise = matches!(
            (fin.a_ms, derniere),
            (Some(a), Some(derniere)) if derniere > a.saturating_add(REPRISE_APRES_FIN_MS)
        );
        if !reprise {
            return (StatutTache::du_harnais(fin.statut.as_deref()), fin.a_ms);
        }
        return (silence(derniere, maintenant_ms), None);
    }
    if finie {
        return (StatutTache::Terminee, derniere);
    }
    (silence(derniere, maintenant_ms), None)
}

/// Sans fin écrite : `en cours` si une activité date de moins de 30 min,
/// `inconnu` sinon (ou sans aucune date).
fn silence(derniere: Option<u64>, maintenant_ms: u64) -> StatutTache {
    match derniere {
        Some(derniere) if maintenant_ms.saturating_sub(derniere) <= SILENCE_INCONNU_MS => {
            StatutTache::EnCours
        }
        _ => StatutTache::Inconnu,
    }
}

/// Ce qu'un `agent-<id>.meta.json` déclare, et ce que sa transcription
/// prouve (dates).
struct MetaAgent {
    id: String,
    description: Option<String>,
    type_agent: Option<String>,
    finie: bool,
    debut_ms: Option<u64>,
    mtime_transcription_ms: Option<u64>,
    transcription: bool,
}

fn meta_agent(dossier: &Path, id: &str) -> Option<MetaAgent> {
    let texte = std::fs::read_to_string(dossier.join(format!("agent-{id}.meta.json"))).ok()?;
    let meta: Value = serde_json::from_str(&texte).ok()?;
    // Un sous-agent au premier plan n'est pas une tâche de fond.
    if meta.get("requestShape").and_then(Value::as_str) != Some("background") {
        return None;
    }
    let texte_de = |clef: &str| {
        meta.get(clef)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|valeur| !valeur.is_empty())
            .map(str::to_string)
    };
    let transcription = dossier.join(format!("agent-{id}.jsonl"));
    let mtime = std::fs::metadata(&transcription)
        .ok()
        .and_then(|metadonnees| metadonnees.modified().ok())
        .and_then(|instant| instant.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|duree| u64::try_from(duree.as_millis()).ok());
    Some(MetaAgent {
        id: id.to_string(),
        description: texte_de("description"),
        type_agent: texte_de("agentType"),
        finie: meta.get("finished").and_then(Value::as_bool) == Some(true),
        debut_ms: premier_horodatage(&transcription),
        mtime_transcription_ms: mtime,
        transcription: mtime.is_some(),
    })
}

/// L'horodatage de la première ligne datée de la transcription (lecture
/// bornée aux premiers 64 Kio).
fn premier_horodatage(chemin: &Path) -> Option<u64> {
    let fichier = std::fs::File::open(chemin).ok()?;
    let mut debut = Vec::new();
    fichier.take(64 * 1024).read_to_end(&mut debut).ok()?;
    debut
        .split(|octet| *octet == b'\n')
        .filter_map(|ligne| serde_json::from_slice::<Value>(ligne).ok())
        .find_map(|ligne| horodatage_de(&ligne))
}

fn horodatage_de(ligne: &Value) -> Option<u64> {
    ligne
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(crate::metadata::iso_vers_ms)
        .and_then(|ms| u64::try_from(ms).ok())
}

impl EtatSession {
    fn lit_ligne(&mut self, texte: &str) {
        // Pré-filtre : la plupart des lignes ne parlent pas de tâches, et une
        // session réelle en compte des dizaines de milliers.
        let appel_bash = texte.contains("\"tool_use\"") && texte.contains("\"Bash\"");
        let lancement = texte.contains("\"tool_result\"")
            && (texte.contains("backgroundTaskId")
                || texte.contains("Async agent launched")
                || texte.contains("running in background")
                || texte.contains("moved to the background"));
        let fin = texte.contains("<task-notification>");
        if !(appel_bash || lancement || fin) {
            return;
        }
        let Ok(ligne) = serde_json::from_str::<Value>(texte) else {
            return;
        };
        let a_ms = horodatage_de(&ligne);
        if appel_bash {
            self.releve_appels_bash(&ligne);
        }
        if lancement {
            self.releve_lancements(&ligne, a_ms);
        }
        if fin {
            self.releve_fin(&ligne, a_ms);
        }
    }

    fn releve_appels_bash(&mut self, ligne: &Value) {
        if ligne.get("type").and_then(Value::as_str) != Some("assistant") {
            return;
        }
        let Some(blocs) = ligne
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
        else {
            return;
        };
        for bloc in blocs {
            if bloc.get("type").and_then(Value::as_str) != Some("tool_use")
                || bloc.get("name").and_then(Value::as_str) != Some("Bash")
            {
                continue;
            }
            let Some(id) = bloc.get("id").and_then(Value::as_str) else {
                continue;
            };
            let entree = bloc.get("input");
            let description = entree
                .and_then(|entree| entree.get("description"))
                .and_then(Value::as_str)
                .or_else(|| {
                    entree
                        .and_then(|entree| entree.get("command"))
                        .and_then(Value::as_str)
                })
                .map(|texte| texte.trim().chars().take(200).collect::<String>())
                .unwrap_or_default();
            self.appels_bash.insert(id.to_string(), description);
            self.appels_ordre.push_back(id.to_string());
            while self.appels_ordre.len() > APPELS_EN_ATTENTE {
                if let Some(ancien) = self.appels_ordre.pop_front() {
                    self.appels_bash.remove(&ancien);
                }
            }
        }
    }

    fn releve_lancements(&mut self, ligne: &Value, a_ms: Option<u64>) {
        if ligne.get("type").and_then(Value::as_str) != Some("user") {
            return;
        }
        let resultat = ligne.get("toolUseResult");
        let Some(blocs) = ligne
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
        else {
            return;
        };
        for bloc in blocs {
            if bloc.get("type").and_then(Value::as_str) != Some("tool_result") {
                continue;
            }
            let appel = bloc.get("tool_use_id").and_then(Value::as_str);
            let texte = texte_de_resultat(bloc.get("content"));
            let structure_agent = resultat
                .filter(|resultat| resultat.get("isAsync").and_then(Value::as_bool) == Some(true))
                .and_then(|resultat| resultat.get("agentId"))
                .and_then(Value::as_str);
            let structure_commande = resultat
                .and_then(|resultat| resultat.get("backgroundTaskId"))
                .and_then(Value::as_str);
            let (id, genre) = if let Some(id) = structure_agent {
                (id.to_string(), GenreTache::Agent)
            } else if let Some(id) = structure_commande {
                (id.to_string(), GenreTache::Commande)
            } else if let Some(id) =
                id_apres(&texte, "Async agent launched successfully", "agentId: ")
            {
                (id, GenreTache::Agent)
            } else if let Some(id) = id_apres(&texte, "Command running in background", "with ID: ")
                .or_else(|| id_apres(&texte, "moved to the background", "(ID: "))
            {
                (id, GenreTache::Commande)
            } else {
                continue;
            };
            if !id_valide(&id) {
                continue;
            }
            let description = match genre {
                GenreTache::Agent => resultat
                    .and_then(|resultat| resultat.get("description"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                GenreTache::Commande => appel
                    .and_then(|appel| self.appels_bash.get(appel))
                    .filter(|description| !description.is_empty())
                    .cloned(),
            };
            if let Some(appel) = appel {
                self.appels_bash.remove(appel);
            }
            if !self.lancements.contains_key(&id) {
                self.ordre.push(id.clone());
            }
            self.lancements.insert(
                id,
                Lancement {
                    genre,
                    description,
                    debut_ms: a_ms,
                },
            );
        }
    }

    fn releve_fin(&mut self, ligne: &Value, a_ms: Option<u64>) {
        let texte = match ligne.get("type").and_then(Value::as_str) {
            Some("user") => ligne
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(Value::as_str),
            Some("attachment") => ligne
                .get("attachment")
                .filter(|piece| {
                    piece.get("type").and_then(Value::as_str) == Some("queued_command")
                        && piece.get("commandMode").and_then(Value::as_str)
                            == Some("task-notification")
                })
                .and_then(|piece| piece.get("prompt"))
                .and_then(Value::as_str),
            _ => None,
        };
        let Some(notification) = texte.and_then(notification_de) else {
            return;
        };
        let genre = match notification.genre() {
            Some("agent") => Some(GenreTache::Agent),
            Some("commande") => Some(GenreTache::Commande),
            _ => None,
        };
        let fin = Fin {
            statut: notification.status.clone(),
            resume: notification.summary.clone(),
            description: notification.description(),
            genre,
            a_ms,
        };
        let id = notification.task_id;
        // Une fin sans lancement relevé (lancement hors de la fenêtre lue,
        // ou format inconnu) reste une tâche : elle est connue par sa fin.
        if !self.lancements.contains_key(&id)
            && let Some(genre) = fin.genre
            && id_valide(&id)
        {
            self.ordre.push(id.clone());
            self.lancements.insert(
                id.clone(),
                Lancement {
                    genre,
                    description: fin.description.clone(),
                    debut_ms: None,
                },
            );
        }
        self.fins.insert(id, fin);
    }
}

fn texte_de_resultat(contenu: Option<&Value>) -> String {
    match contenu {
        Some(Value::String(texte)) => texte.clone(),
        Some(Value::Array(blocs)) => blocs
            .iter()
            .filter_map(|bloc| bloc.get("text").and_then(Value::as_str))
            .collect::<Vec<&str>>()
            .join(""),
        _ => String::new(),
    }
}

/// L'identifiant qui suit `marque` dans un texte qui contient `annonce`.
fn id_apres(texte: &str, annonce: &str, marque: &str) -> Option<String> {
    if !texte.contains(annonce) {
        return None;
    }
    let debut = texte.find(marque)? + marque.len();
    let id: String = texte[debut..]
        .chars()
        .take_while(|caractere| {
            caractere.is_ascii_alphanumeric() || *caractere == '-' || *caractere == '_'
        })
        .collect();
    (!id.is_empty()).then_some(id)
}
