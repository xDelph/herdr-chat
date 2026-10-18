//! Les diagnostics (T055, S10–S13) — la **politique** du journal, sans I/O :
//! la forme d'une ligne, la borne du détail, la rédaction des identifiants et
//! l'anti-répétition.
//!
//! ⚠️ **Un journal ne doit pas casser le service.** Le puits est un trait qui
//! ne rend rien (`()`): un disque refusé, un chemin impraticable, un journal
//! plein ne peuvent donc pas transformer une commande en échec — ni en succès
//! vide (l'action est décidée avant l'écriture).
//!
//! ⚠️ **La forme est celle du fil** : `ISO [LEVEL] [source] message` puis
//! ` | <detail JSON>` tronqué à 2000 caractères. Ce journal est lu par des
//! humains qui cherchent une cause : changer la forme, c'est casser leur
//! recherche.

use domain::errors::supprime_identifiants;
use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

/// Le niveau, avec son libellé exact (`ERROR`, `WARN`, `INFO`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub enum Niveau {
    Error,
    Warn,
    Info,
}

impl Niveau {
    /// Le libellé écrit dans le fichier — jamais une autre casse.
    #[must_use]
    pub fn libelle(self) -> &'static str {
        match self {
            Niveau::Error => "ERROR",
            Niveau::Warn => "WARN",
            Niveau::Info => "INFO",
        }
    }

    /// Le niveau d'une chaîne reçue du client — `None` si inconnu (le fil
    /// n'accepte que `error` sur H13).
    #[must_use]
    pub fn depuis_libelle(libelle: &str) -> Option<Self> {
        match libelle {
            "error" => Some(Niveau::Error),
            "warn" => Some(Niveau::Warn),
            "info" => Some(Niveau::Info),
            _ => None,
        }
    }
}

/// La longueur maximale du détail — au-delà, il est coupé (S11) : une pile
/// d'appels de 100 Ko rend le journal inutilisable.
pub const DETAIL_MAX: usize = 2000;

/// Une entrée de diagnostic, prête à écrire.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EntreeDiagnostic {
    pub niveau: Niveau,
    /// L'origine : `server` ou `client` — jamais un identifiant interne.
    pub source: String,
    pub message: String,
    /// Le détail déjà sérialisé (JSON), tronqué à [`DETAIL_MAX`].
    pub detail: Option<String>,
}

impl EntreeDiagnostic {
    /// Une entrée minimale — le message passe par la rédaction.
    #[must_use]
    pub fn nouvelle(niveau: Niveau, source: &str, message: &str) -> Self {
        Self {
            niveau,
            source: String::from(source),
            message: String::from(message),
            detail: None,
        }
    }

    /// Avec un détail déjà sérialisé : tronqué, jamais rejeté.
    #[must_use]
    pub fn avec_detail(mut self, detail: String) -> Self {
        self.detail = Some(tronque(&detail, DETAIL_MAX));
        self
    }

    /// La clé de déduplication : chemin, source, niveau, message — le détail
    /// n'en fait pas partie (deux piles différentes du même message sont la
    /// MÊME erreur qui se répète).
    #[must_use]
    pub fn cle(&self, chemin: &str) -> String {
        format!(
            "{chemin}|{}|{}|{}",
            self.source,
            self.niveau.libelle(),
            self.message
        )
    }
}

/// Tronque à `max` caractères (pas octets : on ne coupe pas un accent en
/// deux).
#[must_use]
pub fn tronque(texte: &str, max: usize) -> String {
    if texte.chars().count() <= max {
        return String::from(texte);
    }
    texte.chars().take(max).collect()
}

