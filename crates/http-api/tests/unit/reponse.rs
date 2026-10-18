//! H10 — POST `/api/agents/:paneId/answer` : répondre à la question
//! affichée, avec la garde « le numéro est un choix réellement offert ».
//!
//! ⚠️ Un refus est une **valeur** (`refusee`), pas une erreur : rien n'a été
//! envoyé, et la cause est nommée. Un succès de transport n'est pas un succès
//! d'application : si l'invite est toujours là, c'est `transmise`.

use crate::unit::support::{envoie_post, services};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::ids::PaneId;
use domain::observation::ScreenObservation;
use domain::ports::TransportEvidence;
use http_api::router::routeur;
use serde_json::json;
use test_support::fake_herdr::{HerdrFaux, Op};

/// L'écran d'une question numérotée (le format mesuré d'opencode).
const QUESTION: &str =
    "Veux-tu exécuter ?\n1. Allow once\n2. Deny\n3. Type your own answer\nenter submit\n";

fn ecran(texte: &str) -> ScreenObservation {
    ScreenObservation {
        pane_id: PaneId::from(String::from("w1:p1")),
        text: Some(String::from(texte)),
        truncated: None,
        source: None,
    }
}

fn corps(numero: i64, texte: Option<&str>) -> Vec<u8> {
    match texte {
        Some(texte) => json!({ "numero": numero, "texte": texte })
            .to_string()
            .into_bytes(),
        None => json!({ "numero": numero }).to_string().into_bytes(),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn reponse_200_appliquee() {
    let faux = HerdrFaux::nouveau();
    // Avant : la question ; après : elle a disparu — l'application est un
    // fait OBSERVÉ.
    faux.scripte_ecrans("w1:p1", vec![ecran(QUESTION), ecran("travail en cours")]);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/answer",
        corps(1, None),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["status"], "question-answered");
    assert_eq!(corps["state"], "appliquee");
    let detail = corps["detail"].as_str().unwrap_or_else(|| panic!("detail"));
    assert!(detail.contains("Allow once"), "{detail}");
    // Le numéro ET l'entrée partent, dans cet ordre, sur LA cible.
    let ops: Vec<Op> = faux.actions().iter().map(|action| action.op).collect();
    assert!(ops.contains(&Op::EnvoiTouches));
    let touches = faux
        .actions()
        .into_iter()
        .find(|action| action.op == Op::EnvoiTouches)
        .unwrap_or_else(|| panic!("des touches partent"));
    assert_eq!(touches.cible, "w1:p1");
    assert_eq!(touches.detail, "2 touches", "le numéro puis l'entrée");
}

#[tokio::test(flavor = "multi_thread")]
async fn reponse_200_transmise_si_invite_toujours_la() {
    let faux = HerdrFaux::nouveau();
    // L'écran ne change pas : la frappe est partie, l'application n'est pas
    // prouvée.
    faux.remplace_ecran(ecran(QUESTION));
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/answer",
        corps(2, None),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["state"], "transmise");
}

#[tokio::test(flavor = "multi_thread")]
async fn reponse_200_refusee_numero_non_offert() {
    let faux = HerdrFaux::nouveau();
    faux.remplace_ecran(ecran(QUESTION));
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/answer",
        corps(7, None),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["state"], "refusee");
    let detail = corps["detail"].as_str().unwrap_or_else(|| panic!("detail"));
    assert!(detail.contains("only offers"), "{detail}");
    // RIEN n'est envoyé : un numéro que personne n'a proposé est un refus.
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::EnvoiTouches && action.op != Op::EnvoiTexte),
        "un choix non offert n'envoie rien"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reponse_200_refusee_sans_question_lisible() {
    let faux = HerdrFaux::nouveau();
    faux.remplace_ecran(ecran("travail en cours"));
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/answer",
        corps(1, None),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["state"], "refusee");
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::EnvoiTouches)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reponse_400_corps_sans_numero() {
    let (services, faux) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/answer",
        br#"{"numero":"un"}"#.to_vec(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(corps["error"], "invalid body: `numero` (integer) required");
    assert!(faux.actions().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn reponse_502_echec_herdr() {
    let faux = HerdrFaux::nouveau();
    faux.panne_sur(
        Op::LectureEcran,
        PortError::Transport {
            detail: String::from("socket fermé"),
        },
    );
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/answer",
        corps(1, None),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert!(corps["error"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn reponse_saisie_libre_ecrit_apres_le_choix() {
    let faux = HerdrFaux::nouveau();
    faux.scripte_ecrans("w1:p1", vec![ecran(QUESTION), ecran("travail en cours")]);
    faux.repond_envoi_texte(TransportEvidence {
        outcome: domain::ports::TransportOutcome::Delivered,
        partial: Vec::new(),
        detail: String::from("texte écrit"),
    });
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, _corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/answer",
        corps(3, Some("ma réponse libre")),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    // La séquence : choix + entrée, PUIS le texte, PUIS l'entrée de
    // validation — jamais le texte avant le choix.
    let ops: Vec<Op> = faux.actions().iter().map(|action| action.op).collect();
    let touches: Vec<usize> = ops
        .iter()
        .enumerate()
        .filter(|(_, op)| **op == Op::EnvoiTouches)
        .map(|(rang, _)| rang)
        .collect();
    let texte = ops
        .iter()
        .position(|op| *op == Op::EnvoiTexte)
        .unwrap_or_else(|| panic!("le texte part"));
    assert_eq!(touches.len(), 2, "choix puis validation");
    assert!(touches[0] < texte, "le choix précède le texte");
    assert!(texte < touches[1], "le texte précède la validation");
}
