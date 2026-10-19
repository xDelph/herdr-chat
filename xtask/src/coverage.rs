//! `coverage` — la matrice de parité (T064).
//!
//! ⚠️ **Pourquoi une porte, et pas un tableau dans un document.** Une
//! couverture écrite à la main dérive : une capacité « prouvée » dont le test a
//! été renommé, ou déplacé sous `src/`, reste verte dans un document et fausse
//! dans la réalité. Ici la matrice est **vérifiée** : chaque preuve doit
//! nommer un fichier de test qui existe, et **jamais** un fichier de `src/`.
//!
//! ⚠️ **La porte doit pouvoir échouer** : c'est la seule façon de savoir
//! qu'elle regarde quelque chose. Les tests de ce module le prouvent sur des
//! matrices fautives (statut « proven » sans test, fichier absent, chemin sous
//! `src/`, identifiant manquant).

use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

/// Le statut d'une preuve.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Statut {
    /// Rien n'est encore prouvé : la capacité est livrée sans preuve exécutée.
    Pending,
    /// Une preuve exécutée est nommée et existe.
    Proven,
}

/// Une entrée de la matrice : une capacité (ou une correction) et ses preuves.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Entree {
    pub id: String,
    pub statut: Statut,
    /// Les fichiers de test qui prouvent l'entrée — vides = pas de preuve.
    pub preuves: Vec<String>,
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
    pub en_attente: usize,
    /// Les entrées « proven » dont la preuve est introuvable ou interdite.
    pub defauts: Vec<String>,
    /// Les entrées encore en attente, avec leurs tâches — la liste du travail.
    pub restantes: Vec<(String, Vec<String>)>,
    /// Les entrées en attente qui ont au moins un **candidat** à examiner.
    pub avec_candidats: usize,
}

impl Rapport {
    /// La matrice est-elle exploitable ? (aucune preuve cassée)
    #[must_use]
    pub fn est_coherent(&self) -> bool {
        self.defauts.is_empty()
    }

    /// La matrice est-elle COMPLÈTE ? (tout est prouvé et cohérent)
    #[must_use]
    pub fn est_complete(&self) -> bool {
        self.en_attente == 0 && self.defauts.is_empty()
    }

    /// Le résumé d'une ligne — ce que la commande imprime.
    #[must_use]
    pub fn resume(&self) -> String {
        format!(
            "couverture : {} prouvée(s), {} en attente ({} avec un candidat à examiner), {} défaut(s)",
            self.prouvees,
            self.en_attente,
            self.avec_candidats,
            self.defauts.len()
        )
    }
}

/// Lit une entrée du document — `None` si la forme n'est pas celle attendue
/// (un identifiant absent rend l'entrée invérifiable, donc fautive).
fn lit_entree(valeur: &Value) -> Option<Entree> {
    let id = valeur.get("id")?.as_str()?.to_string();
    let statut = match valeur.get("status").and_then(Value::as_str) {
        Some("proven") => Statut::Proven,
        // Tout le reste (y compris `pending`, absent ou inconnu) est « en
        // attente » : on ne suppose jamais qu'une preuve existe.
        _ => Statut::Pending,
    };
    let preuves = valeur
        .get("tests")
        .and_then(Value::as_array)
        .map(|liste| {
            liste
                .iter()
                .filter_map(|element| element.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let candidats = valeur
        .get("candidateTests")
        .and_then(Value::as_array)
        .map(|liste| {
            liste
                .iter()
                .filter_map(|element| element.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let taches = valeur
        .get("deliverTasks")
        .or_else(|| valeur.get("tasks"))
        .and_then(Value::as_array)
        .map(|liste| {
            liste
                .iter()
                .filter_map(|element| element.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    Some(Entree {
        id,
        statut,
        preuves,
        taches,
        candidats,
    })
}

/// Vérifie les entrées d'une matrice.
///
/// ⚠️ Un chemin de preuve doit être **un fichier de test** : sous un dossier
/// `tests/`, et jamais sous `src/`. Une preuve qui pointerait du code de
/// production ne prouverait rien.
#[must_use]
pub fn verifie(racine: &Path, entrees: &[Entree]) -> Rapport {
    let mut prouvees = 0;
    let mut en_attente = 0;
    let mut defauts = Vec::new();
    let mut restantes = Vec::new();
    let mut avec_candidats = 0;

    for entree in entrees {
        match entree.statut {
            Statut::Pending => {
                en_attente += 1;
                if !entree.candidats.is_empty() {
                    avec_candidats += 1;
                }
                restantes.push((entree.id.clone(), entree.taches.clone()));
            }
            Statut::Proven => {
                // Une preuve annoncée mais non nommée est un défaut, pas un
                // succès silencieux.
                if entree.preuves.is_empty() {
                    defauts.push(format!(
                        "{} : statut proven sans fichier de test",
                        entree.id
                    ));
                    continue;
                }
                let mut entree_valide = true;
                for preuve in &entree.preuves {
                    if preuve.contains("src/") {
                        defauts.push(format!(
                            "{} : preuve sous src/ ({preuve}) — interdit",
                            entree.id
                        ));
                        entree_valide = false;
                        continue;
                    }
                    if !preuve.contains("/tests/") && !preuve.starts_with("tests/") {
                        defauts.push(format!(
                            "{} : preuve hors d'un dossier tests/ ({preuve})",
                            entree.id
                        ));
                        entree_valide = false;
                        continue;
                    }
                    if !racine.join(preuve).is_file() {
                        defauts.push(format!("{} : preuve introuvable ({preuve})", entree.id));
                        entree_valide = false;
                    }
                }
                if entree_valide {
                    prouvees += 1;
                }
            }
        }
    }

    Rapport {
        prouvees,
        en_attente,
        defauts,
        restantes,
        avec_candidats,
    }
}

/// Charge le document, vérifie chaque entrée, et rend le rapport.
pub fn verifie_document(racine: &Path, document: &Value) -> Result<Rapport, String> {
    let mut entrees = Vec::new();
    let mut identifiants = BTreeSet::new();
    for cle in ["capabilities", "corrections"] {
        let liste = document
            .get(cle)
            .and_then(Value::as_array)
            .ok_or_else(|| format!("{cle} : liste absente de compatibility/coverage.json"))?;
        for valeur in liste {
            let entree =
                lit_entree(valeur).ok_or_else(|| format!("{cle} : entrée sans identifiant"))?;
            if !identifiants.insert(entree.id.clone()) {
                return Err(format!("identifiant en double : {}", entree.id));
            }
            entrees.push(entree);
        }
    }
    Ok(verifie(racine, &entrees))
}
