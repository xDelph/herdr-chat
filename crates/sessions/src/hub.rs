//! Le hub d'observation des sessions (STREAMING.md §3) : **une** observation
//! par source regardée, partagée par tous ses clients, arrêtée avec le dernier.
//!
//! ⚠️ **Le hub diffuse une révision, pas des lignes.** Chaque client garde son
//! curseur et lit son propre delta quand la révision bouge. Un client lent
//! saute des révisions sans rien perdre (le `watch` ne garde que la dernière) :
//! pas de file par client, donc pas de perte sur débordement — le défaut du
//! flux global (`/api/events`), où une file pleine faisait sauter le curseur.
//!
//! ⚠️ **Deux détecteurs, un seul signal.** `notify` (FSEvents sur macOS,
//! inotify sur Linux) sur le dossier parent, filtré sur le fichier — c'est ce
//! qui rend le direct immédiat. Un filet `stat` toutes les secondes rattrape
//! ce qu'un watcher manquerait (volume réseau, limite inotify, événement
//! coalescé). Si le watcher ne peut pas être posé, le filet tourne seul et la
//! dégradation est **dite** ([`Observation::degradation`]), jamais masquée.
//!
//! ⚠️ **Rien ne survit à ses clients.** L'état est tenu par `Arc` dans chaque
//! [`Observation`] ; la table n'en garde qu'un `Weak`. La dernière observation
//! libérée arrête la tâche du filet et le watcher (RAII).

use domain::session::{ResolvedSource, SourceKind};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError, Weak};
use std::time::{Duration, SystemTime};
use tokio::sync::watch;

/// La période du filet `stat` en production.
pub const FILET_PRODUCTION: Duration = Duration::from_secs(1);

/// Ce qui identifie une source observée : la base, et la session quand la
/// base en porte plusieurs (SQLite).
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
struct Cle {
    base: String,
    session_id: Option<String>,
}

/// L'état partagé d'une source observée.
struct Etat {
    emetteur: Arc<watch::Sender<u64>>,
    /// Gardé pour sa durée de vie : le lâcher arrête l'observation système.
    _surveillant: Option<RecommendedWatcher>,
    filet: Option<tokio::task::JoinHandle<()>>,
    degradation: Option<String>,
}

impl Drop for Etat {
    fn drop(&mut self) {
        if let Some(tache) = self.filet.take() {
            tache.abort();
        }
    }
}

/// Une observation : la révision de la source, tenue tant qu'on la garde.
pub struct Observation {
    etat: Arc<Etat>,
    /// Change à chaque modification constatée de la source.
    pub revisions: watch::Receiver<u64>,
}

impl Observation {
    /// Pourquoi l'observation est dégradée (filet seul), quand elle l'est.
    #[must_use]
    pub fn degradation(&self) -> Option<&str> {
        self.etat.degradation.as_deref()
    }
}

/// Le hub — clonable, une table partagée.
#[derive(Clone)]
pub struct SessionHub {
    observations: Arc<Mutex<HashMap<Cle, Weak<Etat>>>>,
    filet: Duration,
}

impl Default for SessionHub {
    fn default() -> Self {
        Self::avec_filet(FILET_PRODUCTION)
    }
}

