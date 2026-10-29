//! `POST /api/agents/:paneId/trust` (H12) : trancher l'invite de confiance.
//!
//! ⚠️ **`state` est obligatoire dans la réponse** (C03) : le fil construisait
//! `{accepted, status}` et la validation de contrat produisait un 500 pour
//! TOUT résultat de service. Ici les quatre états mesurés (`transmise |
//! acceptee | refusee | non-applicable`) sont portés.
//!
//! ⚠️ **`accepted` n'est vrai que si l'acceptation est PROUVÉE** : la frappe
//! partie ne prouve rien, l'invite disparue sur un agent mort ne prouve rien
//! non plus. Le service relit avant, vérifie que l'agent vit, relit après.

use crate::corps::CorpsBorne;
use crate::services::Services;
use application::commands::{EtatConfiance, repondre_confiance};
use application::refresh::ErreurLecture;
use axum::response::IntoResponse;
use contracts::http::interactive::{TrustResolvedResponse, TrustResolvedStatus, TrustState};
use contracts::registry::RouteId;
use domain::errors::ErreurDomaine;
use domain::ids::PaneId;
use std::sync::Arc;

/// Le corps exact du fil : `{ accept: boolean }`.
#[derive(serde::Deserialize)]
struct Corps {
    accept: bool,
}

/// La confiance tranchée.
async fn confiance_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
    corps: CorpsBorne,
) -> axum::response::Response {
    let Ok(corps) = serde_json::from_slice::<Corps>(&corps.octets) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": "invalid body: `accept` (boolean) required"
            })),
        )
            .into_response();
    };
    let cible = PaneId::from(pane_id);
    // La famille d'agent décide des touches — elle vient de Herdr, jamais du
    // client. Une lecture qui échoue laisse la famille inconnue : le service
    // refuse alors d'envoyer une touche non mesurée (jamais un repli codex).
    let famille = match services.snapshots.lecture_forcee() {
        Ok(borne) => borne
            .snapshot
            .agents
            .iter()
            .find(|agent| agent.pane_id == cible)
            .and_then(|agent| agent.agent.as_ref())
            .map(|kind| kind.as_str().to_string()),
        Err(ErreurLecture::Amont { .. }) => None,
    };
    match repondre_confiance(
        services.port.as_ref(),
        &cible,
        corps.accept,
        famille.as_deref(),
    ) {
        Ok(reponse) => (
            axum::http::StatusCode::OK,
            axum::Json(TrustResolvedResponse {
                accepted: reponse.accepted,
                state: etat_de_fil(reponse.etat),
                status: TrustResolvedStatus::TrustResolved,
            }),
        )
            .into_response(),
        Err(cause) => crate::handlers::repondre_erreur(
            RouteId::Confiance,
            &ErreurDomaine::amont_refus(format!("trust answer failed: {}", cause.description())),
        ),
    }
}

/// Les quatre états du fil — aucun n'affirme plus que ce qui a été observé.
#[must_use]
pub fn etat_de_fil(etat: EtatConfiance) -> TrustState {
    match etat {
        EtatConfiance::Transmise => TrustState::Transmise,
        EtatConfiance::Acceptee => TrustState::Acceptee,
        EtatConfiance::Refusee => TrustState::Refusee,
        EtatConfiance::NonApplicable => TrustState::NonApplicable,
    }
}

/// Le handler `confiance`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn confiance(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
    corps: CorpsBorne,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(confiance_sur_place(
        axum::extract::State(services),
        axum::extract::Path(pane_id),
        corps,
    ))
    .await
}
