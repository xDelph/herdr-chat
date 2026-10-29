//! `GET /api/agents/{paneId}/taches` (H20) et
//! `GET /api/agents/{paneId}/taches/{id}/session` (H21) : les tâches de fond
//! d'un agent, et la transcription de l'une d'elles.
//!
//! ⚠️ **Lecture seule, et rien de Herdr.** Les tâches viennent des fichiers
//! de l'agent (le lecteur vit dans `sessions`, injecté par la composition) ;
//! la transcription passe par le même port de session que H04 — donc par la
//! même garde de racine, les mêmes curseurs opaques, les mêmes clauses.
//!
//! ⚠️ **Une capacité absente est une valeur** : un agent dont la famille
//! n'expose pas de tâches rend `supported: false`, jamais une liste vide
//! présentée comme un fait.

use crate::handlers::repondre_erreur;
use crate::services::Services;
use application::conversations::{GenreTache, IssueTaches, StatutTache, TacheDeFond};
use application::refresh::ErreurLecture;
use axum::response::IntoResponse;
use contracts::http::errors::ReadCause;
use contracts::http::taches::{
    BackgroundTask, BackgroundTaskKind, BackgroundTaskStatus, BackgroundTasksResponse,
};
use contracts::presence::Field;
use contracts::registry::RouteId;
use domain::errors::{ErreurDomaine, Nature};
use domain::ids::AgentKind;
use domain::session::{ResolvedSource, SessionPageOutcome, SessionPageRequest, SourceKind};
use std::sync::Arc;

/// La fenêtre de la transcription : celle de H04 (512 Kio, plafonnée).
const TAIL_DEFAUT: u32 = 512 * 1024;

/// Les paramètres de H21 — ceux de H04.
#[derive(serde::Deserialize)]
pub struct Parametres {
    pub tail: Option<String>,
    pub cursor: Option<String>,
    pub before: Option<String>,
}

/// La conversion d'une tâche du service vers le fil.
#[must_use]
pub fn tache_de_fil(tache: &TacheDeFond) -> BackgroundTask {
    BackgroundTask {
        id: tache.id.clone(),
        kind: match tache.genre {
            GenreTache::Agent => BackgroundTaskKind::Agent,
            GenreTache::Commande => BackgroundTaskKind::Commande,
        },
        description: Field::de_option(tache.description.clone()),
        agent_type: Field::de_option(tache.type_agent.clone()),
        status: match tache.statut {
            StatutTache::EnCours => BackgroundTaskStatus::EnCours,
            StatutTache::Terminee => BackgroundTaskStatus::Terminee,
            StatutTache::Echouee => BackgroundTaskStatus::Echouee,
            StatutTache::Arretee => BackgroundTaskStatus::Arretee,
            StatutTache::Inconnu => BackgroundTaskStatus::Inconnu,
        },
        started_at: Field::de_option(tache.debut),
        ended_at: Field::de_option(tache.fin),
        last_activity: Field::de_option(tache.derniere_activite),
        summary: Field::de_option(tache.resume.clone()),
        transcript: tache.transcription,
    }
}

fn erreur_d_issue(issue: IssueTaches) -> ErreurDomaine {
    match issue {
        IssueTaches::PaneInconnu => ErreurDomaine::sans_source("unknown pane"),
        IssueTaches::SansSource => {
            ErreurDomaine::sans_source("no usable session path for this agent")
        }
        IssueTaches::NonPrisEnCharge => {
            ErreurDomaine::sans_source("this agent kind exposes no background tasks")
        }
        IssueTaches::Erreur(cause) => ErreurDomaine::source_illisible(cause),
        IssueTaches::Liste(_) => ErreurDomaine::invariant_viole("list returned as an error"),
    }
}

