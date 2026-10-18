//! H04 — GET `/api/agents/{paneId}/session` (T050) : la cartographie HTTP
//! des clauses du port de session. Le handler ne décide RIEN de lecture ;
//! chaque statut du manifeste (400/403/404/409/422/502/503) est prouvé, et
//! `tail`/`cursor`/`before` voyage tel quel jusqu'au port.

use crate::unit::support::{
    FauxSessionPort, agent, borne, page_vide, requete, requete_get, services,
};
use axum::http::StatusCode;
use domain::errors::ErreurDomaine;
use domain::observation::SessionRefKind;
use domain::session::{ResolvedSource, SessionEntry, SessionPage, SessionPageOutcome, SourceKind};
use http_api::router::routeur;
use std::sync::Arc;
use test_support::fake_herdr::HerdrFaux;

fn herdr_avec_agent(pane: &str) -> HerdrFaux {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(
        borne(vec![agent(
            pane,
            "claude-code",
            Some((SessionRefKind::Path, "wx.jsonl")),
        )])
        .snapshot,
    );
    faux
}

fn source() -> ResolvedSource {
    ResolvedSource {
        kind: SourceKind::File,
        base: "/sessions/pi/wx.jsonl".to_string(),
        session_id: None,
        family: None,
    }
}

fn page_avec_entrees() -> SessionPage {
    SessionPage {
        session_path: "/sessions/pi/wx.jsonl".to_string(),
        entries: vec![SessionEntry {
            kind: "message".to_string(),
            id: Some("m-1".to_string()),
            parent_id: None,
            raw: "{\"role\":\"user\",\"content\":\"salut\"}".to_string(),
            timestamp: Some("2026-10-15T10:00:00Z".to_string()),
        }],
        incremental: false,
        cursor: Some("hc2:LTAwMQ==".to_string()),
        previous_cursor: None,
        has_more: true,
        reset: false,
        rattrape: true,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn session_200_page_avec_entrees() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Ok(SessionPageOutcome::Page(page_avec_entrees()))),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::OK);
    // La cause du fil : « vide » même pour une page pleine (sémantique
    // mesurée, pas preuve de vacuité) ; caughtUp = le watermark C18.
    assert_eq!(corps["cause"], "vide");
    assert_eq!(corps["caughtUp"], true);
    assert_eq!(corps["hasMore"], true);
    assert_eq!(corps["reset"], false);
    assert_eq!(corps["incremental"], false);
    assert_eq!(corps["sessionPath"], "/sessions/pi/wx.jsonl");
    assert_eq!(corps["cursor"], "hc2:LTAwMQ==");
    let entrees = corps["entries"]
        .as_array()
        .unwrap_or_else(|| panic!("entrées"));
    assert_eq!(entrees.len(), 1);
    assert_eq!(entrees[0]["type"], "message");
    assert_eq!(entrees[0]["id"], "m-1");
    assert_eq!(entrees[0]["parentId"], serde_json::Value::Null);
    assert_eq!(entrees[0]["timestamp"], "2026-10-15T10:00:00Z");
}

#[tokio::test(flavor = "multi_thread")]
async fn session_200_absente_cause_absente() {
    let faux = herdr_avec_agent("w1:p1");
    let mut page = page_vide();
    page.rattrape = false;
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Ok(SessionPageOutcome::Absente(page))),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["cause"], "absente");
    // C18 : caughtUp présent seulement quand le watermark complet est vu.
    assert_eq!(corps["caughtUp"], serde_json::Value::Null);
    assert_eq!(corps["entries"], serde_json::json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn session_200_vide_cause_vide() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Ok(SessionPageOutcome::Vide(page_vide()))),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["cause"], "vide");
    assert_eq!(corps["entries"], serde_json::json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn session_422_illisible() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Ok(SessionPageOutcome::Invalide {
                detail: "ligne tronquée".to_string(),
            })),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(corps["cause"], "invalide");
    assert!(corps["error"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn session_502_lecture_io() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Ok(SessionPageOutcome::Io {
                detail: "permission refusée".to_string(),
            })),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert_eq!(corps["cause"], "io");
}

