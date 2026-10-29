//! `POST /api/agents/:paneId/stop` (H06) : une interruption **demandée**,
//! jamais un arrêt prouvé.
//!
//! Herdr 0.9.3 n'expose pas de méthode `agent.stop` : la seule primitive est
//! `agent.send_keys`, et on ne l'utilise que si une observation **fraîche**
//! confirme que le pane porte encore un agent `working`. La réponse confirme
//! la transmission de Ctrl+C, jamais l'arrêt effectif du processus.

use crate::services::Services;
use application::commands::stop::{ErreurArret, IssueArret};
use axum::response::IntoResponse;
use contracts::http::commands::{StopAgentResponse, StopStatus};
use domain::errors::ErreurDomaine;
use domain::ids::PaneId;
use std::sync::Arc;

/// L'arrêt — le corps est ignoré (la garde l'a déjà borné).
async fn arret_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
) -> axum::response::Response {
    let cible = PaneId::from(pane_id);
    match services.arret.arrete(services.port.as_ref(), &cible) {
        Ok(IssueArret::InterruptEnvoye) => (
            axum::http::StatusCode::OK,
            axum::Json(StopAgentResponse {
                status: StopStatus::InterruptSent,
            }),
        )
            .into_response(),
        Ok(IssueArret::NonEnCours) => (
            axum::http::StatusCode::OK,
            axum::Json(StopAgentResponse {
                status: StopStatus::NotRunning,
            }),
        )
            .into_response(),
        Err(erreur) => crate::handlers::repondre_erreur(
            contracts::registry::RouteId::Arret,
            &erreur_en_domaine(erreur),
        ),
    }
}

/// La cause d'un arrêt refusé, en domaine — chaque cause garde sa nature :
/// 404 pour l'agent absent, 502 pour tout le reste.
#[must_use]
pub fn erreur_en_domaine(erreur: ErreurArret) -> ErreurDomaine {
    match erreur {
        // ⚠️ Le fil interpole le paneId brut ; le port, lui, retire les
        // identifiants internes de TOUT message destiné à l'écran — les
        // interpoler produirait « no Herdr agent in pane le nouvel onglet ».
        // Le client sait quel pane il a demandé : le message le dit sans
        // l'identifiant, et reste vrai.
        ErreurArret::AgentAbsent { .. } => {
            ErreurDomaine::sans_source("no Herdr agent in this pane")
        }
        ErreurArret::SnapshotIndisponible { detail } => {
            ErreurDomaine::amont_injoignable(format!("Herdr snapshot unavailable: {detail}"))
        }
        ErreurArret::SnapshotIllisible { detail } => {
            ErreurDomaine::amont_malforme(format!("unreadable Herdr snapshot: {detail}"))
        }
        ErreurArret::Transmission { cible, detail } => {
            ErreurDomaine::amont_refus(format!("Ctrl+C refused for {}: {detail}", cible.as_str()))
        }
    }
}

/// Le handler `arret`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn arret(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(arret_sur_place(
        axum::extract::State(services),
        axum::extract::Path(pane_id),
    ))
    .await
}
