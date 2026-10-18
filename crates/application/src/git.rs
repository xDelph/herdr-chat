//! Le lecteur de branche git (T040, D21) : `git -C <dossier> rev-parse
//! --abbrev-ref HEAD` — la SEULE source de branche (Herdr n'en expose
//! aucune), en lecture seule, sur le dossier du projet déjà validé, jamais
//! un chemin venu du client.
//!
//! ⚠️ **L'argv est fixe** : la commande ne varie pas, le lanceur réel ne
//! prend aucun argument du monde extérieur — la frontière de test remplace
//! le PROCESSUS, pas la commande.
//!
//! ⚠️ **Les trois absences ne se distinguent pas** (pas de dépôt, délai
//! dépassé, git absent) : toutes rendent une branche ABSENTE — aucune n'est
//! une erreur pour la liste, qui affiche simplement moins de choses.
//!
//! ⚠️ **Un job par cwd** (TECH §4) : les demandes concurrentes du même
//! dossier partagent le processus en cours — jamais deux git pour la même
//! branche. L'exécuteur borné plafonne les processus SIMULTANÉS (2) ; le
//! délai (3 s) tue le processus RETARDATAIRE, et lui seul — jamais un autre.
//!
//! ⚠️ **La capture est bornée pendant la lecture** : une réponse de git
//! tient en quelques dizaines d'octets ; on ne garde que `MAX_SORTIE`.

