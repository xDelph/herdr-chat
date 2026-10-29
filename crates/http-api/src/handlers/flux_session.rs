//! H19 `GET /api/agents/{paneId}/stream` — les lignes d'une session, en
//! direct (STREAMING.md).
//!
//! ⚠️ **Le curseur du client est la vérité.** Le hub d'observation ne diffuse
//! qu'une révision ; à chaque révision, ce flux lit le delta depuis SON
//! curseur et l'émet avec ce curseur pour `id:`. La reconnexion native du
//! navigateur renvoie `Last-Event-ID` : la reprise est exacte, sans journal.
//!
//! ⚠️ **Rien de bloquant sur le runtime.** La photo Herdr, la résolution (qui
//! parcourt des dossiers) et la lecture (fichier, SQLite) passent par
//! `spawn_blocking` — un pane lent ne gèle plus les autres requêtes.
//!
//! ⚠️ **Le flux se tient lui-même.** Le permis (plafond de flux) et
//! l'observation vivent dans la tâche du flux : le client parti, la tâche
//! s'arrête, l'observation tombe, le permis revient.

use crate::handlers::session::{erreur_de_snapshot, session_reponse};
use crate::services::Services;
use application::refresh::ErreurLecture;
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use contracts::events::{SessionStreamEntries, SessionStreamGone};
use contracts::http::errors::ReadCause;
use contracts::registry::RouteId;
use domain::errors::ErreurDomaine;
use domain::session::{
    ResolvedSource, SessionHint, SessionPage, SessionPageOutcome, SessionPageRequest,
};
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

/// Le plafond de flux de session ouverts en même temps.
pub const FLUX_SESSION_MAX: usize = 16;

/// La fenêtre de la première page (octets d'un JSONL) — celle de H04.
const FENETRE_QUEUE: u32 = 512 * 1024;

/// Le temps laissé à une rafale d'écritures pour se terminer avant de lire :
/// une réponse écrite en plusieurs morceaux part en un seul événement.
const REGROUPEMENT: Duration = Duration::from_millis(40);

/// La profondeur de la file vers la réponse — bornée : un client qui ne lit
/// plus bloque SA tâche, jamais la mémoire du serveur ni les autres flux.
const FILE_FLUX: usize = 8;

#[derive(serde::Deserialize)]
pub struct Parametres {
    pub cursor: Option<String>,
}

/// Le flux de session.
pub async fn flux_session(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Path(pane_id): axum::extract::Path<String>,
    axum::extract::Query(parametres): axum::extract::Query<Parametres>,
    entetes: axum::http::HeaderMap,
) -> Response {
    let Ok(permis) = Arc::clone(&services.permis_flux_session).try_acquire_owned() else {
        return reponse_erreur(ErreurDomaine::sature(format!(
            "trop de flux de session ouverts (maximum {FLUX_SESSION_MAX}) — réessayez"
        )));
    };
    let source = match resous(&services, &pane_id).await {
        Ok(source) => source,
        Err(erreur) => return reponse_erreur(erreur),
    };
    // `Last-Event-ID` (reconnexion) prime sur `?cursor=` (première ouverture).
    let depart = entetes
        .get("last-event-id")
        .and_then(|valeur| valeur.to_str().ok())
        .filter(|valeur| !valeur.is_empty())
        .map(str::to_string)
        .or(parametres.cursor.filter(|valeur| !valeur.is_empty()));
    let (emetteur, recepteur) = tokio::sync::mpsc::channel::<Event>(FILE_FLUX);
    let battement = services.battement_flux;
    tokio::spawn(async move {
        let _permis = permis;
        suit(services, pane_id, source, depart, emetteur).await;
    });
    let flux = futures_util::stream::unfold(recepteur, |mut recepteur| async move {
        let suivant = recepteur.recv().await?;
        Some((Ok::<_, Infallible>(suivant), recepteur))
    });
    Sse::new(flux)
        .keep_alive(KeepAlive::new().interval(battement).text("keep-alive"))
        .into_response()
}

/// La boucle d'un flux : lire jusqu'au rattrapage, attendre une révision (ou
/// le battement, qui re-résout le pane), recommencer.
async fn suit(
    services: Arc<Services>,
    pane_id: String,
    mut source: ResolvedSource,
    mut curseur: Option<String>,
    emetteur: tokio::sync::mpsc::Sender<Event>,
) {
    let mut observation = services.observateur.observe(&source);
    if let Some(degradation) = observation.degradation.as_deref() {
        tracing::warn!(pane = %pane_id, %degradation, "flux de session dégradé");
    }
    loop {
        match rattrape(&services, &source, &mut curseur, &emetteur).await {
            Etape::Continue => {}
            Etape::Termine => return,
        }
        tokio::select! {
            change = observation.revisions.changed() => {
                if change.is_err() {
                    return;
                }
                tokio::time::sleep(REGROUPEMENT).await;
                observation.revisions.mark_unchanged();
            }
            () = tokio::time::sleep(services.battement_flux) => {
                // Le pane a-t-il changé de session (ou disparu) ?
                match resous(&services, &pane_id).await {
                    Ok(nouvelle) if nouvelle.base != source.base
                        || nouvelle.session_id != source.session_id => {
                        source = nouvelle;
                        observation = services.observateur.observe(&source);
                        curseur = None;
                    }
                    Ok(_) => {}
                    Err(erreur) if erreur.nature == domain::errors::Nature::NoSource => {
                        let _ = emetteur
                            .send(evenement_gone(&erreur.message_sur()))
                            .await;
                        return;
                    }
                    // Herdr injoignable : une panne n'est pas une disparition.
                    Err(_) => {}
                }
            }
            () = emetteur.closed() => return,
        }
    }
}

enum Etape {
    Continue,
    Termine,
}

