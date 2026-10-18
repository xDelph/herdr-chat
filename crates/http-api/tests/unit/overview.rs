//! H02 — GET `/api/overview` (T050) : une vue composée du snapshot ; l'échec
//! de lecture amont = 500 nommé, jamais une vue vide présentée comme vraie.

use crate::unit::support::{agent, borne, requete_get, services};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::observation::SessionRefKind;
use http_api::router::routeur;
use test_support::fake_herdr::HerdrFaux;

#[tokio::test(flavor = "multi_thread")]
async fn apercu_200_vue_complete() {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(
        borne(vec![agent(
            "w1:p1",
            "claude-code",
            Some((SessionRefKind::Path, "wx.jsonl")),
        )])
        .snapshot,
    );
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/overview").await;
    assert_eq!(statut, StatusCode::OK);
    assert!(corps["agents"].is_array());
    assert!(corps["workspaces"].is_array());
    let agents = corps["agents"]
        .as_array()
        .unwrap_or_else(|| panic!("agents"));
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0]["paneId"], "w1:p1");
    assert_eq!(agents[0]["status"], "blocked");
    let workspaces = corps["workspaces"]
        .as_array()
        .unwrap_or_else(|| panic!("workspaces"));
    assert_eq!(workspaces.len(), 1);
    assert_eq!(workspaces[0]["workspaceId"], "w1");
}

#[tokio::test(flavor = "multi_thread")]
async fn apercu_500_lecture_en_panne() {
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Transport {
        detail: "socket deconnecte".to_string(),
    });
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/overview").await;
    assert_eq!(statut, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(corps["error"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn apercu_head_autorise() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let reponse =
        crate::unit::support::requete(routeur(services, vec![]), "HEAD", "/api/overview").await;
    assert_eq!(reponse.status(), StatusCode::OK);
}