async fn taches_sur_place(services: Arc<Services>, pane_id: String) -> axum::response::Response {
    let borne = match services.snapshots.lecture() {
        Ok(borne) => borne,
        Err(ErreurLecture::Amont { cause }) => {
            return repondre_erreur(
                RouteId::TachesDeFond,
                &crate::handlers::session::erreur_de_snapshot(&cause),
            );
        }
    };
    let reponse = match services.conversations.taches_de(&borne, &pane_id) {
        IssueTaches::Liste(taches) => BackgroundTasksResponse {
            pane_id,
            supported: true,
            tasks: taches.iter().map(tache_de_fil).collect(),
        },
        IssueTaches::NonPrisEnCharge => BackgroundTasksResponse {
            pane_id,
            supported: false,
            tasks: Vec::new(),
        },
        autre => return repondre_erreur(RouteId::TachesDeFond, &erreur_d_issue(autre)),
    };
    (axum::http::StatusCode::OK, axum::Json(reponse)).into_response()
}

fn tail_borne(tail: Option<&str>) -> u32 {
    match tail.and_then(|valeur| valeur.parse::<u32>().ok()) {
        Some(0) | None => TAIL_DEFAUT,
        Some(entier) => entier.min(TAIL_DEFAUT),
    }
}

fn reponse_lecture(erreur: &ErreurDomaine) -> axum::response::Response {
    let statut = crate::errors::statut(RouteId::SessionDeTache, erreur);
    let corps = match erreur.nature {
        Nature::UpstreamMalformed => crate::errors::corps_de_lecture(ReadCause::Invalide, erreur),
        Nature::SourceIo => crate::errors::corps_de_lecture(ReadCause::Io, erreur),
        _ => crate::errors::corps(erreur),
    };
    (
        axum::http::StatusCode::from_u16(statut).unwrap_or(axum::http::StatusCode::BAD_GATEWAY),
        axum::Json(corps),
    )
        .into_response()
}

async fn session_de_tache_sur_place(
    services: Arc<Services>,
    pane_id: String,
    id: String,
    parametres: Parametres,
) -> axum::response::Response {
    let borne = match services.snapshots.lecture() {
        Ok(borne) => borne,
        Err(ErreurLecture::Amont { cause }) => {
            return reponse_lecture(&crate::handlers::session::erreur_de_snapshot(&cause));
        }
    };
    let chemin = match services
        .conversations
        .transcription_de_tache(&borne, &pane_id, &id)
    {
        Ok(chemin) => chemin,
        Err(IssueTaches::Erreur(cause)) => {
            return reponse_lecture(&ErreurDomaine::sans_source(cause));
        }
        Err(issue) => return reponse_lecture(&erreur_d_issue(issue)),
    };
    // La transcription d'un sous-agent est une session Claude : même codec,
    // même garde de racine (le port refuse un chemin hors racine).
    let demande = SessionPageRequest {
        source: ResolvedSource {
            kind: SourceKind::File,
            base: chemin,
            session_id: None,
            family: Some(AgentKind::from(String::from("claude"))),
        },
        cursor: parametres.cursor.clone(),
        previous_cursor: parametres.before.clone(),
        limit: tail_borne(parametres.tail.as_deref()),
    };
    let page = match services.sessions.page(demande).await {
        Ok(page) => page,
        Err(erreur) => return reponse_lecture(&erreur),
    };
    let reponse = match page {
        SessionPageOutcome::Page(page) | SessionPageOutcome::Vide(page) => {
            crate::handlers::session::session_reponse(ReadCause::Vide, page)
        }
        SessionPageOutcome::Absente(page) => {
            crate::handlers::session::session_reponse(ReadCause::Absente, page)
        }
        SessionPageOutcome::Invalide { detail } => {
            return reponse_lecture(&ErreurDomaine::amont_malforme(detail));
        }
        SessionPageOutcome::Io { detail } => {
            return reponse_lecture(&ErreurDomaine::source_illisible(detail));
        }
    };
    (axum::http::StatusCode::OK, axum::Json(reponse)).into_response()
}

/// Le handler H20, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn taches(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(taches_sur_place(services, pane_id)).await
}

/// Le handler H21, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn session_de_tache(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path((pane_id, id)): axum::extract::Path<(String, String)>,
    axum::extract::Query(parametres): axum::extract::Query<Parametres>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(session_de_tache_sur_place(
        services, pane_id, id, parametres,
    ))
    .await
}
