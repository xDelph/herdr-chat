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

#[tokio::test(flavor = "multi_thread")]
async fn apercu_le_dossier_d_un_projet_sans_agent_vient_de_ses_panes() {
    // D02 — mesuré le 2026-10-29 : `jarvis` et `herdr-agent` n'ont que des
    // panes shell ; sans `panes[]` du snapshot, leur `checkoutPath` restait
    // null (le fil TS le trouvait). Le premier pane du projet qui porte un
    // cwd fait foi, dans l'ordre du snapshot ; un worktree lié gagne.
    use domain::ids::{PaneId, WorkspaceId};
    use domain::observation::{SituatedPane, WorkspaceObservation};
    let mut photo = borne(vec![agent("w1:p2", "pi", None)]).snapshot;
    let mut sans_agent = photo.workspaces[0].clone();
    sans_agent.workspace_id = WorkspaceId::from(String::from("w3"));
    sans_agent.label = Some(String::from("jarvis"));
    sans_agent.worktree = None;
    photo.workspaces.push(sans_agent);
    let pane = |id: &str, espace: &str, cwd: Option<&str>| SituatedPane {
        pane_id: PaneId::from(String::from(id)),
        workspace_id: Some(WorkspaceId::from(String::from(espace))),
        cwd: cwd.map(String::from),
    };
    photo.panes = vec![
        pane("w3:p1", "w3", None),
        pane("w3:p2", "w3", Some("/projets/jarvis")),
        pane("w1:p1", "w1", Some("/projets/shell-d-abord")),
        pane("w1:p2", "w1", Some("/projets/atelier")),
    ];
    let attendu_w1 = match &photo.workspaces[0] {
        WorkspaceObservation {
            worktree: Some(worktree),
            ..
        } => worktree.checkout_path.clone(),
        _ => String::from("/projets/shell-d-abord"),
    };
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo);
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/overview").await;
    assert_eq!(statut, StatusCode::OK);
    let workspaces = corps["workspaces"]
        .as_array()
        .unwrap_or_else(|| panic!("workspaces"));
    let dossier = |id: &str| {
        workspaces
            .iter()
            .find(|workspace| workspace["workspaceId"] == id)
            .map(|workspace| workspace["checkoutPath"].clone())
            .unwrap_or_else(|| panic!("workspace {id} absent : {workspaces:?}"))
    };
    assert_eq!(
        dossier("w3"),
        "/projets/jarvis",
        "le pane shell porte le dossier"
    );
    assert_eq!(dossier("w1"), attendu_w1.as_str());
    let jarvis = workspaces
        .iter()
        .find(|workspace| workspace["workspaceId"] == "w3")
        .unwrap_or_else(|| panic!("w3"));
    assert_eq!(
        jarvis["agentPanes"],
        serde_json::json!([]),
        "un pane shell n'est pas un agent"
    );
}
