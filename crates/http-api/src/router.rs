//! Le routeur (T049, C08) : la politique de méthodes du manifeste, la garde
//! partagée des mutations, le fallback JSON 404 pour `/api` inconnu.
//!
//! ⚠️ **La politique de méthodes est un fait du manifeste** (`registry`),
//! pas une décision locale : lecture = GET + HEAD, mutation = POST. Axum
//! répond 405 + `Allow` tout seul sur une méthode absente d'une route.
//!
//! ⚠️ Les handlers H01–H04 sont branchés (T050) ; les routes restantes
//! répondent **501 nommé** — jamais un faux 200 — jusqu'à T051/T052/T053.

use crate::handlers;
use crate::origin::{RaisonGarde, RefusGarde, describe_refus, verifie_garde};
use crate::services::Services;
use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use std::sync::Arc;

/// Le routeur complet — lectures (GET/HEAD), mutations (POST, gardées),
/// repli. `origines` sont les origines exactes de la config (T048).
pub fn routeur(services: Arc<Services>, origines: Vec<String>) -> Router<()> {
    let non_branche = en_async(route_non_branche);

    let lectures = Router::new()
        .route(
            "/api/health",
            get(handlers::sante::sante)
                .head(handlers::sante::sante)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/overview",
            get(handlers::overview::overview)
                .head(handlers::overview::overview)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/conversations",
            get(handlers::conversations::conversations)
                .head(handlers::conversations::conversations)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/agents/{paneId}/session",
            get(handlers::session::session)
                .head(handlers::session::session)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/agents/kinds",
            get(non_branche.clone())
                .head(non_branche.clone())
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/agents/{kind}/models",
            get(non_branche.clone())
                .head(non_branche.clone())
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/events",
            get(non_branche.clone())
                .head(non_branche.clone())
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/notifications/vapid-key",
            get(non_branche.clone())
                .head(non_branche.clone())
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/file",
            get(non_branche.clone())
                .head(non_branche.clone())
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/images",
            get(non_branche.clone())
                .head(non_branche.clone())
                .fallback(en_async(methode_non_autorisee_lecture)),
        );

    let mutations = Router::new()
        .route(
            "/api/agents/{paneId}/prompt",
            post(handlers::prompt::prompt),
        )
        .route("/api/agents/{paneId}/stop", post(handlers::arret::arret))
        .route(
            "/api/workspaces/{workspaceId}/agents",
            post(handlers::lancement::lancement),
        )
        .route(
            "/api/agents/{paneId}/answer",
            post(handlers::reponse::reponse),
        )
        .route("/api/agents/{paneId}/focus", post(handlers::focus::focus))
        .route(
            "/api/agents/{paneId}/trust",
            post(handlers::confiance::confiance),
        )
        .route("/api/log", post(non_branche.clone()))
        .route(
            "/api/notifications/subscriptions",
            post(non_branche.clone()),
        )
        // La garde partagée de TOUTES les mutations : origine, Content-Type,
        // taille déclarée — avant toute action.
        .route_layer(middleware::from_fn_with_state(origines, garde_mutation));

    lectures
        .merge(mutations)
        .fallback(en_async(fallback_json_404))
        .with_state(services)
}

/// La route **pas encore branchée** — 501 nommé, jamais un faux 200.
fn route_non_branche(_: Request) -> Response {
    (
        axum::http::StatusCode::NOT_IMPLEMENTED,
        axum::Json(serde_json::json!({
            "error": "handler non branché — T051+ l'installe"
        })),
    )
        .into_response()
}

/// Enveloppe un `fn(Request) -> Response` (405, fallback) en handler axum.
fn en_async(
    h: fn(Request) -> Response,
) -> impl Fn(Request) -> std::pin::Pin<Box<dyn std::future::Future<Output = Response> + Send>> + Clone
{
    move |demande| {
        let h = h;
        Box::pin(async move { h(demande) })
    }
}

/// La garde des mutations, appliquée en couche — l'ordre du fil (CURRENT §2) :
/// **méthode d'abord** (405 + `Allow: POST`), puis origine, Content-Type,
/// taille déclarée. La couche court avant la distribution d'axum : un POST
/// raté ne touche jamais le handler.
async fn garde_mutation(
    State(origines): State<Vec<String>>,
    demande: Request,
    suivant: Next,
) -> Response {
    if demande.method() != axum::http::Method::POST {
        return methode_non_autorisee_post(Request::new(Body::empty()));
    }
    let origine = en_tete(&demande, "origin");
    let content_type = en_tete(&demande, "content-type");
    let longueur = en_tete(&demande, "content-length");
    match verifie_garde(origine, content_type, longueur, &origines) {
        Ok(()) => suivant.run(demande).await,
        Err(refus) => reponse_refus(&refus),
    }
}

/// Lit un en-tête — les noms HTTP sont insensibles à la casse ; axum le fait
/// déjà, ceci est une couche de sécurité pour les adaptateurs.
fn en_tete<'a>(demande: &'a Request, nom: &str) -> Option<&'a str> {
    demande
        .headers()
        .get(nom)
        .and_then(|valeur| valeur.to_str().ok())
}

/// La réponse d'un refus de garde : le statut exact et le corps
/// `ApiErrorResponse` — la cause, jamais un refus muet.
fn reponse_refus(refus: &RefusGarde) -> Response {
    let message = describe_refus(
        refus.raison,
        refus.attendue.as_deref(),
        refus.recue.as_deref(),
    );
    let corps = serde_json::json!({ "error": message });
    (
        StatusCode::from_u16(refus.statut).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        axum::Json(corps),
    )
        .into_response()
}

/// Le repli `/api/*` inconnu : JSON 404 (C08 — le fil servait du HTML par
/// accident ; ici c'est un contrat). Le reste revient au fallback statique
/// de la PWA (T054).
#[must_use]
pub fn fallback_json_404(demande: Request) -> Response {
    let chemin = demande.uri().path().to_string();
    if chemin.starts_with("/api/") {
        (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({ "error": "route inconnue" })),
        )
            .into_response()
    } else {
        // La PWA n'est pas encore montée (T054) : le 503 honnête du fil
        // quand le build manque.
        (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "error": "PWA not built",
                "hint": "le build statique arrive avec T054"
            })),
        )
            .into_response()
    }
}

/// Le 405 d'une mutation : `Allow: POST` obligatoire — sans lui, un client
/// ne sait pas si la route existe ou est interdite.
#[must_use]
pub fn methode_non_autorisee_post(_: Request) -> Response {
    methode_non_autorisee_avec("POST")
}

/// Le 405 d'une lecture (C08) : `Allow: GET, HEAD` — la politique de méthodes
/// du manifeste, pas la laxité du fil (qui liait par chemin seulement).
#[must_use]
pub fn methode_non_autorisee_lecture(_: Request) -> Response {
    methode_non_autorisee_avec("GET, HEAD")
}

fn methode_non_autorisee_avec(allow: &str) -> Response {
    let message = describe_refus(RaisonGarde::Methode, None, None);
    (
        StatusCode::METHOD_NOT_ALLOWED,
        [("allow", allow), ("content-type", "application/json")],
        axum::Json(serde_json::json!({ "error": message })),
    )
        .into_response()
}
