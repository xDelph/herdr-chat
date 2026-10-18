//! Le lancement d'agent : demande, réponse, échecs nommés (B08).

use crate::presence::{Field, Nullable};
use serde::{Deserialize, Serialize};

/// Le corps de lancement (`LaunchAgentRequest`) — tout est omissible sauf le
/// type : les réglages absents laissent le profil de l'agent parler.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAgentRequest {
    pub kind: String,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub model: Field<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub provider: Field<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub name: Field<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub thinking: Field<String>,
}

/// Un lancement réussi (`LaunchAgentResponse`) — 201 sur le fil.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAgentResponse {
    pub kind: String,
    pub name: String,
    pub pane_id: String,
    pub status: StartedStatus,
    pub tab_id: String,
}

/// Le littéral `"started"` — union à un membre, vérifiée au décodage.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum StartedStatus {
    Started,
}

/// L'étape d'un lancement qui a coincé, union fermée mesurée
/// (`validation | onglet | agent | detection`) — l'interface dit OÙ ça a
/// coincé, l'utilisateur sait s'il faut nettoyer un onglet ou réessayer.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LaunchPhase {
    Validation,
    Onglet,
    Agent,
    Detection,
}

/// L'échec typé du lancement (`LaunchFailed`) — le pane peut exister déjà :
/// c'est pourquoi il est nullable et pourquoi l'onglet n'est pas refermé
/// dans ce cas.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LaunchFailed {
    pub detail: String,
    pub pane_id: Nullable<String>,
    pub phase: LaunchPhase,
}
