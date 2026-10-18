//! Le catalogage : types installés et modèles d'un agent.

use crate::presence::Field;
use serde::{Deserialize, Serialize};

/// Un type d'agent installé sur la machine (`InstalledKind`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstalledKind {
    pub kind: String,
    pub label: String,
    pub state: String,
}

/// La liste des types installés (`InstalledKindsResponse`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstalledKindsResponse {
    pub kinds: Vec<InstalledKind>,
}

/// Un modèle d'agent (`AgentModel`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentModel {
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub label: Field<String>,
    pub id: String,
    pub thinking_levels: Vec<String>,
}

/// Le catalogue d'un type (`ModelCatalogResponse`) — `error` est **nullable
/// obligatoire** : présent, souvent null ; une panne de catalogage reste
/// visible, jamais effacée.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogResponse {
    pub error: crate::presence::Nullable<String>,
    pub kind: String,
    pub models: Vec<AgentModel>,
    pub thinking_levels: Vec<String>,
    pub source: String,
}
