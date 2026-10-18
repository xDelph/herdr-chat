//! Horloge **contrôlée** : le temps n'avance que quand un test le pousse.
//!
//! ⚠️ Aucun appel système d'horloge ici : la valeur est un compteur manipulé
//! à la main. Un test veut prouver le comportement, pas la vitesse de la
//! machine. Les clones partagent le même compteur : un service qui reçoit un
//! clone voit exactement le temps du test.

use domain::observation::Millis;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// Une horloge que le test pousse. Clone = même temps.
#[derive(Clone, Debug)]
pub struct HorlogeFausse {
    millis: Arc<AtomicU64>,
}

impl HorlogeFausse {
    /// Une horloge figée à l'instant donné (0 = jamais écoulé — **absence
    /// mesurable**, pas une valeur plafond).
    #[must_use]
    pub fn figee_a(millis: u64) -> Self {
        Self {
            millis: Arc::new(AtomicU64::new(millis)),
        }
    }

    /// L'heure courante, telle que le test l'a fixée.
    #[must_use]
    pub fn maintenant(&self) -> Millis {
        Millis(self.millis.load(Ordering::SeqCst))
    }

    /// Avance du nombre de millisecondes donné. Une avance **négative
    /// impossible à exprimer** : `avance` ne recule jamais ; pour sauter en
    /// arrière (et prouver la non-régression du consommateur), voir
    /// [`posé_a`], qui est explicite et local.
    ///
    /// # Panique
    /// Si l'avance dépasse la capacité du compteur : un test contrôlé doit
    /// savoir qu'il a écrit hors bornes, pas continuer en silence.
    pub fn avance(&self, millis: u64) -> Millis {
        let courant = self.millis.load(Ordering::SeqCst);
        let nouveau = courant
            .checked_add(millis)
            .unwrap_or_else(|| panic!("avance d'horloge hors bornes : {courant} + {millis}"));
        self.millis.store(nouveau, Ordering::SeqCst);
        Millis(nouveau)
    }

    /// Pose l'heure exacte — saut explicite, avant comme après. Prévu pour
    /// prouver la non-régression des consommateurs face à un temps qui
    /// recule (observation plus ancienne ne remplace pas la récente, TECH §4).
    pub fn pose_a(&self, millis: u64) -> Millis {
        self.millis.store(millis, Ordering::SeqCst);
        Millis(millis)
    }
}
