//! H01 — GET `/api/health` (T050) : le ping porté tel quel, jamais un
//! substitut ; 200 et 503 portent le MÊME schéma `ok:false` ; ce que le fil
//! ne sait pas lire (500) reste nommé.

use crate::unit::support::{requete, requete_get, services};
use axum::http::StatusCode;
use domain::errors::PortError;
use http_api::router::routeur;
use test_support::fake_herdr::HerdrFaux;

#[tokio::test(flavor = "multi_thread")]
async fn sante_200_reachable() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/health").await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["ok"], true);
    assert_eq!(corps["herdr"]["reachable"], true);
    assert_eq!(corps["herdr"]["protocol"], 22);
    assert_eq!(corps["herdr"]["version"], "0.9.3");
    assert_eq!(corps["herdr"]["socket"], "/tmp/herdr-remote/herdr.sock");
    assert_eq!(corps["log"], "/tmp/herdr-remote/herdr.log");
    assert!(corps["uptimeMs"].is_number());
}

#[tokio::test(flavor = "multi_thread")]
async fn sante_503_meme_schema() {
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Transport {
        detail: "socket deconnecte".to_string(),
    });
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/health").await;
    // Le 503 du fil porte le même schéma que le 200 — pas un corps inventé.
    assert_eq!(statut, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(corps["ok"], false);
    assert_eq!(corps["herdr"]["reachable"], false);
}

#[tokio::test(flavor = "multi_thread")]
async fn sante_500_illisible() {
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Unsupported {
        feature: "proto 23".to_string(),
    });
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/health").await;
    // Un ping que le fil ne sait pas lire : 500 nommé, pas un 503 générique.
    assert_eq!(statut, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(corps["error"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn sante_head_autorise() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let reponse = requete(routeur(services, vec![]), "HEAD", "/api/health").await;
    assert_eq!(reponse.status(), StatusCode::OK);
}

#[tokio::test(flavor = "multi_thread")]
async fn sante_post_405_allow() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let reponse = requete(routeur(services, vec![]), "POST", "/api/health").await;
    assert_eq!(reponse.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(
        reponse.headers().get("allow").and_then(|v| v.to_str().ok()),
        Some("GET, HEAD")
    );
}
