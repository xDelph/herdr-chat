//! H15 `GET /api/notifications/vapid-key` et H16 `POST
//! /api/notifications/subscriptions`.
//!
//! ⚠️ La clé privée ne sort **jamais** ; une capacité absente est un 503, pas
//! un substitut ; les deux réponses d'écriture sont **204 sans corps**.

use crate::unit::support::{envoie_post, requete_get, services, services_retouches};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::notifications::VapidPublicKey;
use http_api::router::routeur;
use serde_json::json;
use std::sync::Arc;
use test_support::fake_herdr::HerdrFaux;
use test_support::push_sink::PuitsPushFaux;
use tower::ServiceExt;

fn puits() -> (Arc<PuitsPushFaux>, Arc<PuitsPushFaux>) {
    let puits = Arc::new(PuitsPushFaux::nouveau());
    (Arc::clone(&puits), puits)
}

#[tokio::test(flavor = "multi_thread")]
async fn cle_vapid_200_texte_brut() {
    let (partage, puits) = puits();
    puits.regle_vapid(Some(VapidPublicKey::from(String::from(
        "BPublicKeyBase64url",
    ))));
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.notifications = Some(partage);
    });
    let reponse = routeur(services, vec![])
        .oneshot(
            axum::http::Request::builder()
                .method("GET")
                .uri("/api/notifications/vapid-key")
                .body(axum::body::Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause:?}"));
    assert_eq!(reponse.status(), StatusCode::OK);
    // TEXTE BRUT : jamais un DTO JSON qui pourrait exposer d'autres champs.
    assert_eq!(
        reponse
            .headers()
            .get("content-type")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("text/plain; charset=utf-8")
    );
    assert_eq!(
        reponse
            .headers()
            .get("cache-control")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("no-store")
    );
    let corps = axum::body::to_bytes(reponse.into_body(), 4096)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause:?}"));
    assert_eq!(String::from_utf8_lossy(&corps), "BPublicKeyBase64url");
}

#[tokio::test(flavor = "multi_thread")]
async fn cle_vapid_503_sans_service() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let reponse = routeur(services, vec![])
        .oneshot(
            axum::http::Request::builder()
                .method("GET")
                .uri("/api/notifications/vapid-key")
                .body(axum::body::Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause:?}"));
    assert_eq!(reponse.status(), StatusCode::SERVICE_UNAVAILABLE);
    // Le 503 est du TEXTE brut, comme le fil.
    let corps = axum::body::to_bytes(reponse.into_body(), 4096)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause:?}"));
    assert_eq!(String::from_utf8_lossy(&corps), "Web Push is unavailable");
}

#[tokio::test(flavor = "multi_thread")]
async fn cle_vapid_503_sans_cle_configuree() {
    let (partage, _puits) = puits();
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.notifications = Some(partage);
    });
    let reponse =
        crate::unit::support::get_brut(routeur(services, vec![]), "/api/notifications/vapid-key")
            .await;
    // Aucune clé : capacité ABSENTE, jamais une clé inventée.
    assert_eq!(reponse.status(), StatusCode::SERVICE_UNAVAILABLE);
    let corps = axum::body::to_bytes(reponse.into_body(), 4096)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause:?}"));
    assert_eq!(String::from_utf8_lossy(&corps), "Web Push is unavailable");
}

#[tokio::test(flavor = "multi_thread")]
async fn cle_vapid_500_panne_de_resolution() {
    let (partage, puits) = puits();
    puits.panne_vapid(PortError::Upstream {
        code: String::from("EACCES"),
        message: String::from("store illisible"),
    });
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.notifications = Some(partage);
    });
    let (statut, corps) =
        requete_get(routeur(services, vec![]), "/api/notifications/vapid-key").await;
    // Une panne de magasin n'est PAS « pas de clé » : 500, pas 503.
    assert_eq!(statut, StatusCode::INTERNAL_SERVER_ERROR);
    let message = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(message.contains("Web Push setup failed"), "{message}");
    // La clé privée n'apparaît nulle part — le message ne porte que la cause.
    assert!(!message.contains("privateKey"), "{message}");
}

