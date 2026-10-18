//! Les abonnements au direct (T043, E05, C11) : un flux par client, sans
//! boucle de scrutation par client.
//!
//! ⚠️ **La création d'abonnement est atomique** (TECH §7) : le rattrapage ET
//! le récepteur live sont obtenus sous UNE possession du service — un
//! événement publié pendant la création est soit dans le rattrapage, soit
//! dans le récepteur, jamais perdu entre les deux.
//!
//! ⚠️ **Le journal est l'autorité de relecture** ; le canal live n'est
//! qu'une sonnette : borné, il ne grossit jamais la mémoire d'un
//! consommateur lent — un événement tombé est retrouvé au prochain sondage
//! du journal (le heartbeat du flux, 15 s).
//!
//! ⚠️ **8 permis RAII** : le 9e flux est REFUSÉ (503), jamais mis en attente ;
//! la chute de l'abonnement rend le permis EXACTEMENT une fois (GardeDePermis)
//! et retire l'émetteur mort à la prochaine publication.

use crate::events::journal::{ErreurJournal, EvenementJournal, IdJournal, Journal, Rattrapage};
use crate::permis::{GardeDePermis, SasDeLecture};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

/// Le nombre maximal de flux ouverts, tous clients confondus (S06).
pub const ABONNEMENTS_MAX: usize = 8;
/// La cadence du heartbeat : 15 s sans événement, le flux envoie un commentaire.
pub const HEARTBEAT: Duration = Duration::from_secs(15);
/// La taille du canal live : une sonnette, pas un entrepôt — un consommateur
/// lent ne fait pas grossir la mémoire.
pub const CANAL_LIVE: usize = 16;

/// Pourquoi un abonnement a été refusé.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RefusAbonnement {
    TropDeFlux,
}

struct EtatAbonnements {
    /// L'émetteur et le drapeau de fermeture : le Drop de l'abonnement pose
    /// le drapeau — le service le voit sans envoyer de faux événement.
    abonnes: Vec<(SyncSender<EvenementJournal>, Arc<AtomicBool>)>,
}

/// Le service des abonnements — partageable ; la publication passe PAR LUI
/// (jamais par le journal directement) pour que la notification des abonnés
/// partage l'étape de possession du journal.
pub struct ServiceAbonnements {
    etat: Mutex<EtatAbonnements>,
    permis: Arc<SasDeLecture>,
    journal: Arc<Journal>,
}

impl ServiceAbonnements {
    /// Le service sur un journal donné, avec le plafond du contrat (8).
    #[must_use]
    pub fn nouveau(journal: Arc<Journal>) -> Self {
        Self {
            etat: Mutex::new(EtatAbonnements {
                abonnes: Vec::new(),
            }),
            permis: Arc::new(SasDeLecture::nouveau(ABONNEMENTS_MAX)),
            journal,
        }
    }

    /// Publie un événement : le journal d'abord, puis la sonnette des
    /// abonnés — sous la MÊME possession que la création d'abonnement, pour
    /// que rien ne tombe entre rattrapage et live.
    pub fn publie(&self, genre: &str, donnees: Vec<u8>) -> Result<EvenementJournal, ErreurJournal> {
        let evenement = self.journal.publie(genre, donnees)?;
        let mut etat = self.etat.lock().unwrap_or_else(PoisonError::into_inner);
        // `try_send` : une sonnette pleine laisse tomber l'événement (le
        // journal l'a), elle ne bloque JAMAIS la publication pour un
        // consommateur lent — et un canal plein ne désabonne pas (Full =
        // vivant mais lent). Un abonnement fermé (drapeau posé par son Drop)
        // part ici.
        etat.abonnes.retain(|(emetteur, ferme)| {
            !ferme.load(Ordering::SeqCst)
                && match emetteur.try_send(evenement.clone()) {
                    Ok(()) => true,
                    Err(TrySendError::Full(_)) => true,
                    Err(TrySendError::Disconnected(_)) => false,
                }
        });
        Ok(evenement)
    }

    /// Ouvre un abonnement : le rattrapage depuis le curseur ET le récepteur
    /// live sous une seule possession — le 9e flux est refusé.
    pub fn abonne(&self, curseur: &str) -> Result<Abonnement, RefusAbonnement> {
        let permis = GardeDePermis::tente(&self.permis).ok_or(RefusAbonnement::TropDeFlux)?;
        let (emetteur, recepteur) = mpsc::sync_channel(CANAL_LIVE);
        let mut etat = self.etat.lock().unwrap_or_else(PoisonError::into_inner);
        // Les abonnements fermés partent aussi à l'abonnement : le compte
        // reflète les vivants, pas l'historique des fermetures.
        let ferme = Arc::new(AtomicBool::new(false));
        etat.abonnes
            .retain(|(_, ferme)| !ferme.load(Ordering::SeqCst));
        let rattrapage = self.journal.depuis(curseur);
        etat.abonnes.push((emetteur, Arc::clone(&ferme)));
        Ok(Abonnement {
            _permis: permis,
            journal: Arc::clone(&self.journal),
            recepteur,
            rattrapage,
            ferme,
        })
    }

    /// Le nombre d'abonnements ouverts.
    #[must_use]
    pub fn nb_abonnes(&self) -> usize {
        self.etat
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .abonnes
            .len()
    }
}

/// Un abonnement — RAII : sa chute rend le permis, pose le drapeau de
/// fermeture (le service retire l'émetteur à la prochaine opération) et
/// ferme la sonnette. Le rattrapage initial est déjà calculé ; le récepteur
/// live est la sonnette ; le journal reste l'autorité.
pub struct Abonnement {
    _permis: GardeDePermis,
    journal: Arc<Journal>,
    recepteur: Receiver<EvenementJournal>,
    rattrapage: Rattrapage,
    ferme: Arc<AtomicBool>,
}

impl Drop for Abonnement {
    fn drop(&mut self) {
        self.ferme.store(true, Ordering::SeqCst);
    }
}

impl Abonnement {
    /// Le rattrapage initial — calculé atomiquement avec l'inscription.
    #[must_use]
    pub fn rattrapage(&self) -> &Rattrapage {
        &self.rattrapage
    }

    /// Le prochain événement live, ou `None` après `delai` — le heartbeat du
    /// flux (15 s) : le consommateur sonde alors le journal pour retrouver
    /// ce qu'une sonnette bornée aurait pu laisser tomber.
    pub fn attend(&self, delai: Duration) -> Option<EvenementJournal> {
        self.recepteur.recv_timeout(delai).ok()
    }

    /// Le rattrapage depuis un curseur — l'autorité du journal, pour la
    /// relecture après un heartbeat vide.
    #[must_use]
    pub fn rattrapage_depuis(&self, curseur: &str) -> Rattrapage {
        self.journal.depuis(curseur)
    }

    /// L'identifiant courant du journal — la frontière live.
    #[must_use]
    pub fn dernier_id(&self) -> Option<IdJournal> {
        self.journal.dernier_id()
    }
}
