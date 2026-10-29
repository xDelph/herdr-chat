//! H15 `GET /api/notifications/vapid-key` et H16 `POST
//! /api/notifications/subscriptions` — Web Push.
//!
//! ⚠️ **La clé privée ne sort JAMAIS** : seule la clé publique est rendue, en
//! **texte brut** (`text/plain`), jamais dans un DTO JSON qui pourrait en
//! exposer d'autres champs. Le journal ne la reçoit pas non plus.
//!
//! ⚠️ **Capacité absente = 503, pas un substitut** : sans service Web Push,
//! l'interface doit afficher l'absence, pas un abonnement inventé.
//!
//! ⚠️ **Le désabonnement est essayé d'abord** (précédence mesurée : un corps
//! `{unsubscribe}` n'est jamais un abonnement) — et les deux routes
//! répondent **204 sans corps**, pas un `{ok}` inventé.

use crate::corps::CorpsBorne;
use crate::services::Services;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::response::IntoResponse;
use contracts::http::push::{
    PresenceRequest, PushBody, SubscribeRequest, UnsubscribeRequest, endpoint_en_https,
};
use contracts::registry::RouteId;
use domain::errors::ErreurDomaine;
use domain::errors::PortError;
use domain::notifications::{BrowserSubscription, PushSubscriptionKeys};
use std::sync::Arc;

/// `GET /api/notifications/vapid-key` — la clé publique, en texte brut.
pub async fn cle_vapid(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    let Some(port) = services.notifications.as_ref() else {
        // Aucun service : la capacité est ABSENTE, dite en texte brut comme
        // le fil (un 503 JSON laisserait croire à une panne réparable).
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            [(CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Web Push is unavailable",
        )
            .into_response();
    };
    match port.vapid_public_key().await {
        Ok(Some(cle)) => (
            axum::http::StatusCode::OK,
            [
                (CACHE_CONTROL, "no-store"),
                (CONTENT_TYPE, "text/plain; charset=utf-8"),
            ],
            cle.as_str().to_string(),
        )
            .into_response(),
        // Pas de clé configurée : capacité absente, jamais une clé inventée.
        Ok(None) => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            [(CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Web Push is unavailable",
        )
            .into_response(),
        // Une panne de résolution est un 500 JSON : le fil la nomme.
        Err(cause) => repondre_panne(RouteId::CleVapid, "Web Push setup failed", &cause),
    }
}

/// `POST /api/notifications/subscriptions` — abonner ou désabonner.
pub async fn abonnements(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    corps: CorpsBorne,
) -> axum::response::Response {
    let Some(port) = services.notifications.as_ref() else {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "error": "Web Push is unavailable" })),
        )
            .into_response();
    };
    let Ok(corps) = serde_json::from_slice::<PushBody>(&corps.octets) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "error": "Invalid Web Push subscription" })),
        )
            .into_response();
    };
    match corps {
        // Le désabonnement d'abord — la précédence mesurée du fil.
        PushBody::Unsubscribe(UnsubscribeRequest { unsubscribe }) => {
            match port.unsubscribe(unsubscribe).await {
                Ok(()) => acquittement(),
                Err(cause) => repondre_panne(
                    RouteId::Abonnements,
                    "Could not remove push subscription",
                    &cause,
                ),
            }
        }
        PushBody::Subscribe(SubscribeRequest {
            endpoint,
            expiration_time: _,
            keys,
        }) => {
            // La règle mesurée : l'endpoint doit être HTTPS. Un endpoint en
            // clair ferait transiter les notifications sans chiffrement de
            // transport.
            if !endpoint_en_https(&endpoint) {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    axum::Json(serde_json::json!({
                        "error": "Invalid Web Push subscription"
                    })),
                )
                    .into_response();
            }
            let abonnement = BrowserSubscription {
                endpoint,
                keys: PushSubscriptionKeys {
                    p256dh: keys.p256dh,
                    auth: keys.auth,
                },
            };
            match port.subscribe(abonnement).await {
                Ok(()) => acquittement(),
                Err(cause) => repondre_panne(
                    RouteId::Abonnements,
                    "Could not save push subscription",
                    &cause,
                ),
            }
        }
    }
}

/// `POST /api/notifications/presence` (H23) — l'app est au premier plan sur
/// cet appareil (ou vient de le quitter) : il n'est pas notifié tant qu'il
/// est là. Les autres appareils le sont toujours.
pub async fn presence(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    corps: CorpsBorne,
) -> axum::response::Response {
    let Some(port) = services.notifications.as_ref() else {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({ "error": "Web Push is unavailable" })),
        )
            .into_response();
    };
    let Ok(PresenceRequest { endpoint, visible }) =
        serde_json::from_slice::<PresenceRequest>(&corps.octets)
    else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": "invalid body: `endpoint` (string) and `visible` (boolean) required"
            })),
        )
            .into_response();
    };
    match port.presence(endpoint, visible).await {
        Ok(()) => acquittement(),
        Err(cause) => repondre_panne(RouteId::Presence, "Could not record presence", &cause),
    }
}

/// Le 204 du fil : aucun corps, `no-store` — jamais un `{ok}` inventé.
fn acquittement() -> axum::response::Response {
    (
        axum::http::StatusCode::NO_CONTENT,
        [(CACHE_CONTROL, "no-store")],
    )
        .into_response()
}

/// Une panne nommée — la cause réelle est conservée, le message du fil garde
/// sa forme. L'écriture d'un magasin est une panne de SOURCE (500 pour H15
/// comme pour H16), jamais un 503 « capacité absente ».
fn repondre_panne(route: RouteId, prefixe: &str, cause: &PortError) -> axum::response::Response {
    crate::handlers::repondre_erreur(
        route,
        &ErreurDomaine::source_illisible(format!("{prefixe}: {cause}")),
    )
}
