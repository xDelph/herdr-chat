//! H12 — POST `/api/agents/:paneId/trust` : trancher l'invite de confiance.
//!
//! ⚠️ **`state` est obligatoire** (C03) : le fil construisait `{accepted,
//! status}` et la validation de contrat produisait un 500 pour TOUT résultat
//! de service. Les quatre états sont ici portés, et `accepted` n'est vrai
//! que si l'acceptation est **prouvée**.

use crate::unit::support::{agent, borne, envoie_post, services};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::ids::{PaneId, TabId, WorkspaceId};
use domain::observation::{SessionRefKind, Snapshot};
use domain::status::AgentStatus;
use http_api::router::routeur;
use serde_json::json;
use test_support::fake_herdr::{HerdrFaux, Op};

const INVITE: &str = "Do you trust this folder?\n1. Trust this folder\n2. Quit";
const APRES: &str = "$ pret";

/// Un monde avec UN agent `claude` dans `w1:p1` — la famille décide des
/// touches.
fn monde(famille: &str) -> HerdrFaux {
    let faux = HerdrFaux::nouveau();
    let mut observation = agent("w1:p1", famille, Some((SessionRefKind::Path, "wx.jsonl")));
    observation.status = AgentStatus::Blocked;
    let mut photo: Snapshot = borne(vec![observation.clone()]).snapshot;
    photo.agents = vec![observation];
    photo.workspaces[0].workspace_id = WorkspaceId::from(String::from("w1"));
    photo.tabs = Some(vec![domain::observation::TabObservation {
        tab_id: TabId::from(String::from("t1")),
        workspace_id: WorkspaceId::from(String::from("w1")),
        label: Some(String::from("1")),
        number: 1,
        agent_status: None,
        pane_count: Some(1),
    }]);
    faux.repond_snapshot(photo);
    faux
}

fn ecran(texte: &str) -> domain::observation::ScreenObservation {
    domain::observation::ScreenObservation {
        pane_id: PaneId::from(String::from("w1:p1")),
        text: Some(String::from(texte)),
        truncated: None,
        source: None,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn confiance_200_acceptee() {
    let faux = monde("claude");
    faux.scripte_ecrans("w1:p1", vec![ecran(INVITE), ecran(APRES)]);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/trust",
        json!({ "accept": true }).to_string().into_bytes(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["status"], "trust-resolved");
    // C03 : `state` est là, et il dit ce qui est PROUVÉ.
    assert_eq!(corps["state"], "acceptee");
    assert_eq!(corps["accepted"], true);
    // claude : une sélection — descendre puis valider.
    let touches = faux
        .actions()
        .into_iter()
        .find(|action| action.op == Op::EnvoiTouches)
        .unwrap_or_else(|| panic!("les touches partent"));
    assert_eq!(touches.cible, "w1:p1");
    assert_eq!(touches.detail, "2 touches");
}

#[tokio::test(flavor = "multi_thread")]
async fn confiance_200_refusee() {
    let faux = monde("claude");
    faux.scripte_ecrans("w1:p1", vec![ecran(INVITE), ecran(APRES)]);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/trust",
        json!({ "accept": false }).to_string().into_bytes(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["state"], "refusee");
    assert_eq!(corps["accepted"], false);
    // claude refuse : valider l'option déjà surlignée — UNE touche.
    let touches = faux
        .actions()
        .into_iter()
        .find(|action| action.op == Op::EnvoiTouches)
        .unwrap_or_else(|| panic!("les touches partent"));
    assert_eq!(touches.detail, "1 touches");
}

#[tokio::test(flavor = "multi_thread")]
async fn confiance_200_transmise_si_invite_toujours_la() {
    let faux = monde("claude");
    // L'écran ne change pas : la frappe est partie, l'acceptation n'est pas
    // prouvée.
    faux.remplace_ecran(ecran(INVITE));
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/trust",
        json!({ "accept": true }).to_string().into_bytes(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["state"], "transmise");
    assert_eq!(corps["accepted"], false);
}

#[tokio::test(flavor = "multi_thread")]
async fn confiance_200_non_applicable_sans_invite() {
    let faux = monde("claude");
    faux.remplace_ecran(ecran(APRES));
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/trust",
        json!({ "accept": true }).to_string().into_bytes(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["state"], "non-applicable");
    assert_eq!(corps["accepted"], false);
    // L'invite n'était plus là : RIEN n'a été envoyé.
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::EnvoiTouches),
        "on ne touche pas à une invite absente"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn confiance_200_non_applicable_famille_inconnue() {
    // Une famille non mesurée : aucune touche n'est devinée — surtout pas
    // celles de codex (le défaut qui faisait SORTIR l'agent claude).
    let faux = monde("devin");
    faux.remplace_ecran(ecran(INVITE));
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/trust",
        json!({ "accept": true }).to_string().into_bytes(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["state"], "non-applicable");
    assert_eq!(corps["accepted"], false);
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::EnvoiTouches),
        "aucune touche non mesurée ne part"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn confiance_400_corps_sans_accept() {
    let (services, faux) = services(monde("claude"), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/trust",
        br#"{"accept":"oui"}"#.to_vec(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(corps["error"], "invalid body: `accept` (boolean) required");
    assert!(faux.actions().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn confiance_502_echec_herdr() {
    let faux = monde("claude");
    faux.panne_sur(
        Op::LectureEcran,
        PortError::Transport {
            detail: String::from("socket ferme"),
        },
    );
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/trust",
        json!({ "accept": true }).to_string().into_bytes(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert!(corps["error"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn confiance_agent_mort_ne_prouve_rien() {
    // L'invite a disparu, mais l'agent n'est plus là : un agent mort
    // n'affiche plus d'invite non plus — « transmise », jamais « accordée ».
    let faux = monde("claude");
    faux.scripte_ecrans("w1:p1", vec![ecran(INVITE), ecran(APRES)]);
    // La famille est lue avec l'agent encore là ; la preuve d'existence est
    // lue APRÈS les touches — et l'agent a disparu : rien n'est prouvé.
    let avec_agent = crate::unit::support::borne(vec![agent(
        "w1:p1",
        "claude",
        Some((SessionRefKind::Path, "wx.jsonl")),
    )])
    .snapshot;
    faux.scripte_snapshots(vec![avec_agent, Snapshot::default()]);
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/trust",
        json!({ "accept": true }).to_string().into_bytes(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["state"], "transmise");
    assert_eq!(corps["accepted"], false);
}
