//! H08 `GET /api/agents/kinds` et H09 `GET /api/agents/:kind/models`.
//!
//! ⚠️ H08 : la liste est celle du **lancement** (C16) — un type installé mais
//! illisible (cursor) n'y est pas, un type absent non plus.
//! ⚠️ H09 : **aucune branche non-200** — un catalogue indisponible est une
//! VALEUR du 200 (`error` nommé, listes vides).

use crate::unit::support::{FauxCatalogue, requete_get, services_retouches};
use axum::http::StatusCode;
use domain::errors::PortError;
use http_api::router::routeur;
use std::sync::Arc;
use test_support::fake_herdr::HerdrFaux;

#[tokio::test(flavor = "multi_thread")]
async fn kinds_200_liste_du_lancement() {
    let services = services_retouches(HerdrFaux::nouveau(), |_| {});
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/kinds").await;
    assert_eq!(statut, StatusCode::OK);
    let kinds = corps["kinds"].as_array().unwrap_or_else(|| panic!("kinds"));
    let noms: Vec<&str> = kinds
        .iter()
        .map(|kind| kind["kind"].as_str().unwrap_or_else(|| panic!("kind")))
        .collect();
    assert_eq!(noms, vec!["pi", "claude"], "installés ET lisibles");
    // `cursor` est installé mais n'expose aucune session : jamais proposé.
    assert!(!noms.contains(&"cursor"));
    assert!(!noms.contains(&"gemini"), "non installé");
    // Le libellé et l'état sont ceux MESURÉS par Herdr — jamais un
    // « current » écrit pour tout le monde (H08).
    assert_eq!(kinds[0]["label"], "Pi");
    assert_eq!(kinds[0]["state"], "current");
    assert_eq!(kinds[1]["label"], "Claude Code");
    assert_eq!(kinds[1]["state"], "outdated");
}

#[tokio::test(flavor = "multi_thread")]
async fn kinds_502_etat_non_mesurable() {
    // L'état ne peut pas être lu (integration.list en panne côté catalogue) :
    // 502 nommé — jamais un état inventé pour compléter la liste.
    let services = services_retouches(HerdrFaux::nouveau(), |services| {
        services.catalogue = Arc::new(FauxCatalogue::en_panne(PortError::Upstream {
            code: String::from("integration.list"),
            message: String::from("socket fermé"),
        }));
    });
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/kinds").await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    let message = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(message.contains("socket fermé"), "{message}");
}

#[tokio::test(flavor = "multi_thread")]
async fn kinds_502_decouverte_en_panne() {
    let services = services_retouches(HerdrFaux::nouveau(), |services| {
        services.types = Arc::new(crate::unit::support::InventaireFaux::en_panne(
            "integration.list a échoué",
        ));
    });
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/kinds").await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    // La cause réelle est portée : jamais une liste vide présentée comme vraie.
    let message = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(message.contains("integration.list a échoué"), "{message}");
}

#[tokio::test(flavor = "multi_thread")]
async fn modeles_200_catalogue_mesure() {
    let services = services_retouches(HerdrFaux::nouveau(), |services| {
        services.catalogue = Arc::new(FauxCatalogue::defaut());
    });
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/pi/models").await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["kind"], "pi");
    // `error` est nullable OBLIGATOIRE : présent et null quand tout va bien.
    assert_eq!(corps["error"], serde_json::Value::Null);
    assert_eq!(corps["source"], "pi --list-models");
    let modeles = corps["models"]
        .as_array()
        .unwrap_or_else(|| panic!("models"));
    assert_eq!(modeles.len(), 1);
    assert_eq!(modeles[0]["id"], "anthropic/claude-sonnet-4-5");
    assert_eq!(modeles[0]["label"], "Claude Sonnet 4.5");
    assert_eq!(corps["thinkingLevels"], serde_json::json!(["low", "high"]));
}

#[tokio::test(flavor = "multi_thread")]
async fn modeles_200_type_sans_mecanisme_est_une_valeur() {
    let services = services_retouches(HerdrFaux::nouveau(), |services| {
        services.catalogue = Arc::new(FauxCatalogue::defaut());
    });
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/cursor/models").await;
    // H09 : pas de branche non-200 — l'absence est DITE au 200.
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["kind"], "cursor");
    assert_eq!(corps["error"], "no catalog mechanism for cursor");
    assert_eq!(corps["models"], serde_json::json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn modeles_200_panne_du_port_reste_une_valeur() {
    let services = services_retouches(HerdrFaux::nouveau(), |services| {
        services.catalogue = Arc::new(FauxCatalogue::en_panne(PortError::Transport {
            detail: String::from("processus interrompu"),
        }));
    });
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/agents/pi/models").await;
    assert_eq!(statut, StatusCode::OK);
    // La panne est visible dans `error`, la liste est vide — jamais un 502.
    let erreur = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(erreur.contains("catalog unavailable"), "{erreur}");
    assert_eq!(corps["models"], serde_json::json!([]));
}
