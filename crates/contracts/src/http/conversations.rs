//! Les conversations : résumés riches et leur réponse.

use crate::http::interactive::{Question, TrustRequiredResponse};
use crate::presence::Field;
use domain::status::{AgentStatus, SessionState};
use serde::{Deserialize, Serialize};

/// Le résumé d'une conversation (`ConversationSummary`) — tout ce que la
/// liste doit afficher, rien de plus ; chaque champ omissible l'est **mesuré**
/// (absent tant que la source n'en dit rien).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub agent: crate::presence::Nullable<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub branch: Field<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub last_prompt: Field<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub model: Field<String>,
    pub name: crate::presence::Nullable<String>,
    pub pane_rank: crate::presence::Nullable<u64>,
    pub tab_pane_count: u64,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub provider: Field<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub preview: Field<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub question: Field<Question>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub waiting: Field<String>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub trust: Field<TrustRequiredResponse>,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub thinking: Field<String>,
    pub session_state: SessionState,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub timestamp: Field<u64>,
    pub title: String,
    pub status: AgentStatus,
    pub workspace_id: String,
    pub tab_id: String,
    pub pane_id: String,
}

/// La réponse conversations (`ConversationsResponse`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConversationsResponse {
    pub conversations: Vec<ConversationSummary>,
}
