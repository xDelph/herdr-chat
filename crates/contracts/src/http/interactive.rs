//! Les interactions : question posée par un agent, réponse, confiance.

use crate::presence::Field;
use serde::{Deserialize, Serialize};

/// Le corps d'acceptation de confiance (`TrustBody`, mesuré — `{ accept }`).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrustRequest {
    pub accept: bool,
}

/// Le corps de réponse à une question (`AnswerBody`, mesuré) — `texte` est
/// **omissible mais décisif** : c'est lui qui répond à l'option de saisie
/// libre d'opencode.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnswerRequest {
    pub numero: u64,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub texte: Field<String>,
}

/// La confiance exigée avant d'agir (`TrustRequiredResponse`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrustRequiredResponse {
    pub folder: String,
    pub kind: String,
    pub message: String,
    pub pane_id: String,
    pub status: TrustRequiredStatus,
}

/// Le littéral `"trust-required"` — union à un membre.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TrustRequiredStatus {
    TrustRequired,
}

/// La confiance tranchée (`TrustResolvedResponse`) — les libellés français
/// du fil exacts, aucune traduction.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrustResolvedResponse {
    pub accepted: bool,
    pub state: TrustState,
    pub status: TrustResolvedStatus,
}

/// L'union fermée des états de confiance (`transmise | acceptee | refusee |
/// non-applicable`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TrustState {
    Transmise,
    Acceptee,
    Refusee,
    NonApplicable,
}

/// Le littéral `"trust-resolved"` — union à un membre.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TrustResolvedStatus {
    TrustResolved,
}

/// Une question tranchée (`QuestionAnsweredResponse`) — libellés du fil
/// exacts (`appliquee | transmise | refusee`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct QuestionAnsweredResponse {
    pub detail: String,
    pub state: AnswerState,
    pub status: AnsweredStatus,
}

/// L'union fermée des états d'une réponse.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AnswerState {
    Appliquee,
    Transmise,
    Refusee,
}

/// Le littéral `"question-answered"` — union à un membre.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AnsweredStatus {
    QuestionAnswered,
}

/// Un choix proposé (`Choix` de api.ts/question.ts) — les noms du fil
/// **restent** : `numero`, `libelle`, `selectionne`, `detail` (TECH §5 :
/// renommer les identifiants Rust ne change pas le fil).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Choice {
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub detail: Field<String>,
    pub libelle: String,
    pub numero: u64,
    pub selectionne: bool,
}

/// Une question posée par un agent (`Question`) — contexte en tableau
/// (peut être vide : un fait, pas une absence).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub choix: Vec<Choice>,
    pub contexte: Vec<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub invite: Field<String>,
    pub texte: String,
}
