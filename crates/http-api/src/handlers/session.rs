//! `GET /api/agents/{paneId}/session` (H04) : la page de session paginée.
//!
//! Toute la matière de lecture (curseurs opaques, rotation, magasin SQLite)
//! vit derrière le port de session (`SessionPort`, T056 l'implémente avec le
//! crate `sessions`) — ce handler ne fait QUE la cartographie HTTP : il
//! traduit les clauses domaine en statuts, **jamais** une décision de lecture.

use crate::services::Services;
use application::refresh::ErreurLecture;
use axum::response::IntoResponse;
use contracts::http::errors::ReadCause;
use contracts::http::sessions::{SessionEntry as EntreeDeFil, SessionResponse};
use contracts::presence::Field;
use contracts::registry::RouteId;
use domain::errors::{ErreurDomaine, Nature, PortError};
use domain::session::{
    SessionEntry, SessionHint, SessionPage, SessionPageOutcome, SessionPageRequest,
};
use std::sync::Arc;

/// La fenêtre par défaut du fil : 512 Kio.
const SESSION_TAIL_DEFAUT: u32 = 512 * 1024;
const SESSION_TAIL_PLAFOND: u32 = 512 * 1024;

/// Les paramètres de requête documentés (H04 : `tail`, `cursor`, `before`).
#[derive(serde::Deserialize)]
pub struct Parametres {
    pub tail: Option<String>,
    pub cursor: Option<String>,
    pub before: Option<String>,
}

/// La page de session — le point d'entrée du handler.
async fn session_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
    axum::extract::Query(parametres): axum::extract::Query<Parametres>,
) -> axum::response::Response {
    // 1. L'observation partagée — l'agent vient du snapshot (C23 : une seule
    //    requête amont pour tous les consommateurs de la génération).
    let borne = match services.snapshots.lecture() {
        Ok(borne) => borne,
        Err(ErreurLecture::Amont { cause }) => {
            return reponse_erreur(erreur_de_snapshot(&cause));
        }
    };
    let agent = borne
        .snapshot
        .agents
        .iter()
        .find(|agent| agent.pane_id.to_string() == pane_id);
    let Some(agent) = agent else {
        return reponse_erreur(ErreurDomaine::sans_source(
            "no usable session path for this agent",
        ));
    };

    // 2. La résolution — le contenu vient du fichier/base, JAMAIS de Herdr
    //    (D008.1) ; les curseurs sont des chaînes opaques.
    let hint = SessionHint {
        agent: agent.agent.clone(),
        published: agent.session.clone(),
        title: agent.terminal_title.clone(),
        cwd: agent.cwd.clone(),
    };
    let source = match services.sessions.resolve(hint).await {
        Ok(Some(source)) => source,
        // Pas de source : une valeur dans le domaine, une erreur DOCUMENTÉE
        // sur H04 (404, errors.rs) — jamais un 502 indifférencié.
        Ok(None) => {
            return reponse_erreur(ErreurDomaine::sans_source(
                "no usable session path for this agent",
            ));
        }
        Err(erreur) => return reponse_erreur(erreur),
    };

    // 3. La fenêtre : `tail` = octets pour un fichier, ignoré pour SQLite
    //    (le magasin use ses 400 lignes — documenté, jamais simulé).
    let limite = tail_borne(parametres.tail.as_deref());
    let demande = SessionPageRequest {
        source,
        cursor: parametres.cursor.clone(),
        previous_cursor: parametres.before.clone(),
        limit: limite,
    };
    let page = match services.sessions.page(demande).await {
        Ok(page) => page,
        Err(erreur) => return reponse_erreur(erreur),
    };

    let reponse = match page {
        SessionPageOutcome::Page(page) => session_reponse(ReadCause::Vide, page),
        SessionPageOutcome::Absente(page) => session_reponse(ReadCause::Absente, page),
        SessionPageOutcome::Vide(page) => session_reponse(ReadCause::Vide, page),
        SessionPageOutcome::Invalide { detail } => {
            return reponse_erreur(ErreurDomaine::amont_malforme(detail));
        }
        SessionPageOutcome::Io { detail } => {
            return reponse_erreur(ErreurDomaine::source_illisible(detail));
        }
    };
    (axum::http::StatusCode::OK, axum::Json(reponse)).into_response()
}

/// `tail` : entier positif parsé, plafonné ; toute autre valeur (y compris
/// partielle — pas d'`parseInt` permissif) use la défaut.
fn tail_borne(tail: Option<&str>) -> u32 {
    match tail.and_then(|valeur| valeur.parse::<u32>().ok()) {
        Some(0) | None => SESSION_TAIL_DEFAUT,
        Some(entier) => entier.min(SESSION_TAIL_PLAFOND),
    }
}

pub(crate) fn session_reponse(cause: ReadCause, page: SessionPage) -> SessionResponse {
    SessionResponse {
        cause,
        entries: page.entries.iter().map(entree_de_fil).collect(),
        incremental: page.incremental,
        cursor: Field::de_option(page.cursor.clone()),
        previous_cursor: Field::de_option(page.previous_cursor.clone()),
        has_more: page.has_more,
        reset: page.reset,
        caught_up: page.rattrape,
        session_path: page.session_path,
    }
}

fn entree_de_fil(entree: &SessionEntry) -> EntreeDeFil {
    EntreeDeFil {
        genre: entree.kind.clone(),
        id: Field::de_option(entree.id.clone()),
        parent_id: entree
            .parent_id
            .clone()
            .map(contracts::presence::Nullable::Valeur),
        raw: entree.raw.clone(),
        timestamp: Field::de_option(entree.timestamp.clone()),
    }
}

/// La cartographie des erreurs H04 — la table de `errors::statut`, appliquée
/// sans re-décision (400 curseurs, 403 chemin, 404 source, 409 périmé, 422
/// résultat, 502 lecture, 503 base manquante).
fn reponse_erreur(erreur: ErreurDomaine) -> axum::response::Response {
    let statut = crate::errors::statut(RouteId::SessionAgent, &erreur);
    let corps = match erreur.nature {
        // La cause de lecture NAMÉE, quand l'erreur en porte une (C04).
        Nature::UpstreamMalformed => crate::errors::corps_de_lecture(ReadCause::Invalide, &erreur),
        Nature::SourceIo => crate::errors::corps_de_lecture(ReadCause::Io, &erreur),
        _ => crate::errors::corps(&erreur),
    };
    (
        axum::http::StatusCode::from_u16(statut).unwrap_or(axum::http::StatusCode::BAD_GATEWAY),
        axum::Json(corps),
    )
        .into_response()
}

pub(crate) fn erreur_de_snapshot(cause: &PortError) -> ErreurDomaine {
    match cause {
        PortError::Upstream { code, message } => {
            ErreurDomaine::amont_injoignable(format!("upstream {code}: {message}"))
        }
        PortError::Transport { detail } => {
            ErreurDomaine::amont_injoignable(format!("transport: {detail}"))
        }
        PortError::Timeout => ErreurDomaine::delai_depasse("délai Herdr dépassé"),
        PortError::Unsupported { feature } => {
            ErreurDomaine::amont_refus(format!("capacité absente : {feature}"))
        }
        PortError::PathRejected { detail } => {
            ErreurDomaine::chemin_refuse(format!("chemin refusé : {detail}"))
        }
    }
}

/// Le handler `session`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn session(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
    axum::extract::Query(parametres): axum::extract::Query<Parametres>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(session_sur_place(
        axum::extract::State(services),
        axum::extract::Path(pane_id),
        axum::extract::Query(parametres),
    ))
    .await
}
