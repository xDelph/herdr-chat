//! `GET /api/conversations` (H03) : une ligne par pane visible.
//!
//! Pas de snapshot = pas de liste : **503** `{conversations:[]}` — on le dit,
//! on n'invente rien. Un snapshot illisible : **502** même forme vide nommée
//! (jamais une liste devinée).

use crate::convertir;
use crate::services::Services;
use application::refresh::ErreurLecture;
use axum::response::IntoResponse;
use contracts::http::conversations::ConversationsResponse;
use domain::errors::{ErreurDomaine, Nature, PortError};
use std::sync::Arc;

/// La liste — la composition du service (T039) porte l'isolation des lignes.
async fn conversations_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    match services.snapshots.lecture() {
        Ok(borne) => {
            let lignes = services
                .conversations
                .lignes(services.port.as_ref(), &borne);
            (
                axum::http::StatusCode::OK,
                axum::Json(convertir::liste_conversations(&lignes, |pane| {
                    services.lectures.lue_a(pane)
                })),
            )
                .into_response()
        }
        Err(ErreurLecture::Amont { cause }) => {
            let erreur = erreur_de_snapshot(&cause);
            // 503 : Herdr ne donne pas de snapshot. 502 : le snapshot est
            // illisible (forme hors contrat). Les deux : liste vide nommée.
            let statut = match erreur.nature {
                Nature::UpstreamUnavailable | Nature::Deadline | Nature::Overloaded => 503,
                _ => 502,
            };
            (
                axum::http::StatusCode::from_u16(statut)
                    .unwrap_or(axum::http::StatusCode::SERVICE_UNAVAILABLE),
                axum::Json(ConversationsResponse {
                    conversations: Vec::new(),
                }),
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
            ErreurDomaine::amont_malforme(format!("malformed snapshot: {feature}"))
        }
        PortError::PathRejected { detail } => {
            ErreurDomaine::chemin_refuse(format!("path refused: {detail}"))
        }
    }
}

/// Le handler `conversations`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn conversations(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(conversations_sur_place(axum::extract::State(services))).await
}
