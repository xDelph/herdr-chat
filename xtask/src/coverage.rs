//! `coverage` — la matrice de parité (T064).
//!
//! ⚠️ **Pourquoi une porte, et pas un tableau dans un document.** Une
//! couverture écrite à la main dérive : une capacité « prouvée » dont le test a
//! été renommé, ou déplacé sous `src/`, reste verte dans un document et fausse
//! dans la réalité. Ici la matrice est **vérifiée** : chaque preuve doit
//! nommer un fichier de test qui existe, et **jamais** un fichier de `src/`.
//!
//! ⚠️ **« Prouvée » veut dire « prouvée À TRAVERS LE DÉMON COMPOSÉ ».** L'audit
//! de T064 a trouvé des capacités comptées prouvées sur la seule foi d'un test
//! unitaire d'un composant que le démon n'appelle jamais (livraison push,
//! issues de lancement inatteignables…). Un composant juste mais débranché ne
//! rend aucun service. Le modèle distingue donc quatre statuts :
//!
//! - `proven` — au moins une preuve passe par la composition réelle : le
//!   routeur composé (`crates/http-api/tests/`), le démon assemblé
//!   (`crates/herdrchat/tests/`) ou, pour les corrections du front, les
//!   modules de la PWA (`apps/web/tests/`) ;
//! - `unit-only` — le code est branché dans le démon, mais seule une preuve
//!   de composant existe : la composition n'est pas prouvée ;
//! - `not-wired` — le composant existe (et peut être testé), mais le démon ne
//!   l'appelle pas, ou l'issue est inatteignable en production ;
//! - `pending` — rien n'est livré ni prouvé.
//!
//! Les statuts `unit-only` et `not-wired` exigent un champ `gap` qui dit ce
//! qui manque : un écart non décrit serait un écart caché.
//!
//! ⚠️ **La porte doit pouvoir échouer** : c'est la seule façon de savoir
//! qu'elle regarde quelque chose. Les tests de ce module le prouvent sur des
//! matrices fautives (statut « proven » sans test, preuve seulement unitaire,
//! fichier absent, chemin sous `src/`, identifiant manquant, statut inconnu).

use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

/// Les préfixes dont un test passe par la composition réelle.
pub const PREFIXES_COMPOSES: [&str; 3] = [
    "crates/http-api/tests/",
    "crates/herdrchat/tests/",
    "apps/web/tests/",
];

/// Le statut d'une entrée.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Statut {
    /// Rien n'est encore prouvé : la capacité n'est pas livrée.
    Pending,
    /// Une preuve passe par le démon composé (ou les modules de la PWA).
    Proven,
    /// Branché dans le démon, prouvé seulement au niveau du composant.
    UnitOnly,
    /// Le composant existe mais le démon ne l'appelle pas.
    NotWired,
    /// Un statut écrit que la porte ne connaît pas — toujours un défaut.
    Inconnu,
}

impl Statut {
    fn depuis(texte: Option<&str>) -> Self {
        match texte {
            Some("proven") => Self::Proven,
            Some("unit-only") => Self::UnitOnly,
            Some("not-wired") => Self::NotWired,
            // Un statut absent n'affirme rien : « en attente ».
            Some("pending") | None => Self::Pending,
            Some(_) => Self::Inconnu,
        }
    }
}

/// Une entrée de la matrice : une capacité (ou une correction) et ses preuves.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Entree {
    pub id: String,
    pub statut: Statut,
    /// Les fichiers de test qui prouvent l'entrée — vides = pas de preuve.
    pub preuves: Vec<String>,
    /// Les tests de composant (niveau crate), qui ne prouvent pas la
    /// composition mais documentent le comportement du composant.
    pub preuves_unitaires: Vec<String>,
    /// Ce qui manque pour que l'entrée soit prouvée (exigé hors `proven`/`pending`).
    pub ecart: Option<String>,
    /// Les tâches qui livrent l'entrée (pour savoir qui doit la prouver).
    pub taches: Vec<String>,
    /// Les fichiers de test qui MENTIONNENT l'identifiant — des **candidats**
    /// à examiner, jamais des preuves : un fichier peut nommer un ID sans en
    /// vérifier le comportement.
    pub candidats: Vec<String>,
}

/// Le rapport : les entrées vérifiées et les défauts trouvés.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Rapport {
    pub prouvees: usize,
    pub unitaires: usize,
    pub non_branchees: usize,
    pub en_attente: usize,
    /// Les incohérences : preuve introuvable/interdite, statut inconnu,
    /// « proven » sans preuve composée, écart non décrit, ID manquant.
    pub defauts: Vec<String>,
    /// Les entrées non prouvées, avec leur statut, leurs tâches et l'écart —
    /// la liste du travail.
    pub restantes: Vec<(String, &'static str, Vec<String>, String)>,
    /// Les entrées en attente qui ont au moins un **candidat** à examiner.
    pub avec_candidats: usize,
}

impl Rapport {
    /// La matrice est-elle exploitable ? (aucune preuve cassée)
    #[must_use]
    pub fn est_coherent(&self) -> bool {
        self.defauts.is_empty()
    }

