//! Les tâches de fond d'un agent (H20/H21) — sous-agents lancés en
//! arrière-plan et commandes passées en fond, lus dans les fichiers de
//! l'agent (Claude Code aujourd'hui), jamais dans Herdr.
//!
//! ⚠️ **Un état invérifiable n'est jamais présenté comme vrai** : sans fin
//! écrite ni activité récente, une tâche est `inconnu`, pas `en_cours`.

use crate::presence::Field;
use serde::{Deserialize, Serialize};

/// La sorte d'une tâche de fond.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundTaskKind {
    /// Un sous-agent lancé en arrière-plan.
    Agent,
    /// Une commande shell passée en arrière-plan.
    Commande,
}

/// L'état d'une tâche de fond — union fermée.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundTaskStatus {
    EnCours,
    Terminee,
    Echouee,
    Arretee,
    /// Ni fin écrite, ni activité depuis 30 min : on ne sait pas.
    Inconnu,
}

/// Une tâche de fond.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTask {
    pub id: String,
    pub kind: BackgroundTaskKind,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub description: Field<String>,
    /// Le type de sous-agent (`general-purpose`, `fork`…).
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub agent_type: Field<String>,
    pub status: BackgroundTaskStatus,
    /// Millisecondes epoch — absent quand la source ne le date pas.
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub started_at: Field<u64>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub ended_at: Field<u64>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub last_activity: Field<u64>,
    /// Le résumé écrit par l'agent à la fin.
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub summary: Field<String>,
    /// `true` : la transcription est lisible sur
    /// `/api/agents/{paneId}/taches/{id}/session`.
    pub transcript: bool,
}

/// La réponse de H20.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTasksResponse {
    pub pane_id: String,
    /// `false` : la famille de l'agent n'expose pas de tâches de fond
    /// lisibles — une capacité ABSENTE, pas une liste vide.
    pub supported: bool,
    pub tasks: Vec<BackgroundTask>,
}

/// Le décompte porté par une ligne de liste (`ConversationSummary`).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskCount {
    pub en_cours: u64,
    pub total: u64,
}
