//! H08 `GET /api/agents/kinds` et H09 `GET /api/agents/:kind/models` — les
//! catalogues.
//!
//! ⚠️ **La liste du menu est celle du lancement** (C16, B07) : même fonction
//! (`types_installes::types_lancables`), sinon le menu propose ce que le
//! lancement refuse — ou l'inverse, ce qui est pire.
//!
//! ⚠️ **H09 n'a AUCUNE branche non-200** (CURRENT §2) : un catalogue
//! indisponible est une **valeur** du 200 (`error` nommé, listes vides), pas
//! une panne silencieuse ni un 502 inventé.

use crate::services::Services;
use application::types_installes::types_lancables;
use axum::response::IntoResponse;
use contracts::http::catalog::{
    AgentModel, InstalledKind, InstalledKindsResponse, ModelCatalogResponse,
};
use contracts::presence::{Field, Nullable};
use contracts::registry::RouteId;
use domain::errors::ErreurDomaine;
use domain::ids::AgentKind;
use std::sync::Arc;

/// Les types installés ET lisibles — la liste du menu.
///
/// ⚠️ **`state` et `label` sont ceux d'Herdr** (`integration.list`), comme
/// le fil (`state: integration.state`, `label: integration.label`). Le
/// handler écrivait `state: "current"` pour tout le monde et la commande en
/// guise de libellé : une valeur inventée, présentée comme mesurée (H08).
/// La LISTE reste celle du lancement (C16) ; l'état et le libellé viennent
/// de la mesure, et un type dont l'état n'a pas été mesuré n'est pas
/// complété : la réponse est un 502 nommé.
async fn types_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    let inventaire = match services.types.installes() {
        Ok(inventaire) => inventaire,
        // Sans liste fiable : 502 nommé, jamais une liste devinée.
        Err(erreur) => {
            return crate::handlers::repondre_erreur(
                RouteId::TypesInstalles,
                &ErreurDomaine::amont_injoignable(format!(
                    "agent types unavailable: {}",
                    erreur.detail()
                )),
            );
        }
    };
    let mesures = match services.catalogue.installed().await {
        Ok(mesures) => mesures,
        Err(cause) => {
            return crate::handlers::repondre_erreur(
                RouteId::TypesInstalles,
                &ErreurDomaine::amont_injoignable(format!(
                    "agent types unavailable: {}",
                    cause.description()
                )),
            );
        }
    };
    let mut kinds = Vec::new();
    for type_lancable in types_lancables(&inventaire) {
        let Some(mesure) = mesures
            .iter()
            .find(|mesure| mesure.kind.as_str() == type_lancable.kind)
        else {
            return crate::handlers::repondre_erreur(
                RouteId::TypesInstalles,
                &ErreurDomaine::amont_malforme(format!(
                    "agent types unavailable: no measured state for “{}”",
                    type_lancable.kind
                )),
            );
        };
        kinds.push(InstalledKind {
            // Le `kind` que `agent.start` attend (la commande quand elle est
            // au vocabulaire, sinon la cible).
            kind: type_lancable.kind.clone(),
            // Le libellé et l'état d'Herdr, tels quels.
            label: mesure.label.clone(),
            state: mesure.state.clone(),
        });
    }
    (
        axum::http::StatusCode::OK,
        axum::Json(InstalledKindsResponse { kinds }),
    )
        .into_response()
}

/// Le catalogue d'un type — un catalogue indisponible reste une VALEUR.
async fn modeles_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(kind): axum::extract::Path<String>,
) -> axum::response::Response {
    let genre = AgentKind::from(kind);
    // Le port est un futur : le handler l'attend, il ne le poll pas à la main.
    match services.catalogue.catalog(&genre).await {
        Ok(observation) => {
            let reponse = ModelCatalogResponse {
                // `error` est NULLABLE OBLIGATOIRE : présent, souvent null —
                // une panne de catalogage reste visible, jamais effacée.
                error: match observation.error {
                    Some(erreur) => Nullable::Valeur(erreur),
                    None => Nullable::Nulle,
                },
                kind: observation.kind.as_str().to_string(),
                models: observation
                    .models
                    .into_iter()
                    .map(|modele| AgentModel {
                        label: Field::de_option(modele.label),
                        id: modele.id,
                        thinking_levels: modele.thinking_levels,
                    })
                    .collect(),
                thinking_levels: observation.thinking_levels,
                source: observation.source,
            };
            (axum::http::StatusCode::OK, axum::Json(reponse)).into_response()
        }
        // Le port a refusé (capacité absente, amont muet) : la VALEUR du 200
        // porte l'erreur — c'est le contrat de H09.
        Err(cause) => {
            let erreur =
                ErreurDomaine::amont_refus(format!("catalog unavailable: {}", cause.description()));
            (
                axum::http::StatusCode::OK,
                axum::Json(crate::errors::catalogue_en_valeur(
                    genre.as_str(),
                    "unavailable",
                    &erreur,
                )),
            )
                .into_response()
        }
    }
}

/// Le handler `types`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn types(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(types_sur_place(axum::extract::State(services))).await
}

/// Le handler `modeles`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn modeles(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(kind): axum::extract::Path<String>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(modeles_sur_place(
        axum::extract::State(services),
        axum::extract::Path(kind),
    ))
    .await
}
