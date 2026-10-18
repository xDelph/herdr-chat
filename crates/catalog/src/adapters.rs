//! Les adaptateurs de catalogues (T029) — **un par kind, chacun portant sa
//! mesure** ; les parseurs sont **purs** (testables sans aucun CLI), et le
//! kind absent est une **absence explicite**, pas une liste inventée.
//!
//! | kind    | liste                          | niveaux                       |
//! |---------|--------------------------------|-------------------------------|
//! | `pi`    | `pi --list-models` (tabulaire) | colonne `thinking`            |
//! | `claude`| alias du CLI (jamais énuméré hors session) | `low..max`        |
//! | `codex` | `codex debug models` (JSON)    | `supported_reasoning_levels` par modèle |
//! | `cursor`| `cursor-agent --list-models`   | **dans le nom — rien à part** |
//! | `devin` | `devin models list --format json` | **dans le nom du variant — rien à part** |

use crate::process::{Annulation, DELAI_PROCESS, execute};
use serde_json::Value;

/// Un modèle du catalogue, avant validation par le contrat.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ModeleCatalogue {
    pub id: String,
    /// Le libellé lisible — absent quand la source n'en porte pas (jamais
    /// inventé).
    pub libelle: Option<String>,
    pub niveaux: Vec<String>,
}

/// Le résultat d'un catalogue — l'erreur est **déclarée** (jamais
/// silencieuse), les listes vides sont des vides mesurés.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ResultatCatalogue {
    pub erreur: Option<String>,
    pub modeles: Vec<ModeleCatalogue>,
    pub source: String,
    pub niveaux: Vec<String>,
}

/// Les niveaux de raisonnement de pi — mesurés (`pi --list-models`).
const NIVEAUX_PI: [&str; 7] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/// Les efforts de `--effort` claude — obtenus par une erreur d'argument
/// mesurée.
const NIVEAUX_CLAUDE: [&str; 4] = ["low", "medium", "high", "max"];

/// Les alias documentés par le CLI claude lui-même.
const ALIAS_CLAUDE: [&str; 4] = ["default", "sonnet", "opus", "haiku"];

/// Découpe sur **2+ espaces** : le nom peut contenir un espace interne
/// (`Anthropic: Claude Opus 5`) — un découpage naïf le casserait.
fn colonnes_de(ligne: &str) -> Vec<String> {
    let mut colonnes = Vec::new();
    let mut courant = String::new();
    let mut espaces = 0_usize;
    for caractere in ligne.chars() {
        if caractere == ' ' {
            espaces += 1;
        } else {
            if espaces >= 2 && !courant.is_empty() {
                colonnes.push(courant.clone());
                courant.clear();
            } else if espaces > 0 && !courant.is_empty() {
                courant.push(' ');
            } else if espaces > 0 && courant.is_empty() && !colonnes.is_empty() {
                // un espace simple au sein d'une colonne
            }
            espaces = 0;
            courant.push(caractere);
        }
    }
    if !courant.is_empty() {
        colonnes.push(courant);
    }
    colonnes
}

/// Un élément unique, dans l'ordre — les niveaux se dédupliquent sans
/// réordonner.
fn uniques(valeurs: Vec<String>) -> Vec<String> {
    let mut uniques: Vec<String> = Vec::new();
    for valeur in valeurs {
        if !uniques.contains(&valeur) {
            uniques.push(valeur);
        }
    }
    uniques
}

