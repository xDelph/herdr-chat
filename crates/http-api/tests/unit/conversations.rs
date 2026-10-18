//! H03 — GET `/api/conversations` (T050) : une ligne par pane visible ;
//! l'absence de snapshot = 503 `{conversations:[]}` nommé, un snapshot
//! illisible = 502 même forme — jamais une liste devinée.

use crate::unit::support::{FauxSessions, SourceDeSession, agent, borne, requete_get, services};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::observation::SessionRefKind;
use http_api::router::routeur;
use test_support::fake_herdr::HerdrFaux;

fn source() -> SourceDeSession {
    SourceDeSession {
        kind: SessionRefKind::Path,
        base: Some(String::from("/sessions/pi")),
        session_id: None,
        cwd: None,
        parent: None,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn conversations_200_lignes() {
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
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/conversations").await;
    assert_eq!(statut, StatusCode::OK);
    assert!(corps["conversations"].is_array());
}

#[tokio::test(flavor = "multi_thread")]
async fn conversations_200_avec_sources_vraies() {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(
        borne(vec![agent(
            "w1:p1",
            "claude-code",
            Some((SessionRefKind::Path, "wx.jsonl")),
        )])
        .snapshot,
    );
    let porte_fenetres = FauxSessions::nouveau().avec_source("w1:p1", Some(source()));
    let (services, _) = services(faux, porte_fenetres, Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/conversations").await;
    assert_eq!(statut, StatusCode::OK);
    let lignes = corps["conversations"]
        .as_array()
        .unwrap_or_else(|| panic!("lignes"));
    assert_eq!(lignes.len(), 1);
    assert_eq!(lignes[0]["paneId"], "w1:p1");
}

#[tokio::test(flavor = "multi_thread")]
async fn conversations_503_pas_de_snapshot() {
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Upstream {
        code: String::from("500"),
        message: "snapshot indisponible".to_string(),
    });
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/conversations").await;
    assert_eq!(statut, StatusCode::SERVICE_UNAVAILABLE);
    // La forme vide du fil, pas une liste devinée.
    assert_eq!(
        corps["conversations"],
        serde_json::json!([]),
        "pas de snapshot = pas de liste, et on le dit"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn conversations_502_snapshot_illisible() {
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Unsupported {
        feature: "proto 23".to_string(),
    });
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/conversations").await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert_eq!(corps["conversations"], serde_json::json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn conversations_isolent_les_lignes() {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(
        borne(vec![
            agent("w1:p1", "claude-code", None),
            agent("w1:p2", "claude-code", None),
            agent("w1:p3", "claude-code", None),
        ])
        .snapshot,
    );
    let porte_fenetres = FauxSessions::nouveau()
        .avec_source("w1:p1", Some(source()))
        .avec_source("w1:p3", Some(source()))
        .avec_lecture(
            "w1:p3",
            Err(application::conversations::ErreurDeLecture {
                benin: false,
                cause: "fichier trop gros".to_string(),
            }),
        );
    let (services, _) = services(faux, porte_fenetres, Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/conversations").await;
    assert_eq!(statut, StatusCode::OK);
    let lignes = corps["conversations"]
        .as_array()
        .unwrap_or_else(|| panic!("lignes"));
    // Une ligne illisible n'écrase pas les lignes lisibles — l'isolation de
    // T039. La ligne p3 reste présente, marquée d'une erreur documentée.
    assert_eq!(lignes.len(), 3);
    let p3 = lignes
        .iter()
        .find(|l| l["paneId"] == "w1:p3")
        .unwrap_or_else(|| panic!("p3 présent"));
    assert_eq!(p3["sessionState"], "error");
}
