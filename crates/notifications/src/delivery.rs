//! La livraison push (T045, E09, C14) : un worker borné — file de 64,
//! concurrence de 4, délai de 15 s par envoi, TTL de 60 s — et l'élagage
//! VERSIONNÉ des abonnements expirés (404/410).
//!
//! ⚠️ **Aucune livraison sous lock du store** (C14) : le worker livre sur
//! une PHOTO des abonnements (la porte du store n'est tenue que le temps
//! d'une lecture), puis ré-ouvre la porte pour élaguer — un abonnement
//! pendant un envoi n'attend jamais.
//!
//! ⚠️ **L'élagage est versionné** : un endpoint expiré n'est retiré que si
//! l'abonnement COURANT est exactement celui qui a expiré (mêmes clés) —
//! un réabonnement pendant l'envoi a une nouvelle version, il survit.
//!
//! ⚠️ **Une panne du service n'est pas une expiration** : un échec autre
//! que 404/410 est compté, jamais un endpoint retiré pour une raison
//! inventée.

use crate::store::{AbonnementPush, GardienDeStore};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::{Semaphore, mpsc};
use tokio::task::JoinSet;
use tracing::warn;

/// La file bornée des livraisons en attente.
pub const FILE_LIVRAISON: usize = 64;
/// Le nombre maximal d'envois simultanés.
pub const CONCURRENCE: usize = 4;
/// Le délai par envoi — un service lent ne retient pas le worker.
pub const DELAI_LIVRAISON: Duration = Duration::from_secs(15);
/// La durée de vie du message chez le service push.
pub const TTL_LIVRAISON: Duration = Duration::from_secs(60);

/// Le port de livraison — le faux de test remplace le réseau. Le futur est
/// boxé pour rester dyn-compatible (pas de `async fn` dans le trait).
pub trait LivraisonPush: Send + Sync {
    /// Envoie `payload` à `abonnement` avec `ttl`.
    fn envoie<'a>(
        &'a self,
        abonnement: &'a AbonnementPush,
        payload: &'a str,
        ttl: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<(), ErreurLivraison>> + Send + 'a>>;
}

/// Pourquoi un envoi a échoué.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurLivraison {
    /// Le service répond 404/410 — l'abonnement est expiré, il sera élagué.
    Expire,
    /// Le service est injoignable ou a échoué autrement — jamais une
    /// expiration inventée.
    Autre { detail: String },
}

/// Une livraison en attente : un payload vers une liste d'abonnements.
#[derive(Clone, Debug)]
pub struct TravailLivraison {
    pub payload: String,
    pub abonnements: Vec<AbonnementPush>,
}

/// Pourquoi une livraison a été refusée à l'entrée.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RefusFile {
    Pleine,
}

struct Mesures {
    elagues: AtomicU64,
    files_pleines: AtomicU64,
    echecs: AtomicU64,
}

/// Le livreur — enfile des livraisons, un worker les traite avec les bornes
/// du contrat. La file est bornée : une file pleine est comptée, les chemins
/// du veilleur et du contrôle continuent.
pub struct Livreur {
    emetteur: mpsc::Sender<TravailLivraison>,
    mesures: Arc<Mesures>,
}

impl Livreur {
    /// Le livreur avec le délai du contrat (15 s).
    #[must_use]
    pub fn nouveau(port: Arc<dyn LivraisonPush>, store: Arc<GardienDeStore>) -> Self {
        Self::avec_delai(port, store, DELAI_LIVRAISON)
    }

    /// Le livreur avec un délai raccourci — réservé aux tests.
    #[must_use]
    pub fn avec_delai(
        port: Arc<dyn LivraisonPush>,
        store: Arc<GardienDeStore>,
        delai: Duration,
    ) -> Self {
        let (emetteur, recepteur) = mpsc::channel(FILE_LIVRAISON);
        let mesures = Arc::new(Mesures {
            elagues: AtomicU64::new(0),
            files_pleines: AtomicU64::new(0),
            echecs: AtomicU64::new(0),
        });
        tokio::spawn(travaille(
            port,
            store,
            recepteur,
            Arc::clone(&mesures),
            delai,
        ));
        Self { emetteur, mesures }
    }

