//! H07 — POST `/api/workspaces/:workspaceId/agents` : le lancement, la seule
//! opération qui **crée** quelque chose chez Herdr.
//!
//! La preuve est celle du faux contrôle : l'ORDRE (onglet puis agent), la
//! cible et le nom ; un refus avant l'onglet laisse **zéro** action.

use crate::unit::support::{InventaireFaux, envoie_post, services, services_avec_types};
use axum::http::StatusCode;
use domain::ports::{CreatedTab, StartEvidence};
use http_api::router::routeur;
use serde_json::json;
use test_support::fake_herdr::{HerdrFaux, Op};

/// Un snapshot minimal avec le workspace `w1`, son dossier et son pane.
fn monde() -> HerdrFaux {
    let faux = HerdrFaux::nouveau();
    // Un agent déjà là, dans le projet : c'est lui qui porte le dossier de
    // travail (le dossier vient d'un pane, jamais d'une supposition).
    let mut observation = crate::unit::support::agent("w1:p1", "pi", None);
    observation.cwd = Some(String::from("/projets/atelier"));
    let mut photo = crate::unit::support::borne(vec![observation]).snapshot;
    photo.workspaces[0].label = Some(String::from("pixel"));
    faux.repond_snapshot(photo);
    faux
}

fn corps(kind: &str) -> Vec<u8> {
    json!({ "kind": kind }).to_string().into_bytes()
}

#[tokio::test(flavor = "multi_thread")]
async fn lancement_201_onglet_puis_agent() {
    let faux = monde();
    faux.repond_creation_tab(CreatedTab {
        pane: domain::ids::PaneId::from(String::from("w1:p4")),
        tab: domain::ids::TabId::from(String::from("w1:t2")),
    });
    faux.repond_lancement(StartEvidence::Started {
        pane: domain::ids::PaneId::from(String::from("w1:p4")),
    });
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/workspaces/w1/agents",
        corps("pi"),
    )
    .await;
    assert_eq!(statut, StatusCode::CREATED, "corps : {corps}");
    assert_eq!(corps["status"], "started");
    assert_eq!(corps["kind"], "pi");
    assert_eq!(corps["paneId"], "w1:p4");
    assert_eq!(corps["tabId"], "w1:t2");
    // Le nom est numéroté dès le premier agent du projet (jamais vide, jamais
    // le libellé brut sans suffixe).
    let nom = corps["name"].as_str().unwrap_or_else(|| panic!("name"));
    assert!(nom.starts_with("pixel-"), "{nom}");

    let ops: Vec<Op> = faux.actions().iter().map(|action| action.op).collect();
    let onglet = ops
        .iter()
        .position(|op| *op == Op::CreationTab)
        .unwrap_or_else(|| panic!("un onglet est créé"));
    let agent = ops
        .iter()
        .position(|op| *op == Op::LancementAgent)
        .unwrap_or_else(|| panic!("l'agent démarre"));
    assert!(onglet < agent, "l'onglet précède l'agent, jamais l'inverse");
}