use crate::conversations::BrancheDeProjet;
use crate::permis::SasDeLecture;
use crate::refresh::SourceMaintenant;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::{Child, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// La durée de vie du cache : une branche ne change pas toutes les 4 s.
pub const CACHE_BRANCHE: Duration = Duration::from_secs(30);
/// Le délai d'un processus git : un dépôt lent ne retient pas la liste.
pub const DELAI_GIT: Duration = Duration::from_secs(3);
/// La sortie maximale lue — le reste est jeté pendant la lecture.
pub const MAX_SORTIE: usize = 4096;
/// Le nombre maximal de processus git en même temps (l'exécuteur borné).
pub const GIT_CONCURRENTS: usize = 2;

/// Un processus git, vu du lecteur : on interroge son état, on le tue, on
/// lit sa sortie bornée — jamais autre chose.
pub trait ProcessusGit: Send {
    /// Le code de sortie, ou `None` tant qu'il tourne encore.
    fn etat(&mut self) -> Option<i32>;
    /// Tue CE processus — jamais un autre (le délai n'annule qu'un job).
    fn tuer(&mut self);
    /// La sortie capturée, bornée à `max` octets.
    fn sortie(&mut self, max: usize) -> Option<String>;
}

/// Le lanceur injectable : l'argv fixe en production, un faux en test.
pub trait LanceGit: Send + Sync {
    fn lance(&self, dossier: &str) -> Result<Box<dyn ProcessusGit>, String>;
}

/// Le processus réel : `git` lancé avec l'argv FIXE, un lecteur de sortie
/// borné dans un fil (le fil s'arrête à la fin de la sortie ou au plafond).
pub struct ProcessusReel {
    enfant: Child,
    sortie: mpsc::Receiver<Vec<u8>>,
}

impl ProcessusReel {
    fn nouveau(dossier: &str) -> Result<Self, String> {
        let mut enfant = std::process::Command::new("git")
            .arg("-C")
            .arg(dossier)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|erreur| erreur.to_string())?;
        let mut tube = enfant
            .stdout
            .take()
            .ok_or_else(|| String::from("git n'a pas ouvert sa sortie (forme inattendue)"))?;
        let (emetteur, recepteur) = mpsc::channel();
        std::thread::spawn(move || {
            let mut capturé = Vec::new();
            let mut tampon = [0u8; 1024];
            loop {
                match tube.read(&mut tampon) {
                    Ok(0) => break,
                    Ok(lus) => {
                        capturé.extend_from_slice(&tampon[..lus]);
                        // La capture s'arrête au plafond : le reste est
                        // JETÉ pendant la lecture (jamais lu en entier).
                        if capturé.len() > MAX_SORTIE {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = emetteur.send(capturé);
        });
        Ok(Self {
            enfant,
            sortie: recepteur,
        })
    }
}

impl ProcessusGit for ProcessusReel {
    fn etat(&mut self) -> Option<i32> {
        match self.enfant.try_wait() {
            Ok(Some(statut)) => statut.code(),
            Ok(None) => None,
            Err(_) => Some(-1),
        }
    }

    fn tuer(&mut self) {
        let _ = self.enfant.kill();
    }

    fn sortie(&mut self, max: usize) -> Option<String> {
        // Le processus est sorti : la sortie se ferme, le lecteur rend la
        // capture (bornée) — un `recv` court, jamais une lecture sans fin.
        let capturé = self.sortie.recv().ok()?;
        let texte = String::from_utf8_lossy(&capturé);
        Some(texte.chars().take(max).collect())
    }
}

/// Le lanceur réel — l'argv fixe du contrat (D21).
pub struct LanceurGitReel;

impl LanceGit for LanceurGitReel {
    fn lance(&self, dossier: &str) -> Result<Box<dyn ProcessusGit>, String> {
        Ok(Box::new(ProcessusReel::nouveau(dossier)?))
    }
}

struct EntreeCache {
    lu: Instant,
    valeur: Option<String>,
}

/// Le lecteur de branches — partageable (les routes et la liste le
/// partagent) ; implémente `BrancheDeProjet` (T039).
pub struct LecteurBranches {
    cache: Mutex<HashMap<String, EntreeCache>>,
    /// Les dossiers dont un job est EN VOL : un seul git par cwd.
    vols: Mutex<HashSet<String>>,
    vol_disponible: Condvar,
    executeur: SasDeLecture,
    lanceur: Box<dyn LanceGit>,
    maintenant: Arc<dyn SourceMaintenant>,
    delai: Duration,
}

impl LecteurBranches {
    /// Le lecteur avec le délai du contrat (3 s) et l'horloge injectée.
    #[must_use]
    pub fn nouveau(lanceur: Box<dyn LanceGit>, maintenant: Arc<dyn SourceMaintenant>) -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
            vols: Mutex::new(HashSet::new()),
            vol_disponible: Condvar::new(),
            executeur: SasDeLecture::nouveau(GIT_CONCURRENTS),
            lanceur,
            maintenant,
            delai: DELAI_GIT,
        }
    }

    /// Le lecteur avec un délai raccourci — réservé aux tests (le délai
    /// réel d'un processus se teste sans dormir trois secondes).
    #[must_use]
    pub fn avec_delai(
        lanceur: Box<dyn LanceGit>,
        maintenant: Arc<dyn SourceMaintenant>,
        delai: Duration,
    ) -> Self {
        let mut lecteur = Self::nouveau(lanceur, maintenant);
        lecteur.delai = delai;
        lecteur
    }

    /// La branche du dossier, ou `None` — les trois absences (pas de dépôt,
    /// délai, git absent) se confondent, volontairement (D21).
    pub fn branche(&self, dossier: &str) -> Option<String> {
        let mut maintenant;
        loop {
            // 1) Le cache : une branche fraîche est servie sans git — et un
            //    demandeur qui s'est joint à un vol la retrouve ici à son
            //    réveil (jamais un second git pour la même branche).
            maintenant = self.maintenant.maintenant();
            self.purge(maintenant);
            if let Some(entree) = self
                .cache
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(dossier)
                && maintenant.saturating_duration_since(entree.lu) < CACHE_BRANCHE
            {
                return entree.valeur.clone();
            }
            // 2) UN job par cwd : les demandes concurrentes s'y joignent,
            //    puis reviennent à la case cache.
            let mut vols = self.vols.lock().unwrap_or_else(PoisonError::into_inner);
            if vols.contains(dossier) {
                vols = self
                    .vol_disponible
                    .wait(vols)
                    .unwrap_or_else(PoisonError::into_inner);
                continue;
            }
            vols.insert(dossier.to_string());
            break;
        }
        // 3) L'exécuteur borné, puis la lecture avec délai.
        self.executeur.acquiere();
        let valeur = self.lit(dossier);
        self.executeur.relache();
        // 4) Le vol est rendu, le résultat mis en cache.
        self.vols
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(dossier);
        self.vol_disponible.notify_all();
        self.cache
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(
                dossier.to_string(),
                EntreeCache {
                    lu: maintenant,
                    valeur: valeur.clone(),
                },
            );
        valeur
    }

    /// Le nombre d'entrées du cache — la mesure du bornage (les entrées
    /// expirées sont purgées à chaque lecture).
    #[must_use]
    pub fn nb_entrees_cache(&self) -> usize {
        self.cache
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    /// La lecture d'un processus : le délai tue le retardataire, et lui
    /// seul ; un code non nul, une sortie vide ou un HEAD détaché rendent
    /// une branche ABSENTE (jamais une erreur).
    fn lit(&self, dossier: &str) -> Option<String> {
        let mut processus = self.lanceur.lance(dossier).ok()?;
        let debut = Instant::now();
        loop {
            if let Some(code) = processus.etat() {
                if code != 0 {
                    return None;
                }
                let texte = processus.sortie(MAX_SORTIE)?.trim().to_string();
                if texte.is_empty() || texte == "HEAD" {
                    return None;
                }
                return Some(texte);
            }
            if debut.elapsed() >= self.delai {
                processus.tuer();
                return None;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn purge(&self, maintenant: Instant) {
        let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        cache.retain(|_, entree| maintenant.saturating_duration_since(entree.lu) < CACHE_BRANCHE);
    }
}

impl BrancheDeProjet for LecteurBranches {
    fn branche(&self, cwd: &str) -> Option<String> {
        LecteurBranches::branche(self, cwd)
    }
}
