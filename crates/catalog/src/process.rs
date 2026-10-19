//! L'exécuteur de processus **borné** (T028) : commandes à argv FIXE (pas
//! de shell, jamais `sh -c`), délai 20 s, sortie bornée (stdout 2 MiB,
//! stderr 64 KiB), fin et nettoyage **des seuls enfants créés**.
//!
//! ⚠️ **Le nettoyage ne touche que NOS enfants** : un processus qui occupe un
//! port n'est pas un processus orphelin — personne ne tue ce qu'il n'a pas
//! créé. Ici, seuls les enfants que CET exécuteur a engendrés sont tués (au
//! délai dépassé ou à l'annulation), et chaque enfant est **ramassé**
//! (`wait`) — pas de zombie.
//!
//! ⚠️ **Aucun CLI d'agent réel n'est jamais lancé ici** : les tests passent
//! par des exécutables factices (scripts à shebang — le noyau interprète,
//! l'exécuteur n'enveloppe dans aucun shell).

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

/// Le délai par défaut d'une commande de catalogue — 20 s (mesuré T028).
pub const DELAI_PROCESS: Duration = Duration::from_secs(20);

/// La borne de la sortie standard — 2 MiB (mesuré T028).
pub const SORTIE_MAX_OCTETS: usize = 2 * 1024 * 1024;

/// La borne de la sortie d'erreur — 64 KiB (mesuré T028).
pub const ERREUR_MAX_OCTETS: usize = 64 * 1024;

/// Le drapeau d'annulation coopérative — partagé entre l'appelant et
/// l'exécuteur ; posé = l'enfant est tué et l'exécution rend `Annule`.
#[derive(Clone, Default, Debug)]
pub struct Annulation(Arc<AtomicBool>);

impl Annulation {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Demande l'annulation — les enfants CRÉÉS par l'appel en cours sont
    /// tués ; rien d'autre n'est touché.
    pub fn annule(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    fn est_annule(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Le résultat d'un enfant terminé.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Resultat {
    pub sortie: Vec<u8>,
    pub erreur: Vec<u8>,
    /// Le code de sortie — `None` = tué par signal.
    pub code: Option<i32>,
}

/// L'erreur d'exécution — chaque cause nommée.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurProcess {
    /// Le délai (20 s par défaut) est dépassé : l'enfant a été TU et ramassé.
    Delai,
    /// La sortie a dépassé sa borne — refusée, jamais tronquée en silence.
    SortieTropGrande,
    /// L'annulation a été demandée pendant l'exécution.
    Annule,
    /// Le lancement lui-même a échoué (exécutable absent…).
    Lancement(String),
}

impl std::fmt::Display for ErreurProcess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErreurProcess::Delai => {
                f.write_str("délai de commande dépassé (enfant tué et ramassé)")
            }
            ErreurProcess::SortieTropGrande => f.write_str("sortie au-delà de la borne"),
            ErreurProcess::Annule => f.write_str("commande annulée"),
            ErreurProcess::Lancement(detail) => write!(f, "lancement : {detail}"),
        }
    }
}

impl std::error::Error for ErreurProcess {}

/// Lit un flux borné — au-delà de la borne : `Err(SortieTropGrande)` du
/// point de vue de l'appel (le lecteur rend une marque).
fn lit_borne(
    flux: &mut impl Read,
    borne: usize,
    contenu: &mut Vec<u8>,
) -> Result<bool, std::io::Error> {
    let mut tampon = [0_u8; 8192];
    loop {
        let lus = flux.read(&mut tampon)?;
        if lus == 0 {
            return Ok(true);
        }
        if contenu.len() + lus > borne {
            return Ok(false);
        }
        contenu.extend_from_slice(&tampon[..lus]);
    }
}

