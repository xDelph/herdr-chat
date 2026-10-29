//! H22 — POST `/api/agents/:paneId/read` : la lecture partagée entre
//! appareils. Elle ne recule jamais, un corps invalide est un 400 nommé, et
//! la liste (H03) porte `readAt`. Lire ne touche jamais Herdr.

use crate::unit::support::{agent, borne, envoie_post, requete_get, services};
use axum::http::StatusCode;
use domain::observation::SessionRefKind;
use http_api::router::routeur;
use test_support::fake_herdr::HerdrFaux;

#[tokio::test(flavor = "multi_thread")]
async fn la_lecture_est_partagee_et_ne_recule_jamais() {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(
        borne(vec![agent(
            "w1:p1",
            "claude-code",
            Some((SessionRefKind::Path, "wx.jsonl")),
        )])
        .snapshot,
    );
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services.clone(), vec![]),
        "/api/agents/w1:p1/read",
        br#"{"at":1000}"#.to_vec(),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["paneId"], "w1:p1");
    assert_eq!(corps["readAt"], 1000);

    // Un appareil en retard ne fait pas reculer la lecture.
    let (_, corps) = envoie_post(
        routeur(services.clone(), vec![]),
        "/api/agents/w1:p1/read",
        br#"{"at":500}"#.to_vec(),
    )
    .await;
    assert_eq!(corps["readAt"], 1000);
    // Lire ne touche jamais Herdr : aucune action avant la relecture de la liste.
    assert!(faux.actions().is_empty(), "{:?}", faux.actions());

    // La liste la porte, pour tous les appareils.
    let (_, liste) = requete_get(routeur(services, vec![]), "/api/conversations").await;
    let lignes = liste["conversations"]
        .as_array()
        .unwrap_or_else(|| panic!("lignes"));
    assert_eq!(lignes[0]["readAt"], 1000);
}

#[tokio::test(flavor = "multi_thread")]
async fn un_corps_invalide_est_un_400_nomme() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/read",
        br#"{"at":"hier"}"#.to_vec(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert!(
        corps["error"]
            .as_str()
            .is_some_and(|message| message.contains("`at`")),
        "{corps}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn sans_lecture_la_liste_n_invente_pas_de_read_at() {
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
    let (_, liste) = requete_get(routeur(services, vec![]), "/api/conversations").await;
    assert!(liste["conversations"][0].get("readAt").is_none(), "{liste}");
}
