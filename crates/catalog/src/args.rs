//! Les profils d'args de lancement (T030) — **le vocabulaire est celui de
//! l'agent**, et nulle part ailleurs : Herdr ne fait que retransmettre `args`
//! au binaire (vérifié par exécution).
//!
//! | kind    | modèle            | raisonnement                             |
//! |---------|-------------------|------------------------------------------|
//! | `pi`    | `--model <id>`    | `--thinking <niveau>`                    |
//! | `claude`| `--model <alias>` | `--effort <niveau>`                      |
//! | `codex` | `-m <id>`         | `--config model_reasoning_effort="<n>"`  |
//! | `cursor`| `--model <id>`    | **aucun** : le niveau est dans le nom    |
//!
//! ⚠️ Un `thinking` demandé que le kind ne sait pas transmettre est **refusé**
//! — mieux vaut un refus explicite qu'un agent lancé avec une option qu'il
//! ignore en silence.
//!
//! ⚠️ **Le fournisseur (`provider` de `LaunchAgentRequest`) n'a jamais été
//! consommé par le lancement** — il reste **explicitement non appliqué**
//! (`fournisseur_applique = false`), jamais présenté comme appliqué.

/// Le résultat de la construction : des args et/ou une raison de refus.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct OutcomeArgs {
    pub args: Vec<String>,
    pub erreur: Option<String>,
    /// **Historiquement faux, et dit** : le champ `provider` de la demande
    /// n'a jamais été consommé par le lancement — il n'apparaît jamais dans
    /// `args`, et rien ne le présente comme appliqué.
    pub fournisseur_applique: bool,
}

/// Kinds dont on sait construire des args de modèle/raisonnement.
pub const KINDS_MODEL_AWARE: [&str; 4] = ["pi", "claude", "codex", "cursor"];

/// Construit les args de modèle et de raisonnement.
///
/// ⚠️ Un `thinking` **sans modèle** : on ne devine pas quel modèle appliquer —
/// claude seul l'autorise (effort indépendant) ; les autres refusent.
#[must_use]
pub fn construit_args(kind: &str, modele: Option<&str>, thinking: Option<&str>) -> OutcomeArgs {
    let has_model = modele.is_some_and(|m| !m.trim().is_empty());
    let has_thinking = thinking.is_some_and(|t| !t.trim().is_empty());
    let niveau = thinking.map(str::trim).filter(|t| !t.is_empty());
    let cible = modele.map(str::trim).filter(|m| !m.is_empty());
    OutcomeArgs {
        args: Vec::new(),
        erreur: None,
        fournisseur_applique: false,
    }
    .puis_si(has_model || has_thinking, || {
        match (has_model, cible, has_thinking, niveau) {
            // Aucun modèle demandé, mais un raisonnement : claude seul
            // l'applique seul ; les autres ne devinent pas de modèle.
            (false, _, true, Some(level)) if kind == "claude" => OutcomeArgs {
                args: vec![String::from("--effort"), level.to_string()],
                erreur: None,
                fournisseur_applique: false,
            },
            (false, _, true, Some(level)) => OutcomeArgs {
                args: Vec::new(),
                erreur: Some(format!("“{kind}” requires a model to choose a reasoning level (demanded: {level})")),
                fournisseur_applique: false,
            },
            (true, Some(model_id), ..) => match kind {
                "pi" => OutcomeArgs {
                    args: drapeaux("--model", model_id, "--thinking", niveau),
                    erreur: None,
                    fournisseur_applique: false,
                },
                "claude" => OutcomeArgs {
                    args: drapeaux("--model", model_id, "--effort", niveau),
                    erreur: None,
                    fournisseur_applique: false,
                },
                "codex" => OutcomeArgs {
                    // La forme canonique du CLI : `-m` + `--config key=value`.
                    args: {
                        let mut args = vec![String::from("-m"), model_id.to_string()];
                        if let Some(level) = niveau {
                            args.push(String::from("--config"));
                            args.push(format!("model_reasoning_effort=\"{level}\""));
                        }
                        args
                    },
                    erreur: None,
                    fournisseur_applique: false,
                },
                "cursor" => {
                    // ⚠️ Le niveau est encodé dans le NOM du modèle : envoyer
                    // un niveau ici produirait une option inconnue.
                    if niveau.is_some() {
                        OutcomeArgs {
                            args: vec![String::from("--model"), model_id.to_string()],
                            erreur: Some(String::from(
                                "with cursor the reasoning level is part of the model name: pick a model that includes it",
                            )),
                            fournisseur_applique: false,
                        }
                    } else {
                        OutcomeArgs {
                            args: vec![String::from("--model"), model_id.to_string()],
                            erreur: None,
                            fournisseur_applique: false,
                        }
                    }
                }
                _ => OutcomeArgs {
                    args: Vec::new(),
                    erreur: Some(format!("no verified launch mechanism for “{kind}”")),
                    fournisseur_applique: false,
                },
            },
            _ => OutcomeArgs { args: Vec::new(), erreur: None, fournisseur_applique: false },
        }
    })
}

