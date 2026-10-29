//! `POST /api/agents/:paneId/read` (H22) : noter qu'une conversation a été
//! lue — pour TOUS les appareils (`application::lectures`).
//!
//! ⚠️ Lire ne touche jamais Herdr : ni focus, ni acquittement du `done`.
//! ⚠️ Une panne de persistance n'est pas masquée : elle part au journal
//! (la lecture vaut jusqu'au redémarrage, la réponse dit l'instant retenu).

use crate::corps::CorpsBorne;
use crate::services::Services;
use axum::response::IntoResponse;
use contracts::http::lectures::{MarkReadRequest, MarkReadResponse};
use std::sync::Arc;

/// La lecture notée — l'instant retenu ne recule jamais.
pub async fn lecture(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
    corps: CorpsBorne,
) -> axum::response::Response {
    let Ok(demande) = serde_json::from_slice::<MarkReadRequest>(&corps.octets) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": "invalid body: `at` (milliseconds, integer) required"
            })),
        )
            .into_response();
    };
    let notee = services.lectures.note(&pane_id, demande.at);
    if let Some(panne) = &notee.panne {
        tracing::warn!(pane = %pane_id, cause = %panne, "lecture partagée non persistée");
    }
    (
        axum::http::StatusCode::OK,
        axum::Json(MarkReadResponse {
            pane_id,
            read_at: notee.lue_a,
        }),
    )
        .into_response()
}
