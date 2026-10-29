//! La **présence** d'un appareil (H23) : l'app est au premier plan sur cet
//! appareil, inutile de le notifier.
//!
//! ⚠️ **Retour du 2026-10-29 : « je suis dans l'app, et je reçois quand même
//! la notif ».** Le service worker ne peut pas se taire : iOS révoque un
//! abonnement qui reçoit des push sans notification visible. Le tri se fait
//! donc ICI, avant l'envoi — et **par appareil** (endpoint) : les autres
//! appareils sont toujours notifiés.
//!
//! - La PWA visible bat toutes les 10 s ; une présence vit [`DUREE_PRESENCE`]
//!   sans battement. Un appareil gelé sans avoir dit qu'il partait redevient
//!   donc notifiable de lui-même — on ne perd jamais une notification pour
//!   plus de quelques secondes.
//! - Un départ explicite (`visible: false`) l'efface tout de suite.
//! - Rien n'est persisté : un redémarrage du démon notifie tout le monde.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// La durée d'une présence sans battement.
pub const DUREE_PRESENCE: Duration = Duration::from_secs(25);

/// Le nombre d'appareils suivis — au-delà, les plus anciens sortent.
const MAXIMUM_APPAREILS: usize = 64;

/// Les appareils au premier plan, par endpoint push.
#[derive(Default)]
pub struct PresenceAppareils {
    vus: Mutex<HashMap<String, Instant>>,
}

impl PresenceAppareils {
    #[must_use]
    pub fn nouvelle() -> Self {
        Self::default()
    }

    /// Note qu'un appareil est au premier plan (`visible`) ou l'a quitté.
    pub fn marque(&self, endpoint: &str, visible: bool, maintenant: Instant) {
        let mut vus = self.vus.lock().unwrap_or_else(PoisonError::into_inner);
        if !visible {
            vus.remove(endpoint);
            return;
        }
        vus.retain(|_, vu| maintenant.saturating_duration_since(*vu) <= DUREE_PRESENCE);
        if vus.len() >= MAXIMUM_APPAREILS
            && !vus.contains_key(endpoint)
            && let Some(ancien) = vus
                .iter()
                .min_by_key(|(_, vu)| **vu)
                .map(|(e, _)| e.clone())
        {
            vus.remove(&ancien);
        }
        vus.insert(endpoint.to_string(), maintenant);
    }

    /// L'appareil est-il au premier plan, à cet instant ?
    #[must_use]
    pub fn est_present(&self, endpoint: &str, maintenant: Instant) -> bool {
        self.vus
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(endpoint)
            .is_some_and(|vu| maintenant.saturating_duration_since(*vu) <= DUREE_PRESENCE)
    }
}
