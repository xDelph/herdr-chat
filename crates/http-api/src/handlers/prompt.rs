//! `POST /api/agents/:paneId/prompt` (H05) : l'envoi d'un texte, avec la
//! déduplication **après preuve** et l'état B05 nommé (`attente | erreur |
//! inconnu`) — jamais « envoyé » sans confirmation.
//!
//! ⚠️ **Un agent bloqué attend des FRAPPES, pas un prompt.** Herdr refuse
//! lui-même `agent.prompt` dans ce cas (« agent … is blocked and requires
//! interactive input », mesuré le 2026-10-16). Sans ce branchement, « type
//! your own answer » était **impossible** : le seul chemin d'écriture
//! existant était précisément celui que Herdr refuse.
//!
//! ⚠️ Le statut est relu **ici, depuis Herdr** (`lecture_forcee`), jamais
//! reçu du client : un client périmé enverrait le mauvais mode, et c'est
//! Herdr qui décide de ce qu'il accepte. Une lecture de statut qui échoue ne
//! bloque pas l'envoi : elle laisse `saisie = false`, comme le fil.

use crate::corps::{CorpsBorne, verifie_prompt};
use crate::services::Services;
use application::commands::prompt::{Confirmation as ConfirmationEnvoi, RefusEnvoi};
use application::refresh::ErreurLecture;
use axum::response::IntoResponse;
use contracts::events::{Confirmation, PromptStatus};
use contracts::http::commands::{
    PromptFailedResponse, PromptSentResponse, PromptSuppressedResponse, SendState, SuppressedStatus,
};
use domain::errors::PortError;
use domain::ids::PaneId;
use domain::status::AgentStatus;
use std::sync::Arc;

/// Le corps exact du fil : `{ text: string }` — un texte vide reste un
/// texte (l'agent décide), un texte absent est une erreur.
#[derive(serde::Deserialize)]
struct Corps {
    text: String,
}

/// L'envoi du prompt.
pub async fn prompt(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
    corps: CorpsBorne,
) -> axum::response::Response {
    // 1) Le corps — malformé = 400 nommé, jamais un envoi à moitié décidé.
    let Ok(corps) = serde_json::from_slice::<Corps>(&corps.octets) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": "invalid body: `text` (string) required"
            })),
        )
            .into_response();
    };
    // 2) La taille du TEXTE en octets UTF-8 (S06) — refusée AVANT toute
    //    action Herdr : un prompt tronqué après coup laisserait l'agent dans
    //    un état incompréhensible.
    if let Err(refus) = verifie_prompt(&corps.text) {
        return *refus;
    }
    let cible = PaneId::from(pane_id);
    // 3) Le mode : un agent bloqué reçoit des frappes. La lecture est
    //    FORCÉE (hors fenêtre de cache) — mais son échec ne bloque pas :
    //    le mode retombe sur « prompt littéral », comme le fil.
    let saisie = match services.snapshots.lecture_forcee() {
        Ok(borne) => borne
            .snapshot
            .agents
            .iter()
            .find(|agent| agent.pane_id == cible)
            .is_some_and(|agent| agent.status == AgentStatus::Blocked),
        Err(ErreurLecture::Amont { .. }) => false,
    };
    // 4) L'envoi — la déduplication et la preuve vivent dans le service.
    match services
        .prompt
        .envoie(services.port.as_ref(), &cible, &corps.text, saisie)
    {
        Ok(envoi) => (
            axum::http::StatusCode::OK,
            axum::Json(PromptSentResponse {
                confirmation: match envoi.confirmation {
                    ConfirmationEnvoi::Confirme => Confirmation::Confirmed,
                    ConfirmationEnvoi::Inconnu => Confirmation::Unknown,
                },
                fingerprint: envoi.empreinte,
                status: PromptStatus::Sent,
            }),
        )
            .into_response(),
        // Un double envoi n'est pas une erreur serveur : un no-op assumé.
        Err(RefusEnvoi::Doublon { .. }) => (
            axum::http::StatusCode::OK,
            axum::Json(PromptSuppressedResponse {
                reason: String::from("identical send already confirmed within the window"),
                status: SuppressedStatus::Suppressed,
            }),
        )
            .into_response(),
        // B05 : l'état vient de la NATURE de la panne, jamais d'une phrase.
        Err(RefusEnvoi::NonConfirme { detail, cause, .. }) => (
            axum::http::StatusCode::BAD_GATEWAY,
            axum::Json(PromptFailedResponse {
                detail,
                state: etat_de_panne(&cause),
            }),
        )
            .into_response(),
    }
}

/// L'état B05 d'une panne de transport — la nature décide :
/// un délai n'a rien prouvé (`attente`), un transport muet non plus
/// (`inconnu`), un refus amont est un envoi perdu (`erreur`).
#[must_use]
pub fn etat_de_panne(cause: &PortError) -> SendState {
    match cause {
        PortError::Timeout => SendState::Attente,
        PortError::Transport { .. } => SendState::Inconnu,
        PortError::Upstream { .. } | PortError::Unsupported { .. } => SendState::Erreur,
        PortError::PathRejected { .. } => SendState::Erreur,
    }
}