#[tokio::test(flavor = "multi_thread")]
async fn abonnement_204() {
    let (partage, puits) = puits();
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.notifications = Some(partage);
    });
    let corps = json!({
        "endpoint": "https://push.example/ep-1",
        "expirationTime": null,
        "keys": { "auth": "auth-1", "p256dh": "p256dh-1" }
    })
    .to_string()
    .into_bytes();
    let (statut, reponse) = envoie_post(
        routeur(services, vec![]),
        "/api/notifications/subscriptions",
        corps,
    )
    .await;
    assert_eq!(statut, StatusCode::NO_CONTENT);
    // 204 sans corps : jamais un `{ok}` inventé.
    assert_eq!(reponse, serde_json::Value::Null);
    assert_eq!(
        puits.abonnes(),
        vec![String::from("https://push.example/ep-1")]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn desabonnement_204_et_prioritaire() {
    let (partage, puits) = puits();
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.notifications = Some(partage);
    });
    // Les DEUX formes présentes : le désabonnement gagne (précédence mesurée).
    let corps = json!({
        "unsubscribe": "https://push.example/ep-1",
        "endpoint": "https://push.example/ep-2",
        "keys": { "auth": "a", "p256dh": "p" }
    })
    .to_string()
    .into_bytes();
    let (statut, _) = envoie_post(
        routeur(services, vec![]),
        "/api/notifications/subscriptions",
        corps,
    )
    .await;
    assert_eq!(statut, StatusCode::NO_CONTENT);
    assert_eq!(
        puits.desabonnes(),
        vec![String::from("https://push.example/ep-1")]
    );
    assert!(puits.abonnes().is_empty(), "l'abonnement ne s'applique pas");
}

#[tokio::test(flavor = "multi_thread")]
async fn abonnement_400_endpoint_non_https() {
    let (partage, puits) = puits();
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.notifications = Some(partage);
    });
    let corps = json!({
        "endpoint": "http://push.example/ep-1",
        "keys": { "auth": "a", "p256dh": "p" }
    })
    .to_string()
    .into_bytes();
    let (statut, reponse) = envoie_post(
        routeur(services, vec![]),
        "/api/notifications/subscriptions",
        corps,
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(reponse["error"], "Invalid Web Push subscription");
    assert!(
        puits.abonnes().is_empty(),
        "un endpoint en clair n'est pas retenu"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn abonnement_400_corps_incomplet() {
    let (partage, _puits) = puits();
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.notifications = Some(partage);
    });
    let corps = json!({ "endpoint": "https://push.example/ep-1" })
        .to_string()
        .into_bytes();
    let (statut, reponse) = envoie_post(
        routeur(services, vec![]),
        "/api/notifications/subscriptions",
        corps,
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(reponse["error"], "Invalid Web Push subscription");
}

#[tokio::test(flavor = "multi_thread")]
async fn abonnement_503_sans_service() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let corps = json!({
        "endpoint": "https://push.example/ep-1",
        "keys": { "auth": "a", "p256dh": "p" }
    })
    .to_string()
    .into_bytes();
    let (statut, reponse) = envoie_post(
        routeur(services, vec![]),
        "/api/notifications/subscriptions",
        corps,
    )
    .await;
    assert_eq!(statut, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(reponse["error"], "Web Push is unavailable");
}

#[tokio::test(flavor = "multi_thread")]
async fn abonnement_500_ecriture_ratee() {
    let (partage, puits) = puits();
    puits.panne_abonnements(PortError::Upstream {
        code: String::from("EACCES"),
        message: String::from("store en lecture seule"),
    });
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.notifications = Some(partage);
    });
    let corps = json!({
        "endpoint": "https://push.example/ep-1",
        "keys": { "auth": "a", "p256dh": "p" }
    })
    .to_string()
    .into_bytes();
    let (statut, reponse) = envoie_post(
        routeur(services, vec![]),
        "/api/notifications/subscriptions",
        corps,
    )
    .await;
    assert_eq!(statut, StatusCode::INTERNAL_SERVER_ERROR);
    let message = reponse["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(
        message.contains("Could not save push subscription"),
        "{message}"
    );
}
