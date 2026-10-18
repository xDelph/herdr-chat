//! H05 — POST `/api/agents/:paneId/prompt` : l'envoi, la déduplication
//! APRÈS preuve, l'état B05 nommé, et le mode « frappes » d'un agent bloqué.
//!
//! La preuve est celle du faux contrôle : chaque action capturée dit la
//! cible ET l'ordre — un refus ne laisse **aucune** action.

use crate::unit::support::{agent, borne, envoie_post, services};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::observation::SessionRefKind;
use domain::ports::{PromptEvidence, TransportEvidence, TransportOutcome};
use domain::status::AgentStatus;
use http_api::router::routeur;
use serde_json::{Value, json};
use std::sync::Arc;
use test_support::fake_herdr::{HerdrFaux, Op};

fn corps_texte(texte: &str) -> Vec<u8> {
    json!({ "text": texte }).to_string().into_bytes()
}

fn herdr_avec_agent(status: AgentStatus) -> HerdrFaux {
    let faux = HerdrFaux::nouveau();
    let mut observation = agent("w1:p1", "claude", Some((SessionRefKind::Path, "wx.jsonl")));
    observation.status = status;
    faux.repond_snapshot(borne(vec![observation]).snapshot);
    faux
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_200_confirme() {
    let faux = herdr_avec_agent(AgentStatus::Working);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte("bonjour"),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["status"], "sent");
    assert_eq!(corps["confirmation"], "confirmed");
    // L'empreinte est celle du fil : 32 hexadécimaux de `SHA-256(cible\0texte)`.
    let empreinte = corps["fingerprint"]
        .as_str()
        .unwrap_or_else(|| panic!("empreinte"));
    assert_eq!(empreinte.len(), 32);
    // La cible capturée est CELLE DU CHEMIN, jamais une autre.
    let actions = faux.actions();
    let envoi = actions
        .iter()
        .find(|action| action.op == Op::Prompt)
        .unwrap_or_else(|| panic!("un prompt est parti"));
    assert_eq!(envoi.cible, "w1:p1");
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_200_supprime_le_doublon() {
    let faux = herdr_avec_agent(AgentStatus::Working);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let premiere = envoie_post(
        routeur(Arc::clone(&services), vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte("même texte"),
    )
    .await;
    assert_eq!(premiere.0, StatusCode::OK);
    assert_eq!(premiere.1["status"], "sent");

    let seconde = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte("même texte"),
    )
    .await;
    assert_eq!(seconde.0, StatusCode::OK);
    assert_eq!(seconde.1["status"], "suppressed");
    assert_eq!(
        seconde.1["reason"],
        "identical send already confirmed within the window"
    );
    // Un double supprimé n'a envoyé qu'UNE fois : le no-op n'agit pas.
    let envois = faux
        .actions()
        .iter()
        .filter(|action| action.op == Op::Prompt)
        .count();
    assert_eq!(envois, 1, "le doublon supprimé ne rejoue rien");
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_400_corps_sans_texte() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        br#"{"prompt":"x"}"#.to_vec(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(corps["error"], "invalid body: `text` (string) required");
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_413_octets_utf8() {
    let faux = herdr_avec_agent(AgentStatus::Working);
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    // 20 000 « é » = 40 000 octets pour 20 000 caractères : la limite est en
    // OCTETS, et rien ne part.
    let texte = "é".repeat(20_000);
    let (statut, _corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte(&texte),
    )
    .await;
    assert_eq!(statut, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(
        faux.actions().iter().all(|action| action.op != Op::Prompt),
        "un prompt trop long ne part jamais"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_502_etat_inconnu_sur_transport() {
    let faux = herdr_avec_agent(AgentStatus::Working);
    faux.panne_sur(
        Op::Prompt,
        PortError::Transport {
            detail: String::from("socket fermé"),
        },
    );
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte("bonjour"),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    // B05 : un transport muet n'a rien prouvé — « inconnu », jamais « perdu ».
    assert_eq!(corps["state"], "inconnu");
    assert!(corps["detail"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_502_etat_attente_sur_delai() {
    let faux = herdr_avec_agent(AgentStatus::Working);
    faux.panne_sur(Op::Prompt, PortError::Timeout);
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte("bonjour"),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    // Un délai ne prouve ni l'envoi ni le refus : « attente ».
    assert_eq!(corps["state"], "attente");
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_502_etat_erreur_sur_refus_amont() {
    let faux = herdr_avec_agent(AgentStatus::Working);
    faux.panne_sur(
        Op::Prompt,
        PortError::Upstream {
            code: String::from("-32600"),
            message: String::from("agent not found"),
        },
    );
    let (services, _) = services(faux, Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte("bonjour"),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    // Un refus amont est un envoi perdu : « erreur ».
    assert_eq!(corps["state"], "erreur");
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_agent_bloque_passe_par_les_frappes() {
    let faux = herdr_avec_agent(AgentStatus::Blocked);
    faux.repond_envoi_texte(TransportEvidence {
        outcome: TransportOutcome::Delivered,
        partial: Vec::new(),
        detail: String::from("frappes écrites"),
    });
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte("ma réponse"),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    // Les frappes écrites ne prouvent pas l'application : « unknown ».
    assert_eq!(corps["confirmation"], "unknown");
    let ops: Vec<Op> = faux.actions().iter().map(|action| action.op).collect();
    assert!(
        !ops.contains(&Op::Prompt),
        "un agent bloqué ne reçoit JAMAIS agent.prompt"
    );
    assert!(ops.contains(&Op::EnvoiTexte));
    assert!(ops.contains(&Op::EnvoiTouches), "l'entrée valide le texte");
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_agent_inconnu_reste_un_prompt() {
    // Un pane sans agent : le statut n'est pas « bloqué », donc le prompt
    // littéral part — c'est Herdr qui tranche, pas une supposition.
    let (services, faux) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p9/prompt",
        corps_texte("bonjour"),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["confirmation"], "confirmed");
    let ops: Vec<Op> = faux.actions().iter().map(|action| action.op).collect();
    assert!(ops.contains(&Op::Prompt));
}

/// Le refus déclenché par Herdr bascule en frappes seulement sur le texte
/// mesuré de la saisie interactive (le fil faisait de même).
#[tokio::test(flavor = "multi_thread")]
async fn prompt_refus_de_saisie_bascule_en_frappes() {
    let faux = herdr_avec_agent(AgentStatus::Working);
    faux.repond_prompt(PromptEvidence::Failed {
        detail: String::from("agent w1:p1 is blocked and requires interactive input"),
    });
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte("ma réponse"),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["confirmation"], "unknown");
    let ops: Vec<Op> = faux.actions().iter().map(|action| action.op).collect();
    assert!(ops.contains(&Op::EnvoiTexte));
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_corps_trop_grand_est_refuse_par_la_garde() {
    let (services, faux) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let gros = "x".repeat(70 * 1024);
    let (statut, _corps) = envoie_post(
        routeur(services, vec![]),
        "/api/agents/w1:p1/prompt",
        corps_texte(&gros),
    )
    .await;
    assert_eq!(statut, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(
        faux.actions().is_empty(),
        "la garde court avant toute action"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn prompt_sans_origine_403_aucune_action() {
    let (services, faux) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let reponse = routeur(services, vec![])
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/agents/w1:p1/prompt")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(corps_texte("bonjour")))
                .unwrap_or_else(|cause| panic!("requête : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause:?}"));
    assert_eq!(reponse.status(), StatusCode::FORBIDDEN);
    assert!(faux.actions().is_empty(), "aucune action avant la garde");
}

use tower::ServiceExt as _;

/// Le corps JSON d'une réponse — le helper local (les tests H05 lisent des
/// objets typés, pas seulement des statuts).
#[allow(dead_code)]
fn erreur(corps: &Value) -> String {
    corps["error"]
        .as_str()
        .unwrap_or_else(|| panic!("error"))
        .to_string()
}
