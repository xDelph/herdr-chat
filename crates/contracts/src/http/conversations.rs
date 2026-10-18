//! Les conversations : résumés riches et leur réponse.

use crate::http::interactive::{Question, TrustRequiredResponse};
use crate::presence::Field;
use domain::status::{AgentStatus, SessionState};
use serde::{Deserialize, Serialize};

/// Le résumé d'une conversation (`ConversationSummary`) — tout ce que la
/// liste doit afficher, rien de plus ; chaque champ omissible l'est **mesuré**
/// (absent tant que la source n'en dit rien).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub agent: crate::presence::Nullable<String>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub branch: Field<String>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_prompt: Field<String>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub model: Field<String>,
    pub name: crate::presence::Nullable<String>,
    pub pane_rank: crate::presence::Nullable<u64>,
    pub tab_pane_count: u64,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub provider: Field<String>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub preview: Field<String>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub question: Field<Question>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub waiting: Field<String>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub trust: Field<TrustRequiredResponse>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub thinking: Field<String>,
    pub session_state: SessionState,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub timestamp: Field<u64>,
    pub title: String,
    pub status: AgentStatus,
    pub workspace_id: String,
    pub tab_id: String,
    pub pane_id: String,
}

/// La réponse conversations (`ConversationsResponse`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationsResponse {
    pub conversations: Vec<ConversationSummary>,
}