/// La ligne écrite dans le fichier — l'instant est **injecté** (millisecondes
/// depuis l'époque), donc testable sans horloge système.
#[must_use]
pub fn ligne_de(entree: &EntreeDiagnostic, maintenant_ms: u64) -> String {
    let at = iso_8601(maintenant_ms);
    // Les identifiants internes (`w1:p2`) n'ont rien à faire dans un message
    // destiné à être lu : le fil les retire déjà des messages d'erreur, on
    // applique la même règle au journal (S13).
    let message = supprime_identifiants(&entree.message);
    match &entree.detail {
        Some(detail) => format!(
            "{at} [{}] [{}] {message} | {detail}\n",
            entree.niveau.libelle(),
            entree.source
        ),
        None => format!(
            "{at} [{}] [{}] {message}\n",
            entree.niveau.libelle(),
            entree.source
        ),
    }
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` — la forme exacte de `toISOString`, sans
/// dépendance d'horodatage (le calcul civil est déterministe et testé).
#[must_use]
pub fn iso_8601(ms: u64) -> String {
    let total_secondes = ms / 1000;
    let millis = ms % 1000;
    let jours = i64::try_from(total_secondes / 86_400).unwrap_or(i64::MAX);
    let reste = total_secondes % 86_400;
    let heures = reste / 3600;
    let minutes = (reste % 3600) / 60;
    let secondes = reste % 60;
    let (annee, mois, jour) = civil_depuis_jours(jours);
    format!("{annee:04}-{mois:02}-{jour:02}T{heures:02}:{minutes:02}:{secondes:02}.{millis:03}Z")
}

/// Le calendrier civil depuis les jours écoulés depuis 1970-01-01 (algorithme
/// de Howard Hinnant) — aucune table, aucune dépendance.
fn civil_depuis_jours(jours: i64) -> (i64, u32, u32) {
    let z = jours + 719_468;
    let epoque = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let jour_epoque = z - epoque * 146_097;
    let annee_epoque =
        (jour_epoque - jour_epoque / 1460 + jour_epoque / 36_524 - jour_epoque / 146_096) / 365;
    let jour_annee = jour_epoque - (365 * annee_epoque + annee_epoque / 4 - annee_epoque / 100);
    let mois_epoque = (5 * jour_annee + 2) / 153;
    let jour = u32::try_from(jour_annee - (153 * mois_epoque + 2) / 5 + 1).unwrap_or(1);
    let mois = u32::try_from(if mois_epoque < 10 {
        mois_epoque + 3
    } else {
        mois_epoque - 9
    })
    .unwrap_or(1);
    let annee = annee_epoque + epoque * 400 + i64::from(mois <= 2);
    (annee, mois, jour)
}

/// L'anti-répétition (S12) : le même message, du même chemin, au même niveau,
/// dans la fenêtre de 60 s, n'est écrit **qu'une fois**.
///
/// ⚠️ Sans cela, une erreur qui se reproduit à chaque interrogation (une
/// session manquante toutes les deux secondes) noie le journal et les vraies
/// erreurs disparaissent dedans.
///
/// ⚠️ La fenêtre est **glissante** : chaque répétition repousse l'échéance,
/// donc une erreur continue reste silencieuse tant qu'elle continue — c'est
/// le comportement du fil, et c'est celui qu'on veut.
#[derive(Debug, Default)]
pub struct AntiRepetition {
    dernier: HashMap<String, u64>,
    supprimees: HashMap<String, u64>,
}

impl AntiRepetition {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Faut-il écrire cette entrée ? `Some(n)` quand elle passe (avec le
    /// nombre de répétitions supprimées depuis la dernière écriture),
    /// `None` quand elle est supprimée.
    pub fn autorise(&mut self, cle: &str, maintenant_ms: u64, fenetre_ms: u64) -> Option<u64> {
        match self.dernier.get(cle) {
            Some(precedent) if maintenant_ms.saturating_sub(*precedent) < fenetre_ms => {
                self.dernier.insert(String::from(cle), maintenant_ms);
                *self.supprimees.entry(String::from(cle)).or_insert(0) += 1;
                None
            }
            _ => {
                self.dernier.insert(String::from(cle), maintenant_ms);
                Some(self.supprimees.remove(cle).unwrap_or(0))
            }
        }
    }

    /// Le nombre de répétitions supprimées pour une clé — la vérification des
    /// tests, jamais écrite dans le fichier.
    #[must_use]
    pub fn supprimees(&self, cle: &str) -> u64 {
        self.supprimees.get(cle).copied().unwrap_or(0)
    }
}

/// Le puits de diagnostics — **il ne rend rien**. Un journal en panne ne peut
/// donc pas changer l'issue d'une commande (T055).
pub trait SinkDiagnostic: Send + Sync {
    fn ecrit(&self, entree: &EntreeDiagnostic);
}

/// Le puits muet — les tests et les binaires sans journal.
pub struct SinkMuet;

impl SinkDiagnostic for SinkMuet {
    fn ecrit(&self, _entree: &EntreeDiagnostic) {}
}

/// L'anti-répétition partagée d'un puits — la mémoire est par CHEMIN, pour
/// que deux instances (ou deux tests) ne se masquent pas l'une l'autre.
#[derive(Debug, Default)]
pub struct MemoireAntiRepetition {
    par_chemin: Mutex<HashMap<String, AntiRepetition>>,
}

impl MemoireAntiRepetition {
    /// La décision pour un chemin donné.
    pub fn autorise(
        &self,
        chemin: &str,
        cle: &str,
        maintenant_ms: u64,
        fenetre_ms: u64,
    ) -> Option<u64> {
        let mut par_chemin = self
            .par_chemin
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        par_chemin
            .entry(String::from(chemin))
            .or_default()
            .autorise(cle, maintenant_ms, fenetre_ms)
    }

    /// Les répétitions supprimées d'une clé, pour un chemin.
    #[must_use]
    pub fn supprimees(&self, chemin: &str, cle: &str) -> u64 {
        self.par_chemin
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(chemin)
            .map_or(0, |anti| anti.supprimees(cle))
    }
}

/// La fenêtre de suppression des répétitions — 60 s, valeur du fil.
pub const FENETRE_REPETITION_MS: u64 = 60_000;