    /// Enfile une livraison — refusée si la file est pleine (comptée).
    pub fn enfile(&self, travail: TravailLivraison) -> Result<(), RefusFile> {
        match self.emetteur.try_send(travail) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.mesures.files_pleines.fetch_add(1, Ordering::SeqCst);
                Err(RefusFile::Pleine)
            }
            Err(mpsc::error::TrySendError::Closed(_)) => Err(RefusFile::Pleine),
        }
    }

    /// Le nombre d'abonnements élagués (expirés, version vérifiée).
    #[must_use]
    pub fn elagues(&self) -> u64 {
        self.mesures.elagues.load(Ordering::SeqCst)
    }

    /// Le nombre de livraisons refusées faute de place.
    #[must_use]
    pub fn files_pleines(&self) -> u64 {
        self.mesures.files_pleines.load(Ordering::SeqCst)
    }

    /// Le nombre d'échecs de livraison (hors expiration).
    #[must_use]
    pub fn echecs(&self) -> u64 {
        self.mesures.echecs.load(Ordering::SeqCst)
    }
}

/// Le worker : une livraison après l'autre, chaque envoi sous le sémaphore
/// de concurrence et le délai — les expirés sont élagués APRÈS la livraison,
/// jamais sous la porte du store.
async fn travaille(
    port: Arc<dyn LivraisonPush>,
    store: Arc<GardienDeStore>,
    mut recepteur: mpsc::Receiver<TravailLivraison>,
    mesures: Arc<Mesures>,
    delai: Duration,
) {
    let semaphore = Arc::new(Semaphore::new(CONCURRENCE));
    while let Some(travail) = recepteur.recv().await {
        let mut ensemble = JoinSet::new();
        for abonnement in travail.abonnements {
            let port = Arc::clone(&port);
            let semaphore = Arc::clone(&semaphore);
            let payload = travail.payload.clone();
            ensemble.spawn(async move {
                let Ok(_permis) = semaphore.acquire_owned().await else {
                    return (
                        abonnement,
                        Err(ErreurLivraison::Autre {
                            detail: String::from("sémaphore fermé"),
                        }),
                    );
                };
                let resultat =
                    tokio::time::timeout(delai, port.envoie(&abonnement, &payload, TTL_LIVRAISON))
                        .await
                        .unwrap_or_else(|_| {
                            Err(ErreurLivraison::Autre {
                                detail: String::from("délai de livraison dépassé"),
                            })
                        });
                (abonnement, resultat)
            });
        }
        let mut expires = Vec::new();
        while let Some(resultat) = ensemble.join_next().await {
            match resultat {
                Ok((_abonnement, Ok(()))) => {}
                Ok((abonnement, Err(ErreurLivraison::Expire))) => expires.push(abonnement),
                Ok((_abonnement, Err(ErreurLivraison::Autre { detail }))) => {
                    mesures.echecs.fetch_add(1, Ordering::SeqCst);
                    warn!("livraison push échouée : {detail}");
                }
                Err(panne) => {
                    mesures.echecs.fetch_add(1, Ordering::SeqCst);
                    warn!("tâche de livraison interrompue : {panne}");
                }
            }
        }
        if !expires.is_empty() {
            // L'élagage versionné ré-ouvre la porte du store — jamais tenue
            // pendant les envois.
            match store.elague_versionne(&expires) {
                Ok(retires) => {
                    mesures.elagues.fetch_add(retires as u64, Ordering::SeqCst);
                }
                Err(erreur) => {
                    warn!("élagage des abonnements expirés impossible : {erreur:?}");
                }
            }
        }
    }
}
