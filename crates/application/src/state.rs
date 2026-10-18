//! L'état partagé (T038) : l'observation complète, **immuable**,
//! horodatée par l'horloge injectée et numérotée par **génération** —
//! TECH §4 : « complete immutable snapshot plus observation time/generation
//! and upstream version/protocol ».
//!
//! ⚠️ Les changements sont committés PAR génération : une observation est
//! servie uniquement quand elle est la dernière committée — jamais un vieux
//! résultat à la place d'un neuf (la coalescence de `refresh` rend d'ailleurs
//! structurellement impossible qu'un rafraîchissement plus lent écrase une
//! observation plus neuve : un seul vol à la fois).

use domain::observation::Snapshot;
use std::time::{Duration, Instant};

/// La fenêtre de fraîcheur d'une lecture ordinaire : 2 s. Un cache plus
/// jeune est une observation valide ; au-delà, la lecture rejoint un
/// rafraîchissement.
pub const FRAICHEUR_OBSERVATION: Duration = Duration::from_secs(2);

/// Une observation horodatée et numérotée — la matière de toutes les
/// lectures ordinaires (T039 l'assemble par génération).
#[derive(Clone, Debug)]
pub struct ObservationBorne {
    /// La génération : le nombre de rafraîchissements amont réussis depuis
    /// la création du service. Une génération = une photo complète.
    pub generation: u64,
    /// L'instant où l'observation a été COMMITTÉE (horloge injectée) — le
    /// seuil de fraîcheur, jamais la date du jour.
    pub observe_a: Instant,
    /// La photo complète, immuable — version/protocole amont portés par
    /// sa provenance (`snapshot.version()/protocol()`).
    pub snapshot: Snapshot,
}

impl ObservationBorne {
    /// Une observation est **valide** dans sa fenêtre de fraîcheur même si
    /// elle est vide — « cache empty snapshots as valid observations ».
    #[must_use]
    pub fn fraiche(&self, maintenant: Instant) -> bool {
        maintenant.saturating_duration_since(self.observe_a) <= FRAICHEUR_OBSERVATION
    }

    /// La version du daemon amont, quand l'observation la porte.
    #[must_use]
    pub fn version_amont(&self) -> Option<&str> {
        self.snapshot.version()
    }

    /// Le protocole amont, quand l'observation le porte.
    #[must_use]
    pub fn protocole_amont(&self) -> Option<u64> {
        self.snapshot.protocol()
    }
}