/// pi — la sortie tabulaire : `provider · model · context · max-out ·
/// thinking · images` ; le `model` porte déjà `provider/model` (ou
/// `~provider/model` pour les latest) — ce que `--model` attend.
#[must_use]
pub fn parse_pi(sortie: &str) -> Vec<ModeleCatalogue> {
    let mut modeles = Vec::new();
    for ligne in sortie.lines() {
        let ligne = ligne.trim();
        // La première ligne est l'en-tête — elle ne décrit aucun modèle.
        if ligne.is_empty()
            || (ligne.starts_with("provider")
                && ligne.contains("model")
                && ligne.contains("context"))
        {
            continue;
        }
        let colonnes = colonnes_de(ligne);
        let Some(id) = colonnes.get(1) else { continue };
        let id = id.as_str();
        if id.is_empty() {
            continue;
        }
        // La colonne `thinking` annonce la CAPACITÉ, pas le niveau courant.
        let supporte = colonnes.get(4).is_some_and(|colonne| *colonne == "yes");
        modeles.push(ModeleCatalogue {
            id: format!(
                "{}/{id}",
                colonnes.first().map(String::as_str).unwrap_or("")
            )
            .replace("~/", ""),
            libelle: None, // le tableau de pi ne porte aucun libellé : on ne l'invente pas
            niveaux: if supporte {
                NIVEAUX_PI.map(str::to_string).to_vec()
            } else {
                Vec::new()
            },
        });
    }
    modeles
}

/// Claude — **alias documentés par le CLI lui-même** : aucune commande ne
/// liste les modèles sans être authentifié (`claude models` → « Not logged
/// in », mesuré) — la limitation est DITE, pas cachée.
#[must_use]
pub fn parse_claude() -> ResultatCatalogue {
    ResultatCatalogue {
        erreur: Some(String::from(
            "claude does not list its models outside an authenticated session: only the CLI aliases are offered",
        )),
        modeles: ALIAS_CLAUDE
            .iter()
            .map(|alias| ModeleCatalogue {
                id: alias.to_string(),
                libelle: None,
                niveaux: NIVEAUX_CLAUDE.map(str::to_string).to_vec(),
            })
            .collect(),
        source: String::from("claude --help (documented aliases)"),
        niveaux: NIVEAUX_CLAUDE.map(str::to_string).to_vec(),
    }
}

/// codex — le catalogue JSON avec `supported_reasoning_levels` **par
/// modèle** : la source la plus fidèle — elle donne « quel niveau pour quel
/// modèle » sans rien déduire.
pub fn parse_codex(sortie: &str) -> Result<Vec<ModeleCatalogue>, String> {
    let brut: Value =
        serde_json::from_str(sortie).map_err(|cause| format!("JSON illisible : {cause}"))?;
    let modeles = brut
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| String::from("unexpected shape: no usable `models` array"))?;
    let mut rendus = Vec::new();
    for modele in modeles {
        let slug = modele
            .get("slug")
            .and_then(Value::as_str)
            .ok_or_else(|| String::from("unexpected shape: model without slug"))?;
        let niveaux = modele
            .get("supported_reasoning_levels")
            .and_then(Value::as_array)
            .map(|niveaux| {
                uniques(
                    niveaux
                        .iter()
                        .filter_map(|niveau| {
                            niveau
                                .get("effort")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .collect(),
                )
            })
            .unwrap_or_default();
        rendus.push(ModeleCatalogue {
            id: slug.to_string(),
            libelle: modele
                .get("display_name")
                .and_then(Value::as_str)
                .map(str::to_string),
            niveaux,
        });
    }
    if rendus.is_empty() {
        return Err(String::from("empty catalog"));
    }
    Ok(rendus)
}

/// cursor — **aucun paramètre de raisonnement séparé** : le niveau est
/// encodé dans le nom (`gpt-5.6-sol-high`) ; on ne fabrique donc AUCUN
/// `thinkingLevels` ici — le choisir, c'est choisir un autre modèle.
#[must_use]
pub fn parse_cursor(sortie: &str) -> Vec<ModeleCatalogue> {
    let mut modeles = Vec::new();
    for ligne in sortie.lines() {
        let ligne = ligne.trim();
        // La forme `id - label` : l'identifiant = [\w.-]+ avant le premier
        // « - » entouré d'espaces.
        let Some(position) = ligne.find(" - ") else {
            continue;
        };
        let id = ligne[..position].trim();
        if id.is_empty() || !id.chars().all(|c| c.is_alphanumeric() || "-._".contains(c)) {
            continue;
        }
        let libelle = ligne[position + 3..].trim().to_string();
        modeles.push(ModeleCatalogue {
            id: id.to_string(),
            libelle: Some(libelle),
            // Le niveau est dans le nom : RIEN à proposer séparément.
            niveaux: Vec::new(),
        });
    }
    modeles
}

/// devin — **`--format json` et non la sortie texte** (le CLI l'écrit
/// lui-même : « Machine-readable JSON ») ; ⚠️ **le modèle est le VARIANT,
/// pas la famille** : `--model` attend `swe-1-6-slow`, pas `swe-1.6-slow` —
/// prendre le slug de famille enverrait un nom que le CLI refuse.
#[must_use]
pub fn parse_devin(sortie: &str) -> Vec<ModeleCatalogue> {
    let brut: Value = match serde_json::from_str(sortie) {
        Ok(brut) => brut,
        // Un catalogue illisible se REFUSE : il ne se devine pas.
        Err(_) => return Vec::new(),
    };
    let mut modeles = Vec::new();
    for famille in brut
        .get("families")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        for variant in famille
            .get("variants")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            let identifiant = variant.get("model_uid").and_then(Value::as_str);
            let Some(identifiant) = identifiant else {
                continue;
            };
            if identifiant.is_empty() {
                continue;
            }
            modeles.push(ModeleCatalogue {
                id: identifiant.to_string(),
                libelle: variant
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                // Le niveau vit dans le nom : rien à proposer séparément.
                niveaux: Vec::new(),
            });
        }
    }
    modeles
}

