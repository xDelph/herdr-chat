//! L'index partagé par source (T027) : huit clients qui demandent la même
//! source ne multiplient pas les lectures (single-flight), une réponse
//! tardive d'une génération dépassée est **ignorée**, les panes réaffectés
//! invalident, et le lease d'observation se renouvelle — ou pas (`observe=0`,
//! T025).
//!
//! ⚠️ Les bornes de mémoire : 256 entrées (la capacité du cache de résumés,
//! D19) — la plus ancienne évincée.

use crate::agents::opencode::moteur::EntreeBrute;
use crate::metadata::{ResumeSource, reduis};
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

/// La capacité de l'index — 256 sources (la même borne que le cache D19).
pub const CAPACITE_INDEX: usize = 256;

struct EnVol {
    /// Le résultat de la lecture (posé une fois, attendu par les suivants).
    resultat: Mutex<Option<Result<ResumeSource, String>>>,
    attente: Condvar,
}

struct EntreeIndex {
    generation: u64,
    /// Le lease d'observation — renouvelé quand `observe=1` (T025).
    lease: Option<Instant>,
    resume: ResumeSource,
    /// Le rang du DERNIER usage — l'éviction part de là.
    dernier_usage: usize,
}

/// L'index : la mémoire des lectures par source.
#[derive(Default)]
pub struct IndexSessions {
    entrees: Mutex<HashMap<String, EntreeIndex>>,
    en_vol: Mutex<HashMap<String, Arc<EnVol>>>,
    /// Le compteur d'usages (l'ordre d'éviction LRU).
    usages: AtomicUsize,
}

/// L'erreur d'une lecture indexée — la génération a dépassé la réponse.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurIndex {
    /// La réponse arrive trop tard : la source a été invalidée PENDANT la
    /// lecture — le client relit (le résultat périmé n'entre jamais).
    GenerationDepassee,
    /// La lecture elle-même a échoué — la cause réelle, rapportée.
    Lecture(String),
}

impl IndexSessions {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// La génération courante d'une source — 0 = jamais lue.
    #[must_use]
    pub fn generation_de(&self, cle: &str) -> u64 {
        self.entrees
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(cle)
            .map(|entree| entree.generation)
            .unwrap_or(0)
    }

    /// Le lease d'observation de la source (T025 : `observe=1` le renouvelle).
    #[must_use]
    pub fn lease_de(&self, cle: &str) -> Option<Instant> {
        self.entrees
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(cle)
            .and_then(|entree| entree.lease)
    }

    /// Invalide une source (pane réaffecté, session disparue) : la
    /// génération avance — toute réponse en vol de l'ancienne sera ignorée ;
    /// la prochaine lecture est un **cold miss** (réapparition = relecture).
    pub fn invalide(&self, cle: &str) {
        let mut entrees = self
            .entrees
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match entrees.get_mut(cle) {
            Some(entree) => {
                entree.generation += 1;
                entree.lease = None;
            }
            None => {
                entrees.insert(
                    cle.to_string(),
                    EntreeIndex {
                        generation: 1,
                        lease: None,
                        resume: ResumeSource::default(),
                        dernier_usage: 0,
                    },
                );
            }
        }
    }

    /// Interroge la source : **le premier entrant lit**, les autres attendent
    /// le MÊME résultat (single-flight) ; `observe=1` renouvelle le lease.
    /// ⚠️ Une invalidation PENDANT la lecture rend la réponse ignorée.
    pub fn interroge(
        &self,
        cle: &str,
        observe: bool,
        lire: impl FnOnce() -> Result<Vec<EntreeBrute>, String>,
    ) -> Result<ResumeSource, ErreurIndex> {
        let generation_courante = self.generation_de(cle);
        let (vol, premier) = {
            let mut vols = self
                .en_vol
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            match vols.get(cle) {
                Some(vol) => (Arc::clone(vol), false),
                None => {
                    let vol = Arc::new(EnVol {
                        resultat: Mutex::new(None),
                        attente: Condvar::new(),
                    });
                    vols.insert(cle.to_string(), Arc::clone(&vol));
                    (vol, true)
                }
            }
        };
        if !premier {
            // LES SUIVANTS attendent le même résultat — un seul déclencheur
            // de lecture, peu importe le nombre d'attendants.
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
            return match pose.clone() {
                Some(Ok(resume)) => Ok(resume),
                Some(Err(cause)) if cause == "génération dépassée" => {
                    Err(ErreurIndex::GenerationDepassee)
                }
                Some(Err(cause)) => Err(ErreurIndex::Lecture(cause)),
                None => Err(ErreurIndex::Lecture(String::from("attente interrompue"))),
            };
        }
        // LE PREMIER ENTRANT lit — sous la génération courante.
        let resultat = lire().map(|entrees| reduis(&entrees));
        let valide = self.generation_de(cle) == generation_courante;
        let rendu = if valide {
            match &resultat {
                Ok(resume) => {
                    {
                        let mut entrees = self
                            .entrees
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        // La borne de mémoire : à la 257e source DISTINCTE,
                        // la moins récemment utilisée part (D19 — la même
                        // borne que le cache de résumés).
                        if entrees.len() >= CAPACITE_INDEX
                            && !entrees.contains_key(cle)
                            && let Some((cle_vieille, _)) = entrees
                                .iter()
                                .min_by_key(|(_, entree)| entree.dernier_usage)
                                .map(|(cle_min, entree)| (cle_min.clone(), entree))
                        {
                            entrees.remove(&cle_vieille);
                        }
                        let entree =
                            entrees
                                .entry(cle.to_string())
                                .or_insert_with(|| EntreeIndex {
                                    generation: generation_courante,
                                    lease: None,
                                    resume: ResumeSource::default(),
                                    dernier_usage: self
                                        .usages
                                        .fetch_add(1, std::sync::atomic::Ordering::SeqCst),
                                });
                        entree.dernier_usage = self
                            .usages
                            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        // La fusion D19 : les déclarations précédentes
                        // survivent à une fenêtre muette.
                        entree.resume = entree.resume.fusionne(resume);
                        if observe {
                            entree.lease = Some(Instant::now());
                        }
                        Ok(entree.resume.clone())
                    }
                }
                Err(cause) => Err(cause.clone()),
            }
        } else {
            Err(String::from("génération dépassée"))
        };
        // Le résultat (bon ou mauvais) est posé UNE fois pour TOUS les
        // attendants — jamais de suspension éternelle, même en échec.
        {
            let mut pose = vol
                .resultat
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            *pose = Some(rendu.clone());
            vol.attente.notify_all();
        }
        rendu.map_err(|cause| {
            if cause == "génération dépassée" {
                ErreurIndex::GenerationDepassee
            } else {
                ErreurIndex::Lecture(cause)
            }
        })
    }

    /// Le résumé en cache (sans lire) — la vue du cache froid.
    #[must_use]
    pub fn resume_cache(&self, cle: &str) -> Option<ResumeSource> {
        self.entrees
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(cle)
            .map(|entree| entree.resume.clone())
    }
}
