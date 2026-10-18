//! Le permis partagé : au plus `max` ressources en vol en même temps —
//! utilisé par les lectures de session (T039, 4) et l'exécuteur git
//! (T040, 2). Un plafond, jamais une approximation par nombre de lignes.

use std::sync::{Arc, Condvar, Mutex, PoisonError};

/// Un sas borné : `acquiere` attend qu'une place se libère, `relache` rend
/// la sienne. Les verrous ne sont tenus que le temps du comptage.
#[derive(Debug)]
pub struct SasDeLecture {
    en_vol: Mutex<usize>,
    disponible: Condvar,
    max: usize,
}

impl SasDeLecture {
    #[must_use]
    pub fn nouveau(max: usize) -> Self {
        Self {
            en_vol: Mutex::new(0),
            disponible: Condvar::new(),
            max,
        }
    }

    /// Prend une place — bloque tant que le plafond est atteint.
    pub fn acquiere(&self) {
        let mut en_vol = self.en_vol.lock().unwrap_or_else(PoisonError::into_inner);
        while *en_vol >= self.max {
            en_vol = self
                .disponible
                .wait(en_vol)
                .unwrap_or_else(PoisonError::into_inner);
        }
        *en_vol += 1;
    }

    /// Rend la place — réveille un attendant.
    pub fn relache(&self) {
        let mut en_vol = self.en_vol.lock().unwrap_or_else(PoisonError::into_inner);
        *en_vol = en_vol.saturating_sub(1);
        self.disponible.notify_one();
    }

    /// Prend une place si le plafond le permet, sans attendre — `false` quand
    /// le plafond est atteint (le 9e flux est REFUSÉ, jamais mis en attente).
    #[must_use]
    pub fn tente_acquiere(&self) -> bool {
        let mut en_vol = self.en_vol.lock().unwrap_or_else(PoisonError::into_inner);
        if *en_vol >= self.max {
            return false;
        }
        *en_vol += 1;
        true
    }
}

/// Un permis RAII : sa chute rend la place EXACTEMENT une fois — la fermeture
/// d'un abonnement ne peut ni fuir ni libérer deux fois.
pub struct GardeDePermis {
    sas: Arc<SasDeLecture>,
}

impl GardeDePermis {
    /// Prend un permis si le plafond le permet.
    #[must_use]
    pub fn tente(sas: &Arc<SasDeLecture>) -> Option<Self> {
        if sas.tente_acquiere() {
            Some(Self {
                sas: Arc::clone(sas),
            })
        } else {
            None
        }
    }
}

impl Drop for GardeDePermis {
    fn drop(&mut self) {
        self.sas.relache();
    }
}