/// Lit depuis le curseur jusqu'au rattrapage et émet ce qui est lu.
async fn rattrape(
    services: &Arc<Services>,
    source: &ResolvedSource,
    curseur: &mut Option<String>,
    emetteur: &tokio::sync::mpsc::Sender<Event>,
) -> Etape {
    // Un curseur refusé repart de la queue UNE fois ; un second refus est
    // une vraie erreur de source.
    let mut deja_reparti = false;
    loop {
        let issue = lis(services, source.clone(), curseur.clone()).await;
        let (page, cause) = match issue {
            Ok(SessionPageOutcome::Page(page)) => (page, ReadCause::Vide),
            Ok(SessionPageOutcome::Vide(page)) => (page, ReadCause::Vide),
            Ok(SessionPageOutcome::Absente(page)) => (page, ReadCause::Absente),
            Ok(SessionPageOutcome::Invalide { detail }) => {
                if curseur.is_some() && !deja_reparti {
                    deja_reparti = true;
                    *curseur = None;
                    continue;
                }
                let _ = emetteur.send(evenement_gone(&detail)).await;
                return Etape::Termine;
            }
            // Une lecture qui échoue (verrou, droits) n'est pas une fin : on
            // attend la révision suivante. La cause est journalisée.
            Ok(SessionPageOutcome::Io { detail }) => {
                tracing::warn!(%detail, "flux de session : lecture échouée");
                return Etape::Continue;
            }
            Err(erreur) => {
                tracing::warn!(cause = %erreur.message_sur(), "flux de session : lecture échouée");
                return Etape::Continue;
            }
        };
        let rattrape = page.rattrape || page.entries.is_empty();
        let remplace = curseur.is_none() || page.reset;
        let suivant = page.cursor.clone().or_else(|| curseur.clone());
        let evenement = if remplace {
            Some(evenement_reset(cause, page))
        } else if page.entries.is_empty() {
            None
        } else {
            evenement_entries(page, suivant.clone())
        };
        *curseur = suivant;
        if let Some(evenement) = evenement
            && emetteur.send(evenement).await.is_err()
        {
            return Etape::Termine;
        }
        if rattrape {
            return Etape::Continue;
        }
    }
}

/// La source du pane, depuis la photo partagée — hors du runtime.
async fn resous(services: &Arc<Services>, pane_id: &str) -> Result<ResolvedSource, ErreurDomaine> {
    let services = Arc::clone(services);
    let pane_id = pane_id.to_string();
    bloquant(move || {
        let borne = services
            .snapshots
            .lecture()
            .map_err(|ErreurLecture::Amont { cause }| erreur_de_snapshot(&cause))?;
        let agent = borne
            .snapshot
            .agents
            .iter()
            .find(|agent| agent.pane_id.to_string() == pane_id)
            .ok_or_else(|| ErreurDomaine::sans_source("no usable session path for this agent"))?;
        let hint = SessionHint {
            agent: agent.agent.clone(),
            published: agent.session.clone(),
            title: agent.terminal_title.clone(),
            cwd: agent.cwd.clone(),
        };
        tokio::runtime::Handle::current()
            .block_on(services.sessions.resolve(hint))?
            .ok_or_else(|| ErreurDomaine::sans_source("no usable session path for this agent"))
    })
    .await?
}

/// Une page depuis le curseur (ou la queue) — hors du runtime.
async fn lis(
    services: &Arc<Services>,
    source: ResolvedSource,
    curseur: Option<String>,
) -> Result<SessionPageOutcome, ErreurDomaine> {
    let services = Arc::clone(services);
    bloquant(move || {
        tokio::runtime::Handle::current().block_on(services.sessions.page(SessionPageRequest {
            source,
            cursor: curseur,
            previous_cursor: None,
            limit: FENETRE_QUEUE,
        }))
    })
    .await?
}

/// Exécute un travail bloquant sur le pool dédié ; une tâche qui panique est
/// une erreur nommée, jamais un flux muet.
async fn bloquant<T: Send + 'static>(
    travail: impl FnOnce() -> T + Send + 'static,
) -> Result<T, ErreurDomaine> {
    tokio::task::spawn_blocking(travail)
        .await
        .map_err(|cause| ErreurDomaine::invariant_viole(format!("lecture interrompue : {cause}")))
}

fn evenement_reset(cause: ReadCause, page: SessionPage) -> Event {
    let id = page.cursor.clone();
    let charge = session_reponse(cause, page);
    let evenement = Event::default()
        .event("reset")
        .data(serde_json::to_string(&charge).unwrap_or_else(|_| String::from("{}")));
    match id {
        Some(id) => evenement.id(id),
        None => evenement,
    }
}

fn evenement_entries(page: SessionPage, curseur: Option<String>) -> Option<Event> {
    let curseur = curseur?;
    let reponse = session_reponse(ReadCause::Vide, page);
    let charge = SessionStreamEntries {
        entries: reponse.entries,
        cursor: curseur.clone(),
        caught_up: reponse.caught_up,
    };
    Some(
        Event::default()
            .event("entries")
            .id(curseur)
            .data(serde_json::to_string(&charge).unwrap_or_else(|_| String::from("{}"))),
    )
}

fn evenement_gone(raison: &str) -> Event {
    let charge = SessionStreamGone {
        reason: raison.to_string(),
    };
    Event::default()
        .event("gone")
        .data(serde_json::to_string(&charge).unwrap_or_else(|_| String::from("{}")))
}

fn reponse_erreur(erreur: ErreurDomaine) -> Response {
    let statut = crate::errors::statut(RouteId::FluxSession, &erreur);
    (
        StatusCode::from_u16(statut).unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
        axum::Json(crate::errors::corps(&erreur)),
    )
        .into_response()
}