#[tokio::test(flavor = "multi_thread")]
async fn lancement_400_type_non_installe_avec_indice() {
    let faux = monde();
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/workspaces/w1/agents",
        corps("gemini"),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(corps["error"], "agent type not installed: “gemini”");
    // L'indice nomme les types réellement offerts — et `cursor` n'y est pas :
    // installé n'est pas lisible (U14), donc pas proposé.
    let indice = corps["hint"].as_str().unwrap_or_else(|| panic!("hint"));
    assert!(indice.contains("pi"), "{indice}");
    assert!(!indice.contains("cursor"), "{indice}");
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::CreationTab),
        "un type refusé ne crée AUCUN onglet"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn lancement_400_corps_sans_kind() {
    let (services, faux) = services(monde(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/workspaces/w1/agents",
        br#"{"model":"x"}"#.to_vec(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST);
    assert_eq!(corps["error"], "invalid body: `kind` required");
    assert!(faux.actions().is_empty(), "un corps invalide n'agit pas");
}

#[tokio::test(flavor = "multi_thread")]
async fn lancement_503_decouverte_en_panne() {
    let faux = monde();
    let services = services_avec_types(faux, InventaireFaux::en_panne("integration.list a échoué"));
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/workspaces/w1/agents",
        corps("pi"),
    )
    .await;
    assert_eq!(statut, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(corps["error"], "agent types unavailable: launch refused");
    // La cause RÉELLE est portée : « je ne sais pas » n'est pas un message muet.
    assert_eq!(corps["hint"], "integration.list a échoué");
}

#[tokio::test(flavor = "multi_thread")]
async fn lancement_502_projet_disparu() {
    let faux = monde();
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/workspaces/w9/agents",
        corps("pi"),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert_eq!(corps["error"], "this project no longer exists");
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::CreationTab)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn lancement_400_validation_refusee_zero_onglet() {
    // `opencode` est installé ET son type est connu, mais la validation des
    // args refuse : le refus tombe AVANT tout onglet (C07). C'est l'ENTRÉE
    // qui est fautive (modèle, raisonnement) : 400 avec la cause, jamais un
    // 502 qui ferait croire à une panne d'Herdr.
    let faux = monde();
    let services = services_avec_types(
        faux.clone(),
        InventaireFaux::defaut().avec(application::types_installes::TypeInstalle {
            commande: String::from("opencode"),
            cible: String::from("opencode"),
            installe: true,
        }),
    );
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/workspaces/w1/agents",
        corps("opencode"),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "corps : {corps}");
    let message = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(message.contains("invalid launch request"), "{message}");
    assert!(
        faux.actions().is_empty(),
        "la validation refuse AVANT le snapshot et l'onglet"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn lancement_409_confiance_requise() {
    let faux = monde();
    faux.repond_creation_tab(CreatedTab {
        pane: domain::ids::PaneId::from(String::from("w1:p4")),
        tab: domain::ids::TabId::from(String::from("w1:t2")),
    });
    // L'amont dit « bloqué » : c'est une question à l'utilisateur, pas un
    // échec.
    faux.repond_lancement(StartEvidence::Failed {
        detail: String::from("agent is blocked and requires interactive input"),
    });
    faux.remplace_ecran(domain::observation::ScreenObservation {
        pane_id: domain::ids::PaneId::from(String::from("w1:p4")),
        text: Some(String::from("Do you trust this folder?\n1. Trust\n2. Quit")),
        truncated: None,
        source: None,
    });
    let (services, _) = services(faux.clone(), Default::default(), Default::default());
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/workspaces/w1/agents",
        corps("pi"),
    )
    .await;
    assert_eq!(statut, StatusCode::CONFLICT, "corps : {corps}");
    assert_eq!(corps["status"], "trust-required");
    assert_eq!(corps["kind"], "pi");
    assert_eq!(corps["paneId"], "w1:p4");
    // Le fil nomme le dossier par le libellé du PROJET (« pixel »), celui que
    // l'utilisateur reconnaît — pas le chemin interne.
    assert_eq!(corps["folder"], "pixel");
    let message = corps["message"]
        .as_str()
        .unwrap_or_else(|| panic!("message"));
    assert!(message.contains("trust"), "{message}");
    // La décision n'est JAMAIS prise ici : aucune touche n'est envoyée.
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::EnvoiTouches),
        "le lancement expose la confiance, il n'y répond pas"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn lancement_400_niveau_non_offert_par_le_modele() {
    // La validation de production refuse un niveau que le modèle n'offre pas
    // (`niveau_supporte`) : la CAUSE arrive au client, aucun onglet n'existe.
    let faux = monde();
    let services = crate::unit::support::services_retouches(faux.clone(), |services| {
        services.args = std::sync::Arc::new(
            |_kind: &str, modele: Option<&str>, thinking: Option<&str>| match (modele, thinking) {
                (Some(modele), Some(niveau)) if niveau == "xhigh" => Err(format!(
                    "“{modele}” does not offer the level “{niveau}” (available: low, high)"
                )),
                _ => Ok(Vec::new()),
            },
        );
    });
    let (statut, corps) = envoie_post(
        routeur(services, vec![]),
        "/api/workspaces/w1/agents",
        json!({ "kind": "pi", "model": "anthropic/claude-sonnet-4-5", "thinking": "xhigh" })
            .to_string()
            .into_bytes(),
    )
    .await;
    assert_eq!(statut, StatusCode::BAD_REQUEST, "corps : {corps}");
    let message = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(message.contains("does not offer the level"), "{message}");
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::CreationTab),
        "aucun onglet pour une demande refusée"
    );
}
