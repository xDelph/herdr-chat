//! H13 `POST /api/log` : la remontée d'erreur du navigateur — `{ok:true}` au
//! 200, `{ok:false}` au 400, jamais un 500 (un journal en panne ne doit pas
//! casser l'écran qui signale une panne).

use crate::unit::support::{envoie_post, services};
use axum::http::StatusCode;
use http_api::router::routeur;
use serde_json::json;
use test_support::fake_herdr::HerdrFaux;

#[tokio::test(flavor = "multi_thread")]
async fn log_200_ok_true() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let corps = json!({
        "level": "error",
        "message": "TypeError: x is undefined",
        "detail": { "stack": "at main.ts:12" }
    })
    .to_string()
    .into_bytes();
    let (statut, reponse) = envoie_post(routeur(services, vec![]), "/api/log", corps).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(reponse["ok"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn log_200_sans_detail() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let corps = json!({ "level": "error", "message": "panne" })
        .to_string()
        .into_bytes();
    let (statut, reponse) = envoie_post(routeur(services, vec![]), "/api/log", corps).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(reponse["ok"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn log_400_message_absent() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let corps = json!({ "level": "error" }).to_string().into_bytes();
    let (statut, reponse) = envoie_post(routeur(services, vec![]), "/api/log", corps).await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(reponse["ok"], false);
}

#[tokio::test(flavor = "multi_thread")]
async fn log_400_niveau_inconnu() {
    // Le fil ne connaît QU'un niveau : `error`. Un autre niveau est un corps
    // invalide, jamais une entrée à moitié acceptée.
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let corps = json!({ "level": "info", "message": "coucou" })
        .to_string()
        .into_bytes();
    let (statut, reponse) = envoie_post(routeur(services, vec![]), "/api/log", corps).await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(reponse["ok"], false);
}

#[tokio::test(flavor = "multi_thread")]
async fn log_400_corps_non_json() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let (statut, reponse) = envoie_post(
        routeur(services, vec![]),
        "/api/log",
        b"pas du json".to_vec(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(reponse["ok"], false);
}