/// Un adaptateur : le genre, la commande **fixe** de production, la source
/// nommée, le parseur pur.
#[derive(Clone, Copy)]
pub struct Adaptateur {
    pub genre: &'static str,
    pub commande: &'static [&'static str],
    pub source: &'static str,
    pub parseur: Parseur,
}

/// Le parseur d'un adaptateur — chaque forme a le sien.
#[derive(Clone, Copy)]
pub enum Parseur {
    TabulairePi,
    ClaudeAlias,
    CodexJson,
    CursorListe,
    DevinJson,
}

/// Les cinq adaptateurs de production — les commandes à argv fixe.
pub const ADAPTATEURS: [Adaptateur; 5] = [
    Adaptateur {
        genre: "pi",
        commande: &["pi", "--list-models"],
        source: "pi --list-models",
        parseur: Parseur::TabulairePi,
    },
    Adaptateur {
        genre: "claude",
        commande: &["claude"],
        source: "claude --help (documented aliases)",
        parseur: Parseur::ClaudeAlias,
    },
    Adaptateur {
        genre: "codex",
        commande: &["codex", "debug", "models"],
        source: "codex debug models",
        parseur: Parseur::CodexJson,
    },
    Adaptateur {
        genre: "cursor",
        commande: &["cursor-agent", "--list-models"],
        source: "cursor-agent --list-models",
        parseur: Parseur::CursorListe,
    },
    Adaptateur {
        genre: "devin",
        commande: &["devin", "models", "list", "--format", "json"],
        source: "devin models list --format json",
        parseur: Parseur::DevinJson,
    },
];

/// L'adaptateur d'un kind — **`None` pour un kind absent de la table** : ce
/// n'est pas un bug, c'est la déclaration qu'on ne sait pas encore lister ses
/// modèles (l'API rend alors `models: []` avec la raison — l'interface
/// affiche l'absence au lieu d'inventer).
#[must_use]
pub fn adaptateur_de(genre: &str) -> Option<&'static Adaptateur> {
    ADAPTATEURS
        .iter()
        .find(|adaptateur| adaptateur.genre == genre)
}

/// Le catalogue d'un kind — via l'exécuteur borné (T028), avec les limites
/// mesurées ; pour un kind hors table : l'**absence explicite**.
pub fn catalogue_de(genre: &str) -> ResultatCatalogue {
    match adaptateur_de(genre) {
        None => ResultatCatalogue {
            erreur: Some(format!(
                "kind {genre} : pas de catalogue connu — rien n'est inventé"
            )),
            modeles: Vec::new(),
            source: format!("aucun adaptateur pour {genre}"),
            niveaux: Vec::new(),
        },
        Some(adaptateur) => catalogue_d_adaptateur(
            adaptateur,
            &adaptateur
                .commande
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<String>>(),
        ),
    }
}