    /// La matrice est-elle COMPLÈTE ? (tout est prouvé par composition et cohérent)
    #[must_use]
    pub fn est_complete(&self) -> bool {
        self.en_attente == 0
            && self.unitaires == 0
            && self.non_branchees == 0
            && self.defauts.is_empty()
    }

    /// Le résumé d'une ligne — ce que la commande imprime.
    #[must_use]
    pub fn resume(&self) -> String {
        format!(
            "couverture : {} prouvée(s) par composition, {} unit-only, {} not-wired, {} en attente ({} avec un candidat à examiner), {} défaut(s)",
            self.prouvees,
            self.unitaires,
            self.non_branchees,
            self.en_attente,
            self.avec_candidats,
            self.defauts.len()
        )
    }
}

fn liste(valeur: &Value, cle: &str) -> Vec<String> {
    valeur
        .get(cle)
        .and_then(Value::as_array)
        .map(|liste| {
            liste
                .iter()
                .filter_map(|element| element.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Lit une entrée du document — `None` si la forme n'est pas celle attendue
/// (un identifiant absent rend l'entrée invérifiable, donc fautive).
fn lit_entree(valeur: &Value) -> Option<Entree> {
    let id = valeur.get("id")?.as_str()?.to_string();
    let statut = Statut::depuis(valeur.get("status").and_then(Value::as_str));
    let taches = if valeur.get("deliverTasks").is_some() {
        liste(valeur, "deliverTasks")
    } else {
        liste(valeur, "tasks")
    };
    Some(Entree {
        id,
        statut,
        preuves: liste(valeur, "tests"),
        preuves_unitaires: liste(valeur, "unitTests"),
        ecart: valeur
            .get("gap")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|texte| !texte.is_empty())
            .map(str::to_string),
        taches,
        candidats: liste(valeur, "candidateTests"),
    })
}

/// Un chemin cité est-il un fichier de test valide ? `Some(défaut)` sinon.
///
/// ⚠️ Un chemin de preuve doit être **un fichier de test** : sous un dossier
/// `tests/`, et jamais sous `src/`. Une preuve qui pointerait du code de
/// production ne prouverait rien.
fn defaut_de_chemin(racine: &Path, id: &str, chemin: &str) -> Option<String> {
    if chemin.contains("src/") {
        return Some(format!("{id} : preuve sous src/ ({chemin}) — interdit"));
    }
    if !chemin.contains("/tests/") && !chemin.starts_with("tests/") {
        return Some(format!("{id} : preuve hors d'un dossier tests/ ({chemin})"));
    }
    if !racine.join(chemin).is_file() {
        return Some(format!("{id} : preuve introuvable ({chemin})"));
    }
    None
}

fn est_composee(chemin: &str) -> bool {
    PREFIXES_COMPOSES
        .iter()
        .any(|prefixe| chemin.starts_with(prefixe))
}

fn nom_statut(statut: Statut) -> &'static str {
    match statut {
        Statut::Pending => "pending",
        Statut::Proven => "proven",
        Statut::UnitOnly => "unit-only",
        Statut::NotWired => "not-wired",
        Statut::Inconnu => "inconnu",
    }
}

/// Vérifie les entrées d'une matrice.
#[must_use]
pub fn verifie(racine: &Path, entrees: &[Entree]) -> Rapport {
    let mut rapport = Rapport {
        prouvees: 0,
        unitaires: 0,
        non_branchees: 0,
        en_attente: 0,
        defauts: Vec::new(),
        restantes: Vec::new(),
        avec_candidats: 0,
    };

    for entree in entrees {
        // Toute référence citée doit exister — une référence cassée est un
        // défaut quel que soit le statut (une preuve « unitaire » introuvable
        // ne documente rien non plus).
        let mut chemins_valides = true;
        for chemin in entree
            .preuves
            .iter()
            .chain(&entree.preuves_unitaires)
            .chain(&entree.candidats)
        {
            if let Some(defaut) = defaut_de_chemin(racine, &entree.id, chemin) {
                rapport.defauts.push(defaut);
                chemins_valides = false;
            }
        }

        match entree.statut {
            Statut::Inconnu => rapport.defauts.push(format!(
                "{} : statut inconnu (attendus : proven, unit-only, not-wired, pending)",
                entree.id
            )),
            Statut::Pending => {
                rapport.en_attente += 1;
                if !entree.candidats.is_empty() {
                    rapport.avec_candidats += 1;
                }
                rapport.restantes.push((
                    entree.id.clone(),
                    "pending",
                    entree.taches.clone(),
                    entree.ecart.clone().unwrap_or_default(),
                ));
            }
            Statut::UnitOnly | Statut::NotWired => {
                if entree.ecart.is_none() {
                    rapport.defauts.push(format!(
                        "{} : statut {} sans champ gap — l'écart doit être décrit",
                        entree.id,
                        nom_statut(entree.statut)
                    ));
                }
                if entree.statut == Statut::UnitOnly {
                    rapport.unitaires += 1;
                } else {
                    rapport.non_branchees += 1;
                }
                rapport.restantes.push((
                    entree.id.clone(),
                    nom_statut(entree.statut),
                    entree.taches.clone(),
                    entree.ecart.clone().unwrap_or_default(),
                ));
            }
            Statut::Proven => {
                // Une preuve annoncée mais non nommée est un défaut, pas un
                // succès silencieux.
                if entree.preuves.is_empty() {
                    rapport.defauts.push(format!(
                        "{} : statut proven sans fichier de test",
                        entree.id
                    ));
                    continue;
                }
                // Une preuve seulement unitaire ne dit pas que le démon
                // rend le service : `proven` exige la composition.
                if !entree.preuves.iter().any(|chemin| est_composee(chemin)) {
                    rapport.defauts.push(format!(
                        "{} : statut proven sans preuve composée (attendu un test sous {}) — marquer unit-only ou not-wired",
                        entree.id,
                        PREFIXES_COMPOSES.join(", ")
                    ));
                    continue;
                }
                if chemins_valides {
                    rapport.prouvees += 1;
                }
            }
        }
    }
    rapport
}

/// Les identifiants que la matrice DOIT contenir (CURRENT.md, TECH §10) :
/// une entrée oubliée serait une capacité qui sort de la porte sans bruit.
#[must_use]
pub fn identifiants_attendus() -> (BTreeSet<String>, BTreeSet<String>) {
    let mut capacites = BTreeSet::new();
    for (prefixe, nombre) in [
        ("H", 23),
        ("D", 22),
        ("A", 15),
        ("E", 10),
        ("S", 14),
        ("O", 10),
    ] {
        for numero in 1..=nombre {
            capacites.insert(format!("{prefixe}{numero:02}"));
        }
    }
    let corrections = (1..=27).map(|numero| format!("C{numero:02}")).collect();
    (capacites, corrections)
}

/// Charge le document, vérifie chaque entrée, et rend le rapport.
///
/// `exige_inventaire` : les 94 capacités et 27 corrections doivent toutes
/// être présentes (le document réel) ; les matrices synthétiques des tests le
/// désactivent.
pub fn verifie_document_avec(
    racine: &Path,
    document: &Value,
    exige_inventaire: bool,
) -> Result<Rapport, String> {
    let mut entrees = Vec::new();
    let mut identifiants = BTreeSet::new();
    let mut par_cle: Vec<BTreeSet<String>> = Vec::new();
    for cle in ["capabilities", "corrections"] {
        let liste = document
            .get(cle)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("{cle} : liste absente de compatibility/coverage.json"))?;
        let mut ids = BTreeSet::new();
        for valeur in liste {
            let entree =
                lit_entree(valeur).ok_or_else(|| format!("{cle} : entrée sans identifiant"))?;
            if !identifiants.insert(entree.id.clone()) {
                return Err(format!("identifiant en double : {}", entree.id));
            }
            ids.insert(entree.id.clone());
            entrees.push(entree);
        }
        par_cle.push(ids);
    }
    let mut rapport = verifie(racine, &entrees);
    if exige_inventaire {
        let (capacites, corrections) = identifiants_attendus();
        for (attendus, presents, cle) in [
            (&capacites, &par_cle[0], "capabilities"),
            (&corrections, &par_cle[1], "corrections"),
        ] {
            for manquant in attendus.difference(presents) {
                rapport
                    .defauts
                    .push(format!("{manquant} : identifiant absent de {cle}"));
            }
            for inattendu in presents.difference(attendus) {
                rapport
                    .defauts
                    .push(format!("{inattendu} : identifiant inconnu dans {cle}"));
            }
        }
    }
    Ok(rapport)
}

/// Charge une matrice synthétique (sans exigence d'inventaire complet).
pub fn verifie_document(racine: &Path, document: &Value) -> Result<Rapport, String> {
    verifie_document_avec(racine, document, false)
}

/// Les items à re-marquer après intégration d'autres lots (`todoAfterMerge`).
#[must_use]
pub fn a_remarquer(document: &Value) -> Vec<String> {
    document
        .get("todoAfterMerge")
        .and_then(Value::as_array)
        .map(|liste| {
            liste
                .iter()
                .map(|item| {
                    let ids = liste_texte(item, "ids");
                    let note = item.get("note").and_then(Value::as_str).unwrap_or_default();
                    format!("{ids} — {note}")
                })
                .collect()
        })
        .unwrap_or_default()
}

fn liste_texte(valeur: &Value, cle: &str) -> String {
    liste(valeur, cle).join(", ")
}

/// La porte telle que `xtask verify` l'appelle : le document réel, inventaire
/// complet exigé, aucun défaut toléré.
pub fn porte(racine: &Path) -> Result<Rapport, String> {
    let chemin = racine.join("compatibility/coverage.json");
    let texte = std::fs::read_to_string(&chemin)
        .map_err(|cause| format!("lecture de {} : {cause}", chemin.display()))?;
    let document: Value = serde_json::from_str(&texte)
        .map_err(|cause| format!("{} n'est pas du JSON : {cause}", chemin.display()))?;
    verifie_document_avec(racine, &document, true)
}
