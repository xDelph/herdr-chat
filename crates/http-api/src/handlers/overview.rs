//! `GET /api/overview` (H02) : la vue d'accueil depuis l'observation partagée.
//!
//! Un échec de snapshot est un **500** (le run générique du fil) — jamais une
//! 200 trompeuse avec une vue vide.

use crate::convertir;
use crate::services::Services;
use application::overview::ComposeurOverview;
use application::refresh::ErreurLecture;
use axum::response::IntoResponse;
use domain::errors::{ErreurDomaine, Nature, PortError};
use std::sync::Arc;

/// La vue d'accueil — composition par génération (T039), jamais un cache
/// périmé servi comme frais.
async fn overview_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    match services.snapshots.lecture() {
        Ok(borne) => {
            let composeur = ComposeurOverview::nouveau();
            let vue = composeur.compose(&borne, services.resout.as_ref());
            (
                axum::http::StatusCode::OK,
                axum::Json(convertir::vue_overview(&vue)),
            )
                .into_response()
        }
        Err(ErreurLecture::Amont { cause }) => {
            let erreur = erreur_de_snapshot(&cause);
            let corps = crate::errors::corps(&erreur);
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(corps),
            )
                .into_response()
        }
    }
}

/// L'erreur de snapshot nommée — la cause réelle, jamais un message générique.
#[must_use]
pub fn erreur_de_snapshot(cause: &PortError) -> ErreurDomaine {
    match cause {
        PortError::Upstream { code, message } => {
            ErreurDomaine::amont_injoignable(format!("upstream {code}: {message}"))
        }
        PortError::Transport { detail } => {
            ErreurDomaine::amont_injoignable(format!("transport: {detail}"))
        }
        PortError::Timeout => ErreurDomaine::delai_depasse("Herdr timed out"),
        PortError::Unsupported { feature } => {
            ErreurDomaine::amont_refus(format!("capability missing: {feature}"))
        }
        PortError::PathRejected { detail } => {
            ErreurDomaine::chemin_refuse(format!("path refused: {detail}"))
        }
    }
}

/// L'erreur 500 nommée pour H02 — le repli du run générique.
#[must_use]
pub fn reponse_500(erreur: &ErreurDomaine) -> axum::response::Response {
    debug_assert_eq!(erreur.nature, Nature::InternalInvariant);
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        axum::Json(crate::errors::corps(erreur)),
    )
        .into_response()
}

/// Le handler `overview`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn overview(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(overview_sur_place(axum::extract::State(services))).await
}