/// Le catalogue d'un adaptateur avec une commande INJECTÉE — les tests
/// passent par des exécutables factices (jamais de CLI d'agent réel).
pub fn catalogue_d_adaptateur(adaptateur: &Adaptateur, commande: &[String]) -> ResultatCatalogue {
    let argv: Vec<&str> = commande.iter().map(String::as_str).collect();
    match execute(&argv, DELAI_PROCESS, &Annulation::nouveau()) {
        Err(cause) => ResultatCatalogue {
            erreur: Some(cause.to_string()),
            modeles: Vec::new(),
            source: adaptateur.source.to_string(),
            niveaux: Vec::new(),
        },
        Ok(resultat) => {
            // ⚠️ Jamais stderr comme sortie : une CLI qui écrit un
            // avertissement ne produit pas un catalogue fait de son
            // avertissement. Un code non-nul est un échec déclaré.
            if resultat.code != Some(0) {
                return ResultatCatalogue {
                    erreur: Some(format!(
                        "code de sortie {} : {}",
                        resultat
                            .code
                            .map(|c| c.to_string())
                            .unwrap_or_else(|| String::from("signal")),
                        String::from_utf8_lossy(&resultat.erreur).trim()
                    )),
                    modeles: Vec::new(),
                    source: adaptateur.source.to_string(),
                    niveaux: Vec::new(),
                };
            }
            let sortie = String::from_utf8_lossy(&resultat.sortie);
            match adaptateur.parseur {
                Parseur::ClaudeAlias => parse_claude(),
                Parseur::CodexJson => match parse_codex(&sortie) {
                    Ok(modeles) => ResultatCatalogue {
                        erreur: None,
                        niveaux: uniques(
                            modeles
                                .iter()
                                .flat_map(|modele| modele.niveaux.clone())
                                .collect(),
                        ),
                        modeles,
                        source: adaptateur.source.to_string(),
                    },
                    Err(erreur) => ResultatCatalogue {
                        erreur: Some(erreur),
                        modeles: Vec::new(),
                        source: adaptateur.source.to_string(),
                        niveaux: Vec::new(),
                    },
                },
                Parseur::TabulairePi => {
                    let modeles = parse_pi(&sortie);
                    if modeles.is_empty() {
                        ResultatCatalogue {
                            erreur: Some(String::from("empty or unreadable output")),
                            modeles: Vec::new(),
                            source: adaptateur.source.to_string(),
                            niveaux: Vec::new(),
                        }
                    } else {
                        ResultatCatalogue {
                            erreur: None,
                            niveaux: NIVEAUX_PI.map(str::to_string).to_vec(),
                            modeles,
                            source: adaptateur.source.to_string(),
                        }
                    }
                }
                Parseur::CursorListe => {
                    let modeles = parse_cursor(&sortie);
                    if modeles.is_empty() {
                        ResultatCatalogue {
                            erreur: Some(String::from("empty or unreadable list")),
                            modeles: Vec::new(),
                            source: adaptateur.source.to_string(),
                            niveaux: Vec::new(),
                        }
                    } else {
                        ResultatCatalogue {
                            erreur: None,
                            modeles,
                            // Le niveau est dans le nom : rien à proposer.
                            niveaux: Vec::new(),
                            source: adaptateur.source.to_string(),
                        }
                    }
                }
                Parseur::DevinJson => {
                    let modeles = parse_devin(&sortie);
                    if modeles.is_empty() {
                        ResultatCatalogue {
                            erreur: Some(String::from("empty or unreadable list")),
                            modeles: Vec::new(),
                            source: adaptateur.source.to_string(),
                            niveaux: Vec::new(),
                        }
                    } else {
                        ResultatCatalogue {
                            erreur: None,
                            modeles,
                            // Le niveau est dans le nom du variant.
                            niveaux: Vec::new(),
                            source: adaptateur.source.to_string(),
                        }
                    }
                }
            }
        }
    }
}
