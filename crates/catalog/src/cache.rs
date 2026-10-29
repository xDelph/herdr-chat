//! Le cache/single-flight des catalogues (T031/C16) : **deux requêtes
//! concurrentes d'un kind lancent exactement un processus** ; le succès vit
//! 60 secondes (mesuré : `MODEL_CATALOG_CACHE_MS`) ; **un échec n'est jamais
//! figé** (réessayable immédiatement) ; liste et lancement passent par la
//! MÊME politique (une seule fonction, donc un seul chemin).

use crate::adapters::{ResultatCatalogue, catalogue_d_adaptateur};
use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// La durée de vie d'un succès de catalogue — 60 s (mesuré :
/// `MODEL_CATALOG_CACHE_MS`).
pub const VIE_SUCCES: Duration = Duration::from_secs(60);

struct EnVol {
    resultat: Mutex<Option<Arc<ResultatCatalogue>>>,
    attente: Condvar,
}

/// Le cache des catalogues — un kind = au plus un processus en vol, au plus
/// une entrée de succès de 60 s.
#[derive(Default)]
pub struct CacheCatalogues {
    succes: Mutex<HashMap<String, (Arc<ResultatCatalogue>, Instant)>>,
    en_vol: Mutex<HashMap<String, Arc<EnVol>>>,
}

impl CacheCatalogues {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Le catalogue d'un kind, par la politique commune (liste ET lancement) :
    /// un succès de moins de 60 s sort du cache — **aucun processus** ;
    /// sinon le single-flight : le premier entrant exécute, les autres
    /// attendent le même résultat ; **l'échec n'entre jamais au cache** (il
    /// est réessayable au prochain appel).
    pub fn catalogue(&self, genre: &str, commande_injectee: &[String]) -> Arc<ResultatCatalogue> {
        // 1) Le succès frais sort du cache — sans processus.
        if let Ok(succes) = self.succes.lock()
            && let Some((resultat, jusqu_a)) = succes.get(genre)
            && Instant::now() < *jusqu_a
        {
            return Arc::clone(resultat);
        }
        // 2) Le single-flight.
        let (vol, premier) = {
            let mut vols = self
                .en_vol
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            match vols.get(genre) {
                Some(vol) => (Arc::clone(vol), false),
                None => {
                    let vol = Arc::new(EnVol {
                        resultat: Mutex::new(None),
                        attente: Condvar::new(),
                    });
                    vols.insert(genre.to_string(), Arc::clone(&vol));
                    (vol, true)
                }
            }
        };
        if !premier {
            let mut pose = vol
                .resultat
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            while pose.is_none() {
                pose = vol
                    .attente
                    .wait(pose)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
            }
            return Arc::clone(pose.as_ref().unwrap_or(&Arc::new(ResultatCatalogue {
                erreur: Some(String::from("wait interrupted")),
                modeles: Vec::new(),
                source: String::new(),
                niveaux: Vec::new(),
            })));
        }
        // 3) LE premier entrant exécute — un seul processus par kind.
        let adaptateur = crate::adapters::adaptateur_de(genre);
        let resultat = match adaptateur {
            Some(adaptateur) => Arc::new(catalogue_d_adaptateur(adaptateur, commande_injectee)),
            None => Arc::new(ResultatCatalogue {
                erreur: Some(format!(
                    "kind {genre}: no known catalog — nothing is invented"
                )),
                modeles: Vec::new(),
                source: format!("no adapter for {genre}"),
                niveaux: Vec::new(),
            }),
        };
        // Seul le SUCCÈS entre au cache — l'échec reste réessayable.
        if resultat.erreur.is_none()
            && let Ok(mut succes) = self.succes.lock()
        {
            succes.insert(
                genre.to_string(),
                (Arc::clone(&resultat), Instant::now() + VIE_SUCCES),
            );
        }
        {
            let mut pose = vol
                .resultat
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *pose = Some(Arc::clone(&resultat));
            vol.attente.notify_all();
        }
        {
            let mut vols = self
                .en_vol
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            vols.remove(genre);
        }
        resultat
    }

    /// Invalide explicitement (le lancement veut du frais, ou une défaillance
    /// de l'agent a été constatée).
    pub fn invalide(&self, genre: &str) {
        if let Ok(mut succes) = self.succes.lock() {
            succes.remove(genre);
        }
    }
}
