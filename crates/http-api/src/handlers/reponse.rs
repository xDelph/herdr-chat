//! `POST /api/agents/:paneId/answer` (H10) : répondre à la question affichée.
//!
//! ⚠️ **On n'envoie jamais une touche qui n'est pas un choix offert par la
//! question affichée** — pas de « 1 par défaut », pas d'`enter` seul. Une
//! invite peut autoriser l'exécution de code : envoyer un chiffre que
//! personne n'a proposé serait envoyer une décision que l'utilisateur n'a
//! pas prise. Le numéro est validé contre les choix **réellement affichés**,
//! dans le service (`interactions::repondre`), pas ici.
//!
//! ⚠️ Un refus est une **valeur** (`refusee`), pas une erreur du fil : rien
//! n'a été envoyé, et la cause est nommée.

use crate::corps::CorpsBorne;
use crate::services::Services;
use application::commands::{EtatReponse, repondre_question};
use axum::response::IntoResponse;
use contracts::http::interactive::{AnswerState, AnsweredStatus, QuestionAnsweredResponse};
use contracts::registry::RouteId;
use domain::errors::ErreurDomaine;
use domain::ids::PaneId;
use std::sync::Arc;

/// Le corps exact du fil : `{ numero: number, texte?: string }`.
#[derive(serde::Deserialize)]
struct Corps {
    numero: i64,
    #[serde(default)]
    texte: Option<String>,
}

/// La réponse à une question.
pub async fn reponse(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
    corps: CorpsBorne,
) -> axum::response::Response {
    let Ok(corps) = serde_json::from_slice::<Corps>(&corps.octets) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": "invalid body: `numero` (integer) required"
            })),
        )
            .into_response();
    };
    let cible = PaneId::from(pane_id);
    match repondre_question(
        services.port.as_ref(),
        &cible,
        corps.numero,
        corps.texte.as_deref(),
    ) {
        Ok(reponse) => (
            axum::http::StatusCode::OK,
            axum::Json(QuestionAnsweredResponse {
                detail: reponse.detail,
                state: etat_de_fil(reponse.etat),
                status: AnsweredStatus::QuestionAnswered,
            }),
        )
            .into_response(),
        // L'échec Herdr est un 502 : le corps porte la cause réelle.
        Err(cause) => crate::handlers::repondre_erreur(
            RouteId::ReponseQuestion,
            &ErreurDomaine::amont_refus(format!("answer failed: {}", cause.description())),
        ),
    }
}

/// Les trois états du fil — `appliquee | transmise | refusee`.
#[must_use]
pub fn etat_de_fil(etat: EtatReponse) -> AnswerState {
    match etat {
        EtatReponse::Appliquee => AnswerState::Appliquee,
        EtatReponse::Transmise => AnswerState::Transmise,
        EtatReponse::Refusee => AnswerState::Refusee,
    }
}
