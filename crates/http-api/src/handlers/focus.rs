//! `POST /api/agents/:paneId/focus` (H11) : focaliser le pane d'un agent.
//!
//! ⚠️ **L'échec Herdr reste une valeur** : `focused: false` au 200, jamais
//! une erreur du fil (CURRENT §2, H11). La cause exacte part au journal —
//! l'utilisateur voit une carte qui ne bouge pas, pas une erreur rouge.

use crate::services::Services;
use axum::response::IntoResponse;
use contracts::http::commands::{AgentFocusedResponse, FocusStatus};
use domain::ids::PaneId;
use std::sync::Arc;

/// Le focus — la cible est celle de l'appel, jamais la conversation
/// affichée (T034 : la cible est capturée à l'admission).
async fn focus_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
) -> axum::response::Response {
    let cible = PaneId::from(pane_id);
    let issue = services.focus.focalise(services.port.as_ref(), &cible);
    // La ligne du journal est produite même en échec : c'est la trace de la
    // tentative, avec son verdict exact.
    tracing::debug!(cible = %cible.as_str(), ligne = %issue.ligne_journal(&cible));
    (
        axum::http::StatusCode::OK,
        axum::Json(AgentFocusedResponse {
            focused: issue.focalise,
            status: FocusStatus::AgentFocused,
        }),
    )
        .into_response()
}

/// Le handler `focus`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn focus(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(focus_sur_place(
        axum::extract::State(services),
        axum::extract::Path(pane_id),
    ))
    .await
}
