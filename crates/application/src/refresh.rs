//! `ServiceSnapshots` (T038) : le rafraîchissement partagé du snapshot et
//! du ping — TECH §4.
//!
//! - **Une seule requête amont à la fois** : les lectures simultanées sur
//!   une observation périmée se COALESCENT en un seul vol ; chacun rejoint
//!   le vol en cours (C23 — « one refresh for concurrent signals »).
//! - **Cache vide valide** : un snapshot vide est une observation comme une
//!   autre, servie dans sa fenêtre de fraîcheur.
//! - **Jamais de données périmées servies comme fraîches** : la panne du
//!   rafraîchissement est remontée telle quelle (502 au fil), l'ancienne
//!   observation n'est PAS présentée en remplacement.
//! - **Force** (admission, autorisation de racines de fichiers) : quitte la
//!   fenêtre de cache en partageant seulement un vol déjà en cours.
//! - **Santé** : ping coalescé séparément, TTL d'une seconde.
//! - **Battement** : `pulse()` est l'entrée du poller (2 s) —
//!   il ne frappe l'amont que quand l'observation vieillit.
//!
//! ⚠️ **L'horloge est toujours injectée** : `SourceMaintenant` — les
//! fenêtres (2 s, 1 s) se testent sans dormir, et le service ne lit jamais
//! `Instant::now()` directement.
//!
//! ⚠️ **Les verrous courts** : pendant l'appel amont (`snapshot`/`ping`)
//! AUCUN verrou n'est tenu (TECH §4 : ne pas tenir de verrou sur l'E/S) —
//! le vol est signalé par un drapeau, les points d'attente sont des
//! condvars.

use crate::commands::pousse;
use crate::state::ObservationBorne;
use domain::errors::PortError;
use domain::observation::UpstreamPing;
use domain::ports::ControlPort;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// Le TTL de l'observation de santé : 1 s. La santé est coalescée
/// SÉPARÉMENT du snapshot (une panne de l'une n'entame pas l'autre).
pub const TTL_SANTE: Duration = Duration::from_secs(1);

/// La source d'un temps monotone — toujours injectée, jamais lue en dur.
pub trait SourceMaintenant: Send + Sync {
    /// L'instant monotone courant.
    fn maintenant(&self) -> Instant;
}

/// L'horloge réelle : `Instant::now()`.
#[derive(Default)]
pub struct MaintenantReelle;

impl SourceMaintenant for MaintenantReelle {
    fn maintenant(&self) -> Instant {
        Instant::now()
    }
}

/// Un ping horodaté par l'horloge injectée — la matière de `/api/health`.
#[derive(Clone, Debug)]
pub struct PingBorne {
    pub observe_a: Instant,
    pub ping: UpstreamPing,
}

/// La lecture d'un snapshot refusée — la cause amont est nommée, jamais
/// masquée par des données périmées.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurLecture {
    /// Le rafraîchissement amont a échoué — l'ancienne observation n'est
    /// PAS servie comme fraîche : la lecture échoue avec la cause réelle.
    Amont { cause: PortError },
}

/// La lecture de santé refusée — TTL expiré et ping amont en panne.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurSante {
    Amont { cause: PortError },
}

#[derive(Default)]
struct Depot {
    /// La DERNIÈRE observation committée (d'une génération, horodatée) —
    /// conservée même après un échec de rafraîchissement : les lectures
    /// refusent de la servir, sans l'effacer (continuité de génération).
    observation: Option<ObservationBorne>,
    /// Le nombre de vols réussis — croît de UNE génération par succès.
    generation: u64,
    /// Un rafraîchissement amont est en vol : quiconque arrive s'y joint.
    en_vol: bool,
    /// Le verdict du dernier vol — `Some` seulement en cas de panne.
    dernier_verdict: Option<PortError>,
    /// Les lectures qui attendent le verdict du vol en cours.
    joints: usize,
}

#[derive(Default)]
struct DepotSante {
    ping: Option<PingBorne>,
    en_vol: bool,
    dernier_verdict: Option<PortError>,
}

/// Le service qui possède le port et distille une vue partagée de l'état
/// amont — partageable par `Arc` entre les routes (T056).
pub struct ServiceSnapshots {
    port: Arc<dyn ControlPort>,
    depot: Mutex<Depot>,
    vol: Condvar,
    sante: Mutex<DepotSante>,
    vol_sante: Condvar,
    maintenant: Arc<dyn SourceMaintenant>,
}

impl ServiceSnapshots {
    /// Crée le service avec une horloge **explicitement injectée** — jamais
    /// de dépendance cachée au temps réel (les fenêtres se testent sans
    /// dormir).
    #[must_use]
    pub fn nouveau(port: Arc<dyn ControlPort>, maintenant: Arc<dyn SourceMaintenant>) -> Self {
        Self {
            port,
            depot: Mutex::new(Depot::default()),
            vol: Condvar::new(),
            sante: Mutex::new(DepotSante::default()),
            vol_sante: Condvar::new(),
            maintenant,
        }
    }

    /// La lecture ordinaire : une observation fraîche (≤ 2 s, même vide)
    /// est servie sans toucher l'amont ; sinon la lecture REJOINT un
    /// rafraîchissement — une seule requête amont pour tous les signaux
    /// simultanés (C23) — et reçoit le verdict partagé (succès ou panne).
    pub fn lecture(&self) -> Result<ObservationBorne, ErreurLecture> {
        self.rafraichit(false)
    }