/// Exécute un argv FIXE (pas de shell), avec le délai, les bornes et
/// l'annulation — les seuls enfants tués sont les nôtres.
pub fn execute(
    argv: &[&str],
    delai: Duration,
    annulation: &Annulation,
) -> Result<Resultat, ErreurProcess> {
    let Some(programme) = argv.first() else {
        return Err(ErreurProcess::Lancement(String::from("argv vide")));
    };
    let mut enfant = Command::new(programme)
        .args(&argv[1..])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|cause| ErreurProcess::Lancement(cause.to_string()))?;

    // Le VEILLEUR : au délai OU à l'annulation, il tue CET enfant (et lui
    // seul) — l'enfant est ensuite ramassé (pas de zombie).
    let meurtre = Arc::new(AtomicBool::new(false));
    let fini = Arc::new(AtomicBool::new(false));
    let veilleur_meurtre = Arc::clone(&meurtre);
    let veilleur_fini = Arc::clone(&fini);
    let pid_meurtre = enfant.id();
    let veilleur = thread::spawn(move || {
        let debut = std::time::Instant::now();
        // ⚠️ Le veilleur s'arrête **quand l'enfant est fini**. Sans cela il
        // dormait le délai entier et `join` rendait la main au bout du délai :
        // `pi --list-models` (0,65 s) était servi en **20 s**, mesuré sur le
        // vrai démon.
        while debut.elapsed() < delai {
            if veilleur_meurtre.load(Ordering::SeqCst) || veilleur_fini.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        // On demande la fin : le parent fait le kill via le pid détenu ici.
        let _ = pid_meurtre;
        veilleur_meurtre.store(true, Ordering::SeqCst);
    });

    // Les deux flux sont lus en parallèle (des fils) — un flux plein
    // bloquerait l'enfant sinon.
    let mut stdout = enfant.stdout.take();
    let mut stderr = enfant.stderr.take();
    let lecteur_sortie = thread::spawn(move || {
        let mut contenu = Vec::new();
        let complet = match &mut stdout {
            Some(flux) => lit_borne(flux, SORTIE_MAX_OCTETS, &mut contenu).unwrap_or(false),
            None => true,
        };
        (contenu, complet)
    });
    let lecteur_erreur = thread::spawn(move || {
        let mut contenu = Vec::new();
        let complet = match &mut stderr {
            Some(flux) => lit_borne(flux, ERREUR_MAX_OCTETS, &mut contenu).unwrap_or(false),
            None => true,
        };
        (contenu, complet)
    });

    // L'attente bornée : au délai ou à l'annulation, on tue (CET enfant).
    let fin = loop {
        match enfant.try_wait() {
            Ok(Some(etat)) => break Ok(etat),
            Ok(None) => {
                if annulation.est_annule() || meurtre.load(Ordering::SeqCst) {
                    let _ = enfant.kill();
                    // Le ramassage accompagne le kill — pas de zombie.
                    let _ = enfant.wait();
                    break Err(if annulation.est_annule() {
                        ErreurProcess::Annule
                    } else {
                        ErreurProcess::Delai
                    });
                }
                thread::sleep(Duration::from_millis(5));
            }
            Err(cause) => break Err(ErreurProcess::Lancement(cause.to_string())),
        }
    };
    fini.store(true, Ordering::SeqCst);
    let _ = veilleur.join();
    // ⚠️ Sur un kill : on ne bloque JAMAIS l'appelant sur les lecteurs — un
    // enfant tué peut laisser des descendants qui tiennent le tuyau ; les
    // lecteurs s'arrêteront d'eux-mêmes à la fermeture du tuyau.
    match fin {
        Err(cause) => Err(cause),
        Ok(etat) => {
            let (sortie, complet_sortie) = lecteur_sortie.join().unwrap_or((Vec::new(), false));
            let (erreur, _) = lecteur_erreur.join().unwrap_or((Vec::new(), false));
            if !complet_sortie {
                return Err(ErreurProcess::SortieTropGrande);
            }
            Ok(Resultat {
                sortie,
                erreur,
                code: etat.code(),
            })
        }
    }
}