fn drapeaux(
    drapeau_modele: &str,
    modele: &str,
    drapeau_niveau: &str,
    niveau: Option<&str>,
) -> Vec<String> {
    let mut args = vec![drapeau_modele.to_string(), modele.to_string()];
    if let Some(niveau) = niveau {
        args.push(drapeau_niveau.to_string());
        args.push(niveau.to_string());
    }
    args
}

impl OutcomeArgs {
    fn puis_si(self, condition: bool, suite: impl FnOnce() -> Self) -> Self {
        if condition { suite() } else { self }
    }
}

/// Vérifie qu'un niveau demandé est bien **supporté par le modèle choisi** —
/// on ne s'appuie que sur ce que l'agent DÉCLARE : un `thinkingLevels` vide
/// = « je ne le sais pas », et on laisse passer ; un modèle absent du
/// catalogue : on ne tranche pas à sa place.
#[must_use]
pub fn niveau_supporte(
    kind: &str,
    modele: &str,
    thinking: &str,
    catalogue: &[crate::adapters::ModeleCatalogue],
) -> Option<String> {
    if thinking.trim().is_empty() {
        return None;
    }
    if !KINDS_MODEL_AWARE.contains(&kind) {
        return Some(format!("“{kind}”: unverified reasoning level"));
    }
    let trouve = catalogue.iter().find(|candidat| candidat.id == modele);
    match trouve {
        // Modèle absent du catalogue : on ne tranche pas à sa place.
        None => None,
        Some(trouve) => {
            if trouve.niveaux.is_empty() || trouve.niveaux.contains(&thinking.trim().to_string()) {
                None
            } else {
                Some(format!(
                    "“{modele}” does not offer the level “{}” (available: {})",
                    thinking.trim(),
                    trouve.niveaux.join(", ")
                ))
            }
        }
    }
}

/// La validation COMPLÈTE d'une demande de lancement : les args
/// ([`construit_args`]) PUIS le niveau de raisonnement contre le catalogue
/// mesuré du kind ([`niveau_supporte`]) — l'ordre du fil (`buildModelArgs`
/// puis `checkThinkingSupported`).
///
/// ⚠️ **`niveau_supporte` n'avait aucun appelant** : un niveau que le modèle
/// n'offre pas (« xhigh » sur un modèle qui s'arrête à « high ») était lancé
/// quand même, et l'agent démarrait avec une option qu'il refuse ou ignore.
/// Le refus tombe ici, AVANT tout onglet (C07).
///
/// Le catalogue n'est demandé que si un modèle ET un niveau sont donnés ; un
/// catalogue indisponible (liste vide) ne tranche pas à la place de l'agent.
pub fn args_verifies(
    kind: &str,
    modele: Option<&str>,
    thinking: Option<&str>,
    catalogue: impl FnOnce(&str) -> Vec<crate::adapters::ModeleCatalogue>,
) -> Result<Vec<String>, String> {
    let issue = construit_args(kind, modele, thinking);
    if let Some(erreur) = issue.erreur {
        return Err(erreur);
    }
    let modele = modele.map(str::trim).filter(|m| !m.is_empty());
    let niveau = thinking.map(str::trim).filter(|t| !t.is_empty());
    if let (Some(modele), Some(niveau)) = (modele, niveau)
        && let Some(refus) = niveau_supporte(kind, modele, niveau, &catalogue(kind))
    {
        return Err(refus);
    }
    Ok(issue.args)
}

/// Le validateur de production : [`args_verifies`] sur le catalogue MESURÉ
/// (le cache partagé avec `/api/agents/:kind/models` — single-flight, TTL),
/// avec la commande de la table d'adaptateurs.
pub fn verificateur_args(
    cache: std::sync::Arc<crate::cache::CacheCatalogues>,
) -> impl Fn(&str, Option<&str>, Option<&str>) -> Result<Vec<String>, String> + Send + Sync {
    move |kind, modele, thinking| {
        args_verifies(kind, modele, thinking, |genre| {
            cache
                .catalogue(genre, &crate::adapters::commande_par_defaut(genre))
                .modeles
                .clone()
        })
    }
}
