//! `POST /api/workspaces/:workspaceId/agents` (H07) : le lancement — la
//! seule opération qui **crée** quelque chose chez Herdr.
//!
//! Trois étapes imposées par Herdr : validation, puis un onglet (le pane
//! doit être à son invite shell), puis l'agent dedans. Un projet qui a
//! **déjà** un agent peut en recevoir un second, mais seulement par action
//! explicite : chaque lancement crée un nouvel onglet.
//!
//! ⚠️ **Un agent bloqué sur l'invite de confiance n'est pas un échec** :
//! c'est une question posée à l'utilisateur. On ne répond **jamais** ici —
//! la décision est renvoyée (409) pour être visible et nommée.

use crate::corps::CorpsBorne;
use crate::services::Services;
use application::commands::launch::{DemandeLancement, ErreurLancement, IssueLancement};
use application::types_installes::{RefusType, verifie_type};
use axum::response::IntoResponse;
use contracts::http::interactive::{TrustRequiredResponse, TrustRequiredStatus};
use contracts::http::launch::{LaunchAgentRequest, LaunchAgentResponse, StartedStatus};
use contracts::registry::RouteId;
use domain::errors::ErreurDomaine;
use domain::ids::{AgentKind, AgentName, TabId, WorkspaceId};
use std::sync::Arc;

/// Le lancement d'un agent.
async fn lancement_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(workspace_id): axum::extract::Path<String>,
    corps: CorpsBorne,
) -> axum::response::Response {
    // 1) Le corps — `kind` est le seul champ obligatoire.
    let Ok(demande) = serde_json::from_slice::<LaunchAgentRequest>(&corps.octets) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": "invalid body: `kind` required" })),
        )
            .into_response();
    };
    // 2) La liste RÉELLEMENT installée, pas une liste écrite à la main — la
    //    même que le menu (C16) : refusée AVANT tout onglet.
    if let Err(refus) = verifie_type(services.types.as_ref(), &demande.kind) {
        return match refus {
            // Sans liste fiable, on refuse : mieux vaut « je ne sais pas »
            // qu'un onglet créé pour un agent qui n'existe pas.
            RefusType::Decouverte { detail } => (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(serde_json::json!({
                    "error": "agent types unavailable: launch refused",
                    "hint": detail,
                })),
            )
                .into_response(),
            RefusType::Inconnu { kind, offerts } => (
                axum::http::StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({
                    "error": format!("agent type not installed: “{kind}”"),
                    "hint": offerts,
                })),
            )
                .into_response(),
        };
    }
    // 3) La demande — la cible est CAPTURÉE ici (T034) : jamais la
    //    conversation affichée. `provider` n'est pas consommé (mesuré :
    //    il ne l'a jamais été) — on ne prétend pas l'appliquer.
    let demande = DemandeLancement {
        workspace: WorkspaceId::from(workspace_id),
        kind: AgentKind::from(demande.kind),
        nom_demande: demande.name.en_option().map(AgentName::from),
        modele: demande.model.en_option(),
        thinking: demande.thinking.en_option(),
    };
    // 4) Le moteur — validation, nom réservé, onglet, coquille, agent.
    match services.lancement.lance(
        services.port.as_ref(),
        services.horloge.as_ref(),
        services.args.as_ref(),
        &demande,
    ) {
        Ok(IssueLancement::Lance {
            kind,
            nom,
            pane,
            tab,
        }) => {
            // Le direct : le lancement est publié avec son projet — la liste
            // des conversations se met à jour sans sondage.
            let _ = crate::handlers::events::publie(
                services.journal.as_ref(),
                &[crate::publication::evenement_de_lancement(
                    &kind,
                    pane.as_str(),
                    demande.workspace.as_str(),
                )],
            );
            (
                axum::http::StatusCode::CREATED,
                axum::Json(LaunchAgentResponse {
                    kind: kind.as_str().to_string(),
                    name: nom.as_str().to_string(),
                    pane_id: pane.to_string(),
                    status: StartedStatus::Started,
                    tab_id: tab.to_string(),
                }),
            )
                .into_response()
        }
        // L'agent est là, bloqué sur l'invite de confiance : la décision est
        // exposée (409), jamais prise ici.
        Ok(IssueLancement::ConfianceRequise {
            kind,
            pane,
            dossier,
            ..
        }) => (
            axum::http::StatusCode::CONFLICT,
            axum::Json(TrustRequiredResponse {
                folder: dossier.clone(),
                kind: kind.as_str().to_string(),
                message: format!(
                    "{} is asking to trust “{dossier}”. It will be able to read, write and run \
                     code there — including without asking again. This answer is recorded \
                     permanently.",
                    kind.as_str()
                ),
                pane_id: pane.to_string(),
                status: TrustRequiredStatus::TrustRequired,
            }),
        )
            .into_response(),
        Err(erreur) => {
            crate::handlers::repondre_erreur(RouteId::Lancement, &erreur_en_domaine(erreur))
        }
    }
}

/// La cause d'un lancement refusé, en domaine — tout est 502 sauf le corps
/// invalide (400, traité avant) et la découverte (503, traitée avant).
#[must_use]
pub fn erreur_en_domaine(erreur: ErreurLancement) -> ErreurDomaine {
    match erreur {
        ErreurLancement::ValidationRefusee { erreur } => {
            ErreurDomaine::amont_refus(format!("invalid launch request: {erreur}"))
        }
        ErreurLancement::SnapshotIndisponible { detail } => {
            ErreurDomaine::amont_refus(format!("snapshot Herdr indisponible: {detail}"))
        }
        ErreurLancement::SnapshotIllisible { detail } => {
            ErreurDomaine::amont_refus(format!("snapshot Herdr illisible: {detail}"))
        }
        ErreurLancement::WorkspaceAbsent => {
            ErreurDomaine::amont_refus("this project no longer exists")
        }
        ErreurLancement::DossierInconnu { label } => {
            ErreurDomaine::amont_refus(format!("no known working folder for {label}"))
        }
        ErreurLancement::NomEpuise { base } => ErreurDomaine::amont_refus(format!(
            "no free agent name left for {base} — rename one of the existing agents"
        )),
        ErreurLancement::OngletRefuse { detail } => {
            ErreurDomaine::amont_refus(format!("the tab could not be created: {detail}"))
        }
        ErreurLancement::CoquilleNonPrete { pane, tab, detail } => {
            ErreurDomaine::amont_refus(format!(
                "the shell never became ready in tab {} (pane {}): {detail}",
                TabId::to_string(&tab),
                pane.as_str()
            ))
        }
        // L'onglet est GARDÉ : l'identité est dite (« l'onglet existe : le
        // dire évite de relancer pour rien »).
        ErreurLancement::AgentRefuse {
            pane,
            tab: _,
            detail,
        } => ErreurDomaine::amont_refus(format!(
            "the agent did not start ({detail}) — the tab exists, pane {}",
            pane.as_str()
        )),
        ErreurLancement::AmorcageAmbigu {
            pane,
            tab: _,
            detail,
        } => ErreurDomaine::amont_refus(format!(
            "the agent start timed out without a verdict ({detail}) — the tab exists, \
                 pane {} (never launched twice)",
            pane.as_str()
        )),
    }
}

/// Le handler `lancement`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn lancement(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(workspace_id): axum::extract::Path<String>,
    corps: CorpsBorne,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(lancement_sur_place(
        axum::extract::State(services),
        axum::extract::Path(workspace_id),
        corps,
    ))
    .await
}