    /// La lecture forcée : l'admission du contrôle et l'autorisation des
    /// racines de fichiers exigent une vraie fraîcheur — on sort de la
    /// fenêtre de cache, en partageant seulement un vol déjà en cours.
    pub fn lecture_forcee(&self) -> Result<ObservationBorne, ErreurLecture> {
        self.rafraichit(true)
    }

    /// La santé : un ping coalescé au TTL d'une seconde.
    pub fn sante(&self) -> Result<PingBorne, ErreurSante> {
        loop {
            let mut depot = self.sante.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(borne) = &depot.ping
                && self.fraiche(borne.observe_a, TTL_SANTE)
            {
                return Ok(borne.clone());
            }
            if depot.en_vol {
                depot = self
                    .vol_sante
                    .wait(depot)
                    .unwrap_or_else(PoisonError::into_inner);
                if let Some(cause) = &depot.dernier_verdict {
                    return Err(ErreurSante::Amont {
                        cause: cause.clone(),
                    });
                }
                continue;
            }
            depot.en_vol = true;
            depot.dernier_verdict = None;
            drop(depot);
            let mut requete = self.port.ping();
            let resultat = pousse(&mut requete);
            let mut depot = self.sante.lock().unwrap_or_else(PoisonError::into_inner);
            depot.en_vol = false;
            match resultat {
                Ok(ping) => {
                    depot.ping = Some(PingBorne {
                        observe_a: self.maintenant.maintenant(),
                        ping,
                    });
                    depot.dernier_verdict = None;
                    self.vol_sante.notify_all();
                    let ping = depot.ping.clone().unwrap_or_else(|| {
                        unreachable!("le ping vient d'être committé sous ce verrou")
                    });
                    return Ok(ping);
                }
                Err(cause) => {
                    depot.dernier_verdict = Some(cause.clone());
                    self.vol_sante.notify_all();
                    return Err(ErreurSante::Amont { cause });
                }
            }
        }
    }

    /// Le battement du poller (2 s) : ne frappe l'amont que quand
    /// l'observation vieillit — le retour porte l'échec pour le journal du
    /// poller, qui n'est PAS un point de décision.
    pub fn pulse(&self) -> Result<(), ErreurLecture> {
        self.rafraichit(false).map(drop)
    }

    /// La génération courante — l'outil des lectures « une même génération »
    /// (T039) et la mesure des changements committés.
    #[must_use]
    pub fn generation_actuelle(&self) -> u64 {
        self.depot
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .generation
    }

    /// Le nombre de lectures jointes au vol en cours — l'observation qui
    /// permet de prouver le partage d'un vol sans dormir en espérant que
    /// les joints soient arrivés.
    #[must_use]
    pub fn joints_en_attente(&self) -> usize {
        self.depot
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .joints
    }

    fn fraiche(&self, observe_a: Instant, fenetre: Duration) -> bool {
        self.maintenant
            .maintenant()
            .saturating_duration_since(observe_a)
            <= fenetre
    }

    fn rafraichit(&self, force: bool) -> Result<ObservationBorne, ErreurLecture> {
        loop {
            let mut depot = self.depot.lock().unwrap_or_else(PoisonError::into_inner);
            // Une observation fraîche est une observation valide : servie,
            // sans toucher l'amont — sauf en mode forcé.
            if !force
                && let Some(borne) = &depot.observation
                && borne.fraiche(self.maintenant.maintenant())
            {
                return Ok(borne.clone());
            }
            // Un vol est en cours : on s'y JOINT (une seule requête amont
            // pour les signaux simultanés) et on réévalue après son verdict.
            if depot.en_vol {
                depot.joints += 1;
                depot = self.vol.wait(depot).unwrap_or_else(PoisonError::into_inner);
                depot.joints -= 1;
                match &depot.dernier_verdict {
                    // Le verdict partagé : une panne nomme la cause à tous
                    // les joints (jamais des données périmées en
                    // remplacement) — sauf en mode forcé, où le demandeur
                    // EXIGE une fraîcheur réelle et relance un vol.
                    Some(cause) if !force => {
                        return Err(ErreurLecture::Amont {
                            cause: cause.clone(),
                        });
                    }
                    Some(_) => continue,
                    // Succès : la génération commitée est fraîche pour
                    // TOUT le monde (force comprise) — servie telle quelle.
                    None => {
                        if let Some(borne) = &depot.observation {
                            return Ok(borne.clone());
                        }
                    }
                }
                continue;
            }
            // Porteur : la seule requête amont de cette génération.
            depot.en_vol = true;
            depot.dernier_verdict = None;
            drop(depot);
            let mut photo = self.port.snapshot();
            let resultat = pousse(&mut photo);
            let mut depot = self.depot.lock().unwrap_or_else(PoisonError::into_inner);
            depot.en_vol = false;
            match resultat {
                Ok(snapshot) => {
                    depot.generation += 1;
                    let borne = ObservationBorne {
                        generation: depot.generation,
                        observe_a: self.maintenant.maintenant(),
                        snapshot,
                    };
                    depot.observation = Some(borne.clone());
                    depot.dernier_verdict = None;
                    self.vol.notify_all();
                    return Ok(borne);
                }
                Err(cause) => {
                    depot.dernier_verdict = Some(cause.clone());
                    self.vol.notify_all();
                    return Err(ErreurLecture::Amont { cause });
                }
            }
        }
    }
}