impl SessionHub {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Un hub dont le filet a une autre période (les tests n'attendent pas).
    #[must_use]
    pub fn avec_filet(filet: Duration) -> Self {
        Self {
            observations: Arc::new(Mutex::new(HashMap::new())),
            filet,
        }
    }

    /// Observe une source : rejoint l'observation existante, ou la démarre.
    ///
    /// ⚠️ À appeler depuis le runtime tokio : le filet est une tâche. Hors
    /// runtime, seul le watcher tourne, et la dégradation le dit.
    pub fn observe(&self, source: &ResolvedSource) -> Observation {
        let cle = Cle {
            base: source.base.clone(),
            session_id: source.session_id.as_ref().map(|id| id.as_str().to_string()),
        };
        let mut table = self
            .observations
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(etat) = table.get(&cle).and_then(Weak::upgrade) {
            return Observation {
                revisions: etat.emetteur.subscribe(),
                etat,
            };
        }
        table.retain(|_, etat| etat.strong_count() > 0);
        let etat = Arc::new(demarre(&cibles_de(source), self.filet));
        table.insert(cle, Arc::downgrade(&etat));
        Observation {
            revisions: etat.emetteur.subscribe(),
            etat,
        }
    }

    /// Le nombre de sources réellement observées (encore tenues).
    #[must_use]
    pub fn observations_actives(&self) -> usize {
        self.observations
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .filter(|etat| etat.strong_count() > 0)
            .count()
    }
}

/// Les fichiers dont la modification change la source : le JSONL, ou la
/// base et son journal `-wal` (en WAL, la base principale ne bouge qu'au
/// checkpoint).
fn cibles_de(source: &ResolvedSource) -> Vec<PathBuf> {
    let base = PathBuf::from(&source.base);
    match source.kind {
        SourceKind::File => vec![base],
        SourceKind::Sqlite => {
            let mut wal = base.clone().into_os_string();
            wal.push("-wal");
            vec![base, PathBuf::from(wal)]
        }
    }
}

fn demarre(cibles: &[PathBuf], filet: Duration) -> Etat {
    let (emetteur, _) = watch::channel(0_u64);
    let emetteur = Arc::new(emetteur);
    let mut degradations: Vec<String> = Vec::new();
    let surveillant = match pose_surveillant(cibles, Arc::clone(&emetteur)) {
        Ok(surveillant) => Some(surveillant),
        Err(cause) => {
            tracing::warn!(%cause, "observation de session : filet seul");
            degradations.push(format!("observation système indisponible : {cause}"));
            None
        }
    };
    let tache = match tokio::runtime::Handle::try_current() {
        Ok(runtime) => Some(runtime.spawn(boucle_du_filet(
            cibles.to_vec(),
            Arc::clone(&emetteur),
            filet,
        ))),
        Err(_) => {
            degradations.push(String::from("filet indisponible hors runtime"));
            None
        }
    };
    Etat {
        emetteur,
        _surveillant: surveillant,
        filet: tache,
        degradation: (!degradations.is_empty()).then(|| degradations.join(" ; ")),
    }
}

fn avance(emetteur: &watch::Sender<u64>) {
    emetteur.send_modify(|revision| *revision = revision.wrapping_add(1));
}

/// Le watcher système, posé sur les dossiers parents (un fichier pas encore
/// créé — Pi écrit son JSONL au premier message — reste observable).
fn pose_surveillant(
    cibles: &[PathBuf],
    emetteur: Arc<watch::Sender<u64>>,
) -> Result<RecommendedWatcher, String> {
    // Un événement désigne la cible si son NOM correspond et que son dossier
    // est celui de la cible, tel qu'écrit ou résolu (FSEvents rend des chemins
    // canoniques : `/private/var/…` pour `/var/…`).
    let mut noms: HashSet<OsString> = HashSet::new();
    let mut dossiers: HashSet<PathBuf> = HashSet::new();
    for cible in cibles {
        let (Some(nom), Some(dossier)) = (cible.file_name(), cible.parent()) else {
            continue;
        };
        noms.insert(nom.to_os_string());
        dossiers.insert(dossier.to_path_buf());
        if let Ok(reel) = dossier.canonicalize() {
            dossiers.insert(reel);
        }
    }
    let concerne = {
        let noms = noms.clone();
        let dossiers = dossiers.clone();
        move |chemin: &Path| {
            chemin.file_name().is_some_and(|nom| noms.contains(nom))
                && chemin
                    .parent()
                    .is_some_and(|dossier| dossiers.contains(dossier))
        }
    };
    let mut surveillant =
        notify::recommended_watcher(move |issue: notify::Result<notify::Event>| {
            let Ok(evenement) = issue else { return };
            if matches!(evenement.kind, EventKind::Access(_)) {
                return;
            }
            if evenement.paths.iter().any(|chemin| concerne(chemin)) {
                avance(&emetteur);
            }
        })
        .map_err(|cause| cause.to_string())?;
    let a_poser: HashSet<PathBuf> = cibles
        .iter()
        .filter_map(|cible| cible.parent().map(Path::to_path_buf))
        .collect();
    for dossier in a_poser {
        surveillant
            .watch(&dossier, RecursiveMode::NonRecursive)
            .map_err(|cause| format!("{} : {cause}", dossier.display()))?;
    }
    Ok(surveillant)
}

/// La signature d'une cible : taille et date de modification, ou absence.
type Signature = Vec<Option<(u64, Option<SystemTime>)>>;

async fn signature_de(cibles: &[PathBuf]) -> Signature {
    let mut signature = Vec::with_capacity(cibles.len());
    for cible in cibles {
        signature.push(
            tokio::fs::metadata(cible)
                .await
                .ok()
                .map(|meta| (meta.len(), meta.modified().ok())),
        );
    }
    signature
}

async fn boucle_du_filet(
    cibles: Vec<PathBuf>,
    emetteur: Arc<watch::Sender<u64>>,
    periode: Duration,
) {
    let mut precedente = signature_de(&cibles).await;
    let mut horloge = tokio::time::interval(periode);
    horloge.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    horloge.tick().await;
    loop {
        horloge.tick().await;
        let signature = signature_de(&cibles).await;
        if signature != precedente {
            precedente = signature;
            avance(&emetteur);
        }
    }
}
