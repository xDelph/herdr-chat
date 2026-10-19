//! Le port des catalogues **réel** : `catalog` + `integration.list` →
//! `CatalogPort`.
//!
//! ⚠️ **Deux sources, jamais confondues** : le catalogue d'un type est obtenu
//! en **lançant sa commande** (bornée, `catalog::process`), la liste des types
//! installés vient d'**Herdr** (`integration.list`). Aucune des deux n'est
//! écrite à la main — c'est le défaut B07 (une liste fixe proposait des agents
//! inexistants).
//!
//! ⚠️ **Un échec de catalogue est une VALEUR** (`error` nommé, listes vides) :
//! c'est le contrat de H09. Un échec de `integration.list`, lui, est une
//! **erreur de port** (le lancement doit refuser, pas deviner).

use crate::adapters::{ModeleCatalogue, ResultatCatalogue};
use crate::args::construit_args;
use crate::cache::CacheCatalogues;
use domain::catalog::{
    AgentModel, CatalogObservation, InstalledKindInstance, LaunchChoice, ValidatedArgs,
};
use domain::errors::PortError;
use domain::ids::AgentKind;
use domain::ports::{CatalogPort, PortFuture};
use std::sync::Arc;

/// Le port réel : un cache de catalogues (single-flight, TTL) et le client
/// Herdr pour la liste des intégrations.
/// La découverte des intégrations installées — **injectée** : `Herdr` est le
/// seul à savoir quels types existent (B07), et `catalog` ne parle pas au
/// socket. La composition fournit la source ; les tests en fournissent une
/// fausse.
pub type SourceIntegrations = Arc<dyn Fn() -> Result<serde_json::Value, String> + Send + Sync>;

pub struct PortCatalogue {
    cache: Arc<CacheCatalogues>,
    integrations: SourceIntegrations,
}

impl PortCatalogue {
    #[must_use]
    pub fn nouveau(cache: Arc<CacheCatalogues>, integrations: SourceIntegrations) -> Self {
        Self {
            cache,
            integrations,
        }
    }
}

/// Le catalogue mesuré → l'observation du domaine.
///
/// ⚠️ L'erreur **reste visible** : un kind sans adaptateur rend une liste vide
/// ET son erreur, jamais une liste inventée.
#[must_use]
pub fn observation_depuis(kind: &AgentKind, resultat: &ResultatCatalogue) -> CatalogObservation {
    CatalogObservation {
        kind: kind.clone(),
        error: resultat.erreur.clone(),
        models: resultat.modeles.iter().map(modele).collect(),
        thinking_levels: resultat.niveaux.clone(),
        source: resultat.source.clone(),
    }
}

fn modele(modele: &ModeleCatalogue) -> AgentModel {
    AgentModel {
        id: modele.id.clone(),
        label: modele.libelle.clone(),
        thinking_levels: modele.niveaux.clone(),
    }
}

/// La liste d'`integration.list` → les types installés.
///
/// ⚠️ La forme lue est celle **mesurée** : `{ integrations: [{ available,
/// command, label, state, target }] }`. Un type dont `state` vaut
/// `not_installed` n'est pas installé ; le reste (y compris un `state` inconnu)
/// est retenu — on ne cache pas ce qu'on ne sait pas qualifier.
#[must_use]
pub fn installees_depuis(valeur: &serde_json::Value) -> Vec<InstalledKindInstance> {
    let Some(liste) = valeur
        .get("integrations")
        .and_then(serde_json::Value::as_array)
    else {
        return Vec::new();
    };
    liste
        .iter()
        .filter_map(|integration| {
            let commande = integration.get("command")?.as_str()?;
            let state = integration
                .get("state")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("current");
            if state == "not_installed" {
                return None;
            }
            // Le `kind` que `agent.start` attend : la commande quand elle est
            // au vocabulaire connu, sinon la cible (mesuré : Cursor).
            let cible = integration
                .get("target")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(commande);
            let type_installe = kind_de(commande, cible);
            Some(InstalledKindInstance {
                kind: AgentKind::from(type_installe),
                label: integration
                    .get("label")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(commande)
                    .to_string(),
                state: state.to_string(),
            })
        })
        .collect()
}

/// Le `kind` que `agent.start` attend — **la même règle que le lancement**
/// (commande si elle est au vocabulaire connu, sinon cible), prise à sa
/// source (`application::types_installes`) pour que les deux ne divergent
/// jamais.
fn kind_de(commande: &str, cible: &str) -> String {
    domain::catalog::kind_attendu(commande, cible)
}

/// Valide une demande de lancement **avant** toute création d'onglet (C07).
///
/// ⚠️ Le **nom** est exigé : la politique de nom (numérotation, noms pris)
/// appartient au moteur de lancement (T037), qui seul voit la photo. Ce port
/// refuse donc un nom absent au lieu d'en inventer un faux.
pub fn valide(choice: &LaunchChoice) -> Result<ValidatedArgs, PortError> {
    let Some(nom) = choice.name.clone() else {
        return Err(PortError::Unsupported {
            feature: String::from(
                "nom automatique : la politique de nom appartient au moteur de lancement",
            ),
        });
    };
    let args = construit_args(
        choice.kind.as_str(),
        choice.model.as_deref(),
        choice.thinking.as_deref(),
    );
    if let Some(erreur) = args.erreur {
        return Err(PortError::Upstream {
            code: String::from("launch-validation"),
            message: erreur,
        });
    }
    Ok(ValidatedArgs {
        kind: choice.kind.clone(),
        model: choice.model.clone(),
        provider: choice.provider.clone(),
        name: nom,
        thinking: choice.thinking.clone(),
    })
}

impl CatalogPort for PortCatalogue {
    fn catalog(&self, kind: &AgentKind) -> PortFuture<'_, CatalogObservation> {
        let genre = kind.as_str().to_string();
        let kind = kind.clone();
        let cache = Arc::clone(&self.cache);
        Box::pin(async move {
            // `CacheCatalogues` fait le single-flight et le TTL ; un échec
            // n'est pas figé (T031).
            //
            // ⚠️ La commande est celle de la TABLE d'adaptateurs. Un argv vide
            // rendait `argv vide` pour TOUS les kinds : la production
            // n'injecte rien, elle exécute.
            let commande = crate::adapters::commande_par_defaut(&genre);
            let resultat = cache.catalogue(&genre, &commande);
            Ok(observation_depuis(&kind, &resultat))
        })
    }

    fn installed(&self) -> PortFuture<'_, Vec<InstalledKindInstance>> {
        let integrations = Arc::clone(&self.integrations);
        Box::pin(async move {
            // Une découverte en panne est une ERREUR (le lancement refusera),
            // jamais une liste vide présentée comme vraie.
            let valeur = integrations().map_err(|detail| PortError::Upstream {
                code: String::from("integration.list"),
                message: detail,
            })?;
            Ok(installees_depuis(&valeur))
        })
    }

    fn validate_launch(&self, choice: LaunchChoice) -> PortFuture<'_, ValidatedArgs> {
        Box::pin(async move { valide(&choice) })
    }
}
