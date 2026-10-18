//! Les commandes agents : prompt, arrêt, focus.

use serde::{Deserialize, Serialize};

/// Le corps d'un prompt (`PromptBody`, mesuré — `{ text }`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub text: String,
}

/// Un prompt parti (confirmé ou non prouvé — A02 : deux états sur le fil,
/// jamais « envoyé » au hasard).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSentResponse {
    /// `confirmed | unknown` — la preuve du serveur, ou son absence assumée.
    pub confirmation: crate::events::Confirmation,
    pub fingerprint: String,
    /// Le littéral `"sent"`, union à un membre : sa présence est vérifiée.
    pub status: crate::events::PromptStatus,
}

/// Un prompt supprimé — double envoi assumé, pas une erreur (D007.2).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSuppressedResponse {
    pub reason: String,
    pub status: SuppressedStatus,
}

/// Le littéral `"suppressed"` — union à un membre, vérifiée au décodage.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SuppressedStatus {
    Suppressed,
}

/// Un prompt qui n'est pas parti — l'état réel, nommé, avec son détail.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptFailedResponse {
    pub detail: String,
    /// `attente | erreur | inconnu` — B05 : trois états, jamais « envoyé ».
    pub state: SendState,
}

/// L'union fermée des états d'un envoi non parti (libellés du fil exacts).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SendState {
    Attente,
    Erreur,
    Inconnu,
}

/// Une interruption demandée (`StopAgentResponse`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StopAgentResponse {
    /// `interrupt-sent | not-running` — reçu, pas prouvé exécuté.
    pub status: StopStatus,
}

/// L'union fermée des résultats d'arrêt.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum StopStatus {
    InterruptSent,
    NotRunning,
}

/// Un focus appliqué (`AgentFocusedResponse`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentFocusedResponse {
    pub focused: bool,
    /// Le littéral `"agent-focused"`, vérifié au décodage.
    pub status: FocusStatus,
}

/// Le littéral `"agent-focused"` — union à un membre.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum FocusStatus {
    AgentFocused,
}