#[tokio::test(flavor = "multi_thread")]
async fn session_400_curseur_invalide() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Err(ErreurDomaine::entree_invalide(
                "curseur illisible".to_string(),
            ))),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, _corps) = requete_get(
        routeur(services, vec![]),
        "/api/agents/w1:p1/session?cursor=hk2:zz",
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_409_curseur_petime() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Err(ErreurDomaine::source_invalide(
                "le fichier de session a changé".to_string(),
            ))),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, _corps) = requete_get(
        routeur(services, vec![]),
        "/api/agents/w1:p1/session?before=hc2:yy",
    )
    .await;
    assert_eq!(statut, StatusCode::CONFLICT);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_503_base_manquante() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Err(ErreurDomaine::source_absente(
                "sqlite database not found".to_string(),
            ))),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::SERVICE_UNAVAILABLE);
    // Le 503 du fil est un message réel, jamais un simulacre générique.
    assert!(corps["error"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn session_403_chemin_refuse() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Err(ErreurDomaine::chemin_refuse("..".to_string()))),
    );
    let (services, _) = services(faux, Default::default(), port);
    let (statut, _corps) =
        requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::FORBIDDEN);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_404_agent_absent_du_snapshot() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(FauxSessionPort::nouveau().avec_source(Some(source())));
    let (services, _) = services(faux, Default::default(), port);
    let (statut, _corps) =
        requete_get(routeur(services, vec![]), "/api/agents/w1:inconnu/session").await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_404_aucune_source_resolue() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(FauxSessionPort::nouveau().avec_source(None));
    let (services, _) = services(faux, Default::default(), port);
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    // Le message DOCUMENTÉ du fil, pas un 502 indifférencié.
    assert_eq!(corps["error"], "no usable session path for this agent");
}

#[tokio::test(flavor = "multi_thread")]
async fn session_502_snapshot_illisible() {
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(domain::errors::PortError::Unsupported {
        feature: "proto 23".to_string(),
    });
    let port = Arc::new(FauxSessionPort::nouveau());
    let (services, _) = services(faux, Default::default(), port);
    let (statut, _corps) =
        requete_get(routeur(services, vec![]), "/api/agents/w1:p1/session").await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_tail_voyage_jusqu_au_port() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Ok(SessionPageOutcome::Vide(page_vide()))),
    );
    let (services, _) = services(faux, Default::default(), Arc::clone(&port));
    let (_, _) = requete_get(
        routeur(services, vec![]),
        "/api/agents/w1:p1/session?tail=100",
    )
    .await;
    let demandes = port.demandes();
    assert_eq!(demandes.len(), 1);
    assert_eq!(demandes[0].limit, 100);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_tail_malforme_et_plafond() {
    for (valeur, attendue) in [
        ("0", 512 * 1024),
        ("abc", 512 * 1024),
        ("1000000", 512 * 1024),
        ("32768", 32768),
    ] {
        let faux = herdr_avec_agent("w1:p1");
        let port = Arc::new(
            FauxSessionPort::nouveau()
                .avec_source(Some(source()))
                .avec_page(Ok(SessionPageOutcome::Vide(page_vide()))),
        );
        let (services, _) = services(faux, Default::default(), Arc::clone(&port));
        let uri = format!("/api/agents/w1:p1/session?tail={valeur}");
        let (statut, _) = requete_get(routeur(services, vec![]), &uri).await;
        assert_eq!(statut, StatusCode::OK, "tail = {valeur}");
        let demandes = port.demandes();
        assert_eq!(demandes[0].limit, attendue, "tail = {valeur}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn session_curseurs_opaques_voyages() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(
        FauxSessionPort::nouveau()
            .avec_source(Some(source()))
            .avec_page(Ok(SessionPageOutcome::Vide(page_vide()))),
    );
    let (services, _) = services(faux, Default::default(), Arc::clone(&port));
    let uri = "/api/agents/w1:p1/session?cursor=hc2:AAA&before=hc2:BBB";
    let (_, _) = requete_get(routeur(services, vec![]), uri).await;
    let demandes = port.demandes();
    assert_eq!(demandes[0].cursor.as_deref(), Some("hc2:AAA"));
    assert_eq!(demandes[0].previous_cursor.as_deref(), Some("hc2:BBB"));
}

#[tokio::test(flavor = "multi_thread")]
async fn session_head_autorise() {
    let faux = herdr_avec_agent("w1:p1");
    let port = Arc::new(FauxSessionPort::nouveau().avec_source(Some(source())));
    let (services, _) = services(faux, Default::default(), port);
    let reponse = requete(
        routeur(services, vec![]),
        "HEAD",
        "/api/agents/w1:p1/session",
    )
    .await;
    assert_eq!(reponse.status(), StatusCode::OK);
}
