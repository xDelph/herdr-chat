//! L'admission et les files par pane (T034) : chaque pane a sa file bornée
//! à 8 opérations — **les séquences d'un même pane ne s'entrelacent jamais**,
//! les panes différents restent indépendants (parallèles), la saturation est
//! **explicite**, et une annulation après effet ne rejoue rien.

use domain::ids::PaneId;
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};

/// La capacité d'une file de pane — 8 opérations en attente (mesuré T034).
pub const FILE_PANE_MAX: usize = 8;

/// Le galet d'une file de pane : un sémaphore comptant + le tour exclusif.
struct FilePane {
    /// Les galets pris (0..=8).
    pris: Mutex<usize>,
    file: Condvar,
    /// Le tour exclusif — un seul effet à la fois par pane.
    tour: Mutex<()>,
}

/// Le tourniquet d'admission — la mémoire des files par pane.
#[derive(Default)]
pub struct Tourniquet {
    files: Mutex<HashMap<String, Arc<FilePane>>>,
}

/// L'erreur d'admission — la saturation est nommée.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurAdmission {
    /// La file du pane est pleine (8 en attente) — le client réessaiera.
    Saturation,
}

impl std::fmt::Display for ErreurAdmission {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("la file du pane est pleine (8)")
    }
}

impl Tourniquet {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    fn file_de(&self, pane: &PaneId) -> Arc<FilePane> {
        let mut files = self
            .files
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        files
            .entry(pane.as_str().to_string())
            .or_insert_with(|| {
                Arc::new(FilePane {
                    pris: Mutex::new(0),
                    file: Condvar::new(),
                    tour: Mutex::new(()),
                })
            })
            .clone()
    }

    /// Admet une opération sur un pane : un galet (file ≤ 8), PUIS le tour
    /// exclusif (les séquences ne s'entrelacent pas), puis l'effet.
    pub fn admet<T, E>(
        &self,
        pane: &PaneId,
        effet: impl FnOnce() -> Result<T, E>,
    ) -> Result<T, Result<ErreurAdmission, E>> {
        let file = self.file_de(pane);
        // 1) Le galet — la file pleine est un REFUS NOMMÉ (pas une file
        // infinie qui laisse croire que tout sera servi).
        {
            let mut pris = file
                .pris
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if *pris >= FILE_PANE_MAX {
                return Err(Ok(ErreurAdmission::Saturation));
            }
            *pris += 1;
        }
        // 2) Le tour exclusif — la garde de non-entrelacement.
        let _garde_tour = file
            .tour
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // 3) L'effet — et seulement là.
        let rendu = effet();
        // 4) Le galet rendu.
        {
            let mut pris = file
                .pris
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *pris -= 1;
            file.file.notify_one();
        }
        match rendu {
            Ok(valeur) => Ok(valeur),
            Err(erreur) => Err(Err(erreur)),
        }
    }
}
