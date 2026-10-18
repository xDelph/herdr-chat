//! H06 — POST `/api/agents/:paneId/stop` : une interruption **demandée**,
//! jamais un arrêt prouvé, et une décision prise sur une photo fraîche.

use crate::unit::support::{agent, borne, envoie_post, services};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::observation::SessionRefKind;
use domain::ports::StopEvidence;
use domain::status::AgentStatus;
use http_api::router::routeur;
use test_support::fake_herdr::{HerdrFaux, Op};

fn herdr_avec(status: AgentStatus) -> HerdrFaux {
    let faux = HerdrFaux::nouveau();
    let mut observation = agent("w1:p1", "claude", Some((SessionRefKind::Path, "wx.jsonl")));
    observation.status = status;
    faux.repond_snapshot(borne(vec![observation]).snapshot);
    faux
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_200_interrupt_sent() {
    let faux = herdr_avec(AgentStatus::Working);
    faux.repond_arret(StopEvidence::InterruptSent);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/stop",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["status"], "interrupt-sent");
    // La cible du Ctrl+C est celle du chemin — jamais une autre.
    let arret = faux
        .actions()
        .into_iter()
        .find(|action| action.op == Op::Arret)
        .unwrap_or_else(|| panic!("un arrêt est parti"));
    assert_eq!(arret.cible, "w1:p1");
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_200_not_running_pour_un_agent_au_repos() {
    let faux = herdr_avec(AgentStatus::Idle);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/stop",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["status"], "not-running");
    // Rien à interrompre : aucune touche n'est envoyée.
    assert!(
        faux.actions().iter().all(|action| action.op != Op::Arret),
        "un agent au repos ne reçoit pas de Ctrl+C"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_404_agent_absent() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p9/stop",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    // Le message reste vrai sans interpoler l'identifiant interne (le port
    // retire les `wX:pY` de tout message destiné à l'écran).
    assert_eq!(corps["error"], "no Herdr agent in this pane");
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_502_transmission_ratee() {
    let faux = herdr_avec(AgentStatus::Working);
    faux.panne_sur(
        Op::Arret,
        PortError::Upstream {
            code: String::from("-32603"),
            message: String::from("keys rejected"),
        },
    );
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/stop",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert!(corps["error"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_502_snapshot_indisponible() {
    let faux = herdr_avec(AgentStatus::Working);
    faux.panne_sur(Op::Snapshot, PortError::Timeout);
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, _corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/stop",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_502_snapshot_illisible_est_distinct() {
    let faux = herdr_avec(AgentStatus::Working);
    faux.panne_sur(
        Op::Snapshot,
        PortError::Transport {
            detail: String::from("enveloppe illisible"),
        },
    );
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/stop",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    // La cause nommee : un snapshot illisible n'est pas « l'amont
    // indisponible ».
    let message = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(message.contains("illisible"), "{message}");
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_course_agent_fini_entre_photo_et_envoi() {
    // La photo dit `working`, mais le port répond « plus en cours » : la
    // course est dite, jamais transformée en faux envoi.
    let faux = herdr_avec(AgentStatus::Working);
    faux.repond_arret(StopEvidence::NotRunning);
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/stop",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["status"], "not-running");
}
