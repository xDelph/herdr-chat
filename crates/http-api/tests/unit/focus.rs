//! H11 — POST `/api/agents/:paneId/focus` : l'échec reste une **valeur**
//! (`focused: false` au 200), jamais une erreur du fil.

use crate::unit::support::{envoie_post, services};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::ports::FocusEvidence;
use http_api::router::routeur;
use test_support::fake_herdr::{HerdrFaux, Op};

#[tokio::test(flavor = "multi_thread")]
async fn focus_200_focalise() {
    let faux = HerdrFaux::nouveau();
    faux.repond_focus(FocusEvidence::Focused);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/focus",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["focused"], true);
    assert_eq!(corps["status"], "agent-focused");
    let focus = faux
        .actions()
        .into_iter()
        .find(|action| action.op == Op::Focus)
        .unwrap_or_else(|| panic!("un focus part"));
    assert_eq!(focus.cible, "w1:p1");
}

#[tokio::test(flavor = "multi_thread")]
async fn focus_200_refus_garde_une_valeur() {
    let faux = HerdrFaux::nouveau();
    faux.repond_focus(FocusEvidence::Refused {
        detail: String::from("pane disparu"),
    });
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/focus",
        Vec::new(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["focused"], false);
    assert_eq!(corps["status"], "agent-focused");
}

#[tokio::test(flavor = "multi_thread")]
async fn focus_200_panne_herdr_reste_une_valeur() {
    let faux = HerdrFaux::nouveau();
    faux.panne_sur(
        Op::Focus,
        PortError::Transport {
            detail: String::from("socket ferme"),
        },
    );
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/focus",
        Vec::new(),
    )
    .await;
    // H11 : l'echec Herdr rend `focused:false` - pas un 502.
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["focused"], false);
}
