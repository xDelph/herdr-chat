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
pub async fn types(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    match services.types.installes() {
        Ok(inventaire) => {
            let kinds = types_lancables(&inventaire)
                .into_iter()
                .map(|type_lancable| InstalledKind {
                    // Le `kind` que `agent.start` attend (la commande quand
                    // elle est au vocabulaire, sinon la cible).
                    kind: type_lancable.kind.clone(),
                    // Le libellé est la commande : c'est ce que l'utilisateur
                    // reconnaît dans Herdr.
                    label: type_lancable.commande.clone(),
                    // Tout type offert est utilisable — un type dont l'état
                    // n'est pas utilisable n'est pas offert du tout.
                    state: String::from("current"),
                })
                .collect();
            (
                axum::http::StatusCode::OK,
                axum::Json(InstalledKindsResponse { kinds }),
            )
                .into_response()
        }
        // Sans liste fiable : 502 nommé, jamais une liste devinée.
        Err(erreur) => crate::handlers::repondre_erreur(
            RouteId::TypesInstalles,
            &ErreurDomaine::amont_injoignable(format!(
                "agent types unavailable: {}",
                erreur.detail()
            )),
        ),
    }
}

/// Le catalogue d'un type — un catalogue indisponible reste une VALEUR.
pub async fn modeles(
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
