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
            "/api/agents/{paneId}/taches",
            get(handlers::taches::taches)
                .head(handlers::taches::taches)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/agents/{paneId}/taches/{id}/session",
            get(handlers::taches::session_de_tache)
                .head(handlers::taches::session_de_tache)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/agents/{paneId}/stream",
            get(handlers::flux_session::flux_session)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/agents/kinds",
            get(handlers::catalogues::types)
                .head(handlers::catalogues::types)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/agents/{kind}/models",
            get(handlers::catalogues::modeles)
                .head(handlers::catalogues::modeles)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/events",
            get(handlers::events::flux)
                .head(handlers::events::flux)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/notifications/vapid-key",
            get(handlers::push::cle_vapid)
                .head(handlers::push::cle_vapid)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/file",
            get(handlers::fichiers::fichier)
                .head(handlers::fichiers::fichier)
                .fallback(en_async(methode_non_autorisee_lecture)),
        )
        .route(
            "/api/images",
            get(handlers::fichiers::images)
                .head(handlers::fichiers::images)
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
        .route("/api/log", post(handlers::journal_client::journal_client))
        .route(
            "/api/notifications/subscriptions",
            post(handlers::push::abonnements),
        )
        // La garde partagée de TOUTES les mutations : origine, Content-Type,
        // taille déclarée — avant toute action.
        .route_layer(middleware::from_fn_with_state(origines, garde_mutation));

    lectures
        .merge(mutations)
        // Le repli : `/api/*` inconnu reste un JSON 404 (C08) ; tout le reste
        // va aux assets de la PWA (T054) — jamais du HTML sur `/api`.
        .fallback(handlers::assets_router::statique)
        .with_state(services)
        // La sortie de CHAQUE réponse : `no-store` sur l'API (O07) quand le
        // handler n'a rien dit, et toute réponse ≥ 400 tracée avec sa route
        // et sa cause. Sous la compression : le corps lu est en clair.
        .layer(middleware::from_fn(sortie_api))
        // ⚠️ **La compression s'applique à la fin de la chaîne** (donc aux
        // assets ET au JSON) et se décide sur `Accept-Encoding` : un client qui
        // n'envoie rien reçoit du brut, jamais un corps qu'il ne sait pas lire.
        // Mesuré : `/api/overview` 12 381 → 1 793 o, `/api/conversations`
        // 54 027 → 22 079 o.
        //
        // ⚠️ **Le SSE n'est pas compressé par cette couche** : `text/event-stream`
        // n'a pas de fin, et un compresseur bufferise — la couche ne compresse
        // que si le corps est complet et d'un type qu'elle connaît. Le flux
        // garde donc son battement en clair, ce qui est le comportement voulu.
        .layer(tower_http::compression::CompressionLayer::new())
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

/// La politique de cache de l'API (O07) : une réponse JSON de l'API n'est
/// jamais mise en cache — ni par le navigateur, ni par un intermédiaire.
pub const CACHE_API: &str = "no-store";

/// Le corps d'erreur lu pour la trace — borné : une erreur est un petit JSON.
const CORPS_ERREUR_MAX: usize = 64 * 1024;

/// La cause d'une réponse d'erreur, telle que le client la lit : `error`
/// (+ `hint`) d'un `ApiErrorResponse`, `detail` d'un prompt raté, sinon le
/// texte brut (H15) — plafonnée à 300 caractères.
///
/// ⚠️ Jamais le texte d'un prompt : seuls les champs d'erreur sont lus, et
/// aucun ne recopie la demande.
#[must_use]
pub fn cause_de_reponse(corps: &[u8]) -> String {
    let texte = match serde_json::from_slice::<serde_json::Value>(corps) {
        Ok(valeur) => {
            let champ = |nom: &str| {
                valeur
                    .get(nom)
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            };
            match (champ("error").or_else(|| champ("detail")), champ("hint")) {
                (Some(erreur), Some(indice)) => format!("{erreur} — {indice}"),
                (Some(erreur), None) => erreur,
                (None, _) => valeur.to_string(),
            }
        }
        Err(_) => String::from_utf8_lossy(corps).trim().to_string(),
    };
    if texte.is_empty() {
        return String::from("(corps vide)");
    }
    texte.chars().take(300).collect()
}

/// La couche de sortie : `Cache-Control: no-store` sur `/api/*` quand le
/// handler n'en a pas posé, et la trace des réponses ≥ 400.
///
/// ⚠️ **Une erreur servie sans trace est une erreur cachée.** Le fil
/// journalisait toute réponse ≥ 400 (S10) ; ici chacune sort sur `stderr`
/// (`tracing`) avec la méthode, la route (le gabarit quand il est connu,
/// jamais un corps de requête) et la cause lue dans le corps rendu.
async fn sortie_api(demande: Request, suivant: Next) -> Response {
    let methode = demande.method().clone();
    let chemin = demande.uri().path().to_string();
    let route = demande
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map_or_else(|| chemin.clone(), |gabarit| gabarit.as_str().to_string());
    let mut reponse = suivant.run(demande).await;
    let est_api = chemin.starts_with("/api/");
    if est_api
        && !reponse
            .headers()
            .contains_key(axum::http::header::CACHE_CONTROL)
    {
        reponse.headers_mut().insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static(CACHE_API),
        );
    }
    let statut = reponse.status();
    if statut.as_u16() < 400 {
        return reponse;
    }
    // Hors API (assets) : le statut suffit, le corps n'est pas relu.
    if !est_api {
        tracing::warn!("{methode} {route} → {}", statut.as_u16());
        return reponse;
    }
    let (parties, corps) = reponse.into_parts();
    match axum::body::to_bytes(corps, CORPS_ERREUR_MAX).await {
        Ok(octets) => {
            tracing::warn!(
                "{methode} {route} → {} : {}",
                statut.as_u16(),
                cause_de_reponse(&octets)
            );
            Response::from_parts(parties, Body::from(octets))
        }
        // Un corps d'erreur illisible ou démesuré : la trace le dit, et le
        // client reçoit un 500 nommé plutôt qu'un corps tronqué en silence.
        Err(cause) => {
            tracing::warn!(
                "{methode} {route} → {} : corps d'erreur illisible ({cause})",
                statut.as_u16()
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(axum::http::header::CACHE_CONTROL, CACHE_API)],
                axum::Json(serde_json::json!({
                    "error": format!("error body unreadable ({}): {cause}", statut.as_u16())
                })),
            )
                .into_response()
        }
    }
}
