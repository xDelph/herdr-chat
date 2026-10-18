//! Catalogues d'agents et validité d'un lancement.
//!
//! ⚠️ **Rien n'est codé en dur.** Les modèles d'un kind sont **mesurés** par
//! la commande qui les déclare (`source` l'atteste) ; un kind dont la liste
//! n'a pas pu être obtenue est rendu avec des modèles **vides** et une erreur
//! qui l'explique — l'interface affiche l'absence, elle ne comble rien.
//!
//! ⚠️ **Pas de `default`.** Un modèle non choisi est un modèle laissé au choix
//! de l'agent, pas un modèle « par défaut » choisi par cette application.

use crate::ids::{AgentKind, AgentName};

/// Un modèle, tel que l'agent le déclare lui-même.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AgentModel {
    /// Libellé lisible quand l'agent en fournit un.
    pub label: Option<String>,
    /// Identifiant à passer au flag `--model`.
    pub id: String,
    /// Niveaux de raisonnement **supportés par ce modèle**.
    pub thinking_levels: Vec<String>,
}

/// Le catalogue d'un type d'agent, tel que mesuré.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CatalogObservation {
    /// Le kind interrogé — le catalogue est **vérifié par exécution** par kind.
    pub kind: AgentKind,
    /// Erreur explicite quand aucun mécanisme de listage n'est connu ; la
    /// liste reste vide et honnête.
    pub error: Option<String>,
    pub models: Vec<AgentModel>,
    /// Niveaux de raisonnement **possibles** sur cet agent, tous modèles
    /// confondus. Vide si l'agent ne les déclare pas.
    pub thinking_levels: Vec<String>,
    /// La commande qui a produit cette liste — traçable, donc vérifiable.
    pub source: String,
}

/// Un type d'agent **réellement installé** sur la machine.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct InstalledKindInstance {
    /// La valeur à passer à `agent.start`.
    pub kind: AgentKind,
    /// Libellé lisible.
    pub label: String,
    /// `current` ou `outdated` — les deux fonctionnent.
    pub state: String,
}

/// Ce que l'appelant demande au moment de lancer.
///
/// `model`/`provider`/`thinking` restent des options : validés contre le
/// catalogue du kind **avant** toute création de tab (C07) — un agent refuse
/// un niveau qu'il ne connaît pas, et le serveur n'invente rien.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LaunchChoice {
    pub kind: AgentKind,
    pub model: Option<String>,
    pub provider: Option<String>,
    /// Nom choisi ; absent = la politique de nom de lancement s'applique
    /// (numérotation dès le premier, voir `naming::launch_name`).
    pub name: Option<AgentName>,
    pub thinking: Option<String>,
}

/// Une demande de lancement **validée** : prête à créer tab et pane.
///
/// ⚠️ Le nom est **présent** ici : la résolution du nom (choix explicite ou
/// suffixe mesuré) fait partie de la validation, pas de la création.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ValidatedArgs {
    pub kind: AgentKind,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub name: AgentName,
    pub thinking: Option<String>,
}
