//! Catalogues mesurés et validité du lancement : rien n'est comblé.

use domain::catalog::{
    AgentModel, CatalogObservation, InstalledKindInstance, LaunchChoice, ValidatedArgs,
};
use domain::ids::{AgentKind, AgentName};

#[test]
fn un_catalogue_inconnu_reste_vide_et_nomme_sa_cause() {
    // Aucun mécanisme de listage connu : models vide + erreur explicite.
    // L'interface affiche l'absence, elle ne comble rien.
    let catalogue = CatalogObservation {
        kind: AgentKind::from("claude".to_string()),
        error: Some("aucun mécanisme de listage mesuré".to_string()),
        models: Vec::new(),
        thinking_levels: Vec::new(),
        source: "mesuré le 2026-10-18".to_string(),
    };
    assert!(catalogue.models.is_empty());
    assert!(catalogue.error.is_some());
    assert!(catalogue.thinking_levels.is_empty());
}

#[test]
fn un_modele_declare_ses_niveaus_propres() {
    // `thinkingLevels` est LA réponse à « quel raisonnement pour ce modèle » ;
    // mesuré par agent, vide quand l'agent ne le déclare pas.
    let modèle = AgentModel {
        label: Some("une étiquette lisible".to_string()),
        id: "glm-5".to_string(),
        thinking_levels: vec!["high".to_string(), "low".to_string()],
    };
    assert_eq!(modèle.id, "glm-5");
    assert_eq!(modèle.thinking_levels.len(), 2);
}

#[test]
fn un_kind_installé_cite_son_état_reel() {
    let installé = InstalledKindInstance {
        kind: AgentKind::from("pi".to_string()),
        label: "π".to_string(),
        state: "current".to_string(),
    };
    assert_eq!(installé.kind, AgentKind::from("pi".to_string()));
}

#[test]
fn un_choix_de_lancement_et_ses_arguments_validés_sont_deux_étapes() {
    // C07 : validé d'abord, tab ensuite. La demande garde `name` en option ;
    // l'objet validé le porte RESOLU — le nommage fait partie de la
    // validation, pas de la création.
    let demande = LaunchChoice {
        kind: AgentKind::from("pi".to_string()),
        model: None,
        provider: Some("zai".to_string()),
        name: None,
        thinking: Some("high".to_string()),
    };
    assert!(demande.name.is_none());
    assert!(demande.model.is_none(), "pas de modèle par défaut inventé");

    let validé = ValidatedArgs {
        kind: AgentKind::from("pi".to_string()),
        model: None,
        provider: Some("zai".to_string()),
        name: AgentName::from("pixel-1".to_string()),
        thinking: Some("high".to_string()),
    };
    assert_eq!(validé.name.as_str(), "pixel-1");
}
