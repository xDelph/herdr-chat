//! L'adaptateur `CatalogPort` (T056 suite) : catalogues mesurés, liste
//! d'intégrations Herdr, validation de lancement.
//!
//! ⚠️ Aucun processus n'est lancé ici : les cas portent sur les **mappages**
//! (résultat de catalogue → observation, `integration.list` → types installés)
//! et sur la **validation** (C07). Le catalogue lui-même a ses tests dans
//! `catalog`.

use catalog::adapters::{ModeleCatalogue, ResultatCatalogue};
use catalog::port::{installees_depuis, observation_depuis, valide};
use domain::catalog::LaunchChoice;
use domain::errors::PortError;
use domain::ids::{AgentKind, AgentName};
use serde_json::json;

fn catalogue_vide(erreur: Option<&str>) -> ResultatCatalogue {
    ResultatCatalogue {
        erreur: erreur.map(str::to_string),
        modeles: Vec::new(),
        niveaux: Vec::new(),
        source: String::from("pi --list-models"),
    }
}

#[test]
fn un_catalogue_mesure_devient_une_observation() {
    let resultat = ResultatCatalogue {
        erreur: None,
        modeles: vec![ModeleCatalogue {
            id: String::from("anthropic/claude"),
            libelle: Some(String::from("Claude")),
            niveaux: vec![String::from("low"), String::from("high")],
        }],
        niveaux: vec![String::from("low"), String::from("high")],
        source: String::from("pi --list-models"),
    };
    let observation = observation_depuis(&AgentKind::from(String::from("pi")), &resultat);
    assert_eq!(observation.kind.as_str(), "pi");
    assert!(observation.error.is_none());
    assert_eq!(observation.models.len(), 1);
    assert_eq!(observation.models[0].id, "anthropic/claude");
    assert_eq!(observation.models[0].label.as_deref(), Some("Claude"));
    assert_eq!(observation.source, "pi --list-models");
}

#[test]
fn un_catalogue_sans_mecanisme_est_une_valeur_nommee() {
    // Un kind sans adaptateur : liste vide ET erreur — jamais une liste
    // inventée (H09).
    let observation = observation_depuis(
        &AgentKind::from(String::from("cursor")),
        &catalogue_vide(Some("pas de catalogue connu")),
    );
    assert_eq!(observation.error.as_deref(), Some("pas de catalogue connu"));
    assert!(observation.models.is_empty());
}

#[test]
fn la_liste_d_integrations_donne_les_types_installes() {
    let valeur = json!({
        "integrations": [
            { "available": true, "command": "pi", "label": "Pi", "state": "current", "target": "pi" },
            { "available": true, "command": "cursor-agent", "label": "Cursor", "state": "outdated", "target": "cursor" },
            { "available": false, "command": "gemini", "label": "Gemini", "state": "not_installed", "target": "gemini" }
        ]
    });
    let types = installees_depuis(&valeur);
    // ⚠️ `not_installed` est ÉCARTÉ : proposer un agent inexistant était le
    // défaut B07.
    assert_eq!(types.len(), 2);
    assert_eq!(types[0].kind.as_str(), "pi");
    assert_eq!(types[0].state, "current");
    assert_eq!(
        types[1].kind.as_str(),
        "cursor",
        "la cible, pas la commande"
    );
    assert_eq!(types[1].label, "Cursor");
    assert_eq!(types[1].state, "outdated", "les deux états fonctionnent");
}

#[test]
fn une_liste_absente_ou_illisible_ne_produit_rien() {
    // Pas d'`integrations` : rien, pas une liste inventée.
    assert!(installees_depuis(&json!({})).is_empty());
    assert!(installees_depuis(&json!({ "integrations": "non" })).is_empty());
    // Un élément sans `command` est écarté, les autres survivent.
    let partiel = json!({
        "integrations": [
            { "label": "sans commande", "state": "current" },
            { "command": "pi", "state": "current" }
        ]
    });
    let types = installees_depuis(&partiel);
    assert_eq!(types.len(), 1);
    assert_eq!(types[0].kind.as_str(), "pi");
}

#[test]
fn la_validation_exige_un_nom_et_laisse_la_politique_au_moteur() {
    // Nom absent : le port REFUSE plutôt que d'inventer un nom faux (la
    // politique de nom vit dans le moteur de lancement, T037).
    let sans_nom = LaunchChoice {
        kind: AgentKind::from(String::from("pi")),
        model: None,
        name: None,
        provider: None,
        thinking: None,
    };
    match valide(&sans_nom) {
        Err(PortError::Unsupported { feature }) => {
            assert!(feature.contains("naming policy"), "{feature}");
        }
        autre => panic!("un nom absent est refusé : {autre:?}"),
    }

    // Nom présent : la validation rend les args prêts, nom compris.
    let avec_nom = LaunchChoice {
        kind: AgentKind::from(String::from("pi")),
        model: Some(String::from("anthropic/claude")),
        name: Some(AgentName::from(String::from("atelier-1"))),
        provider: None,
        thinking: Some(String::from("high")),
    };
    let validee = valide(&avec_nom).unwrap_or_else(|cause| panic!("validation : {cause:?}"));
    assert_eq!(validee.name.as_str(), "atelier-1");
    assert_eq!(validee.model.as_deref(), Some("anthropic/claude"));
    assert_eq!(validee.thinking.as_deref(), Some("high"));
    assert_eq!(validee.kind.as_str(), "pi");
}
