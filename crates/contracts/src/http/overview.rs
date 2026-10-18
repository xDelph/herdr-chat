//! `GET /api/overview` et la famille snapshot passée au client.

use crate::presence::Nullable;
use domain::status::AgentStatus;
use serde::{Deserialize, Serialize};

/// Une ligne d'agent de l'overview (homologue exact de `AgentViewSchema`) :
/// **tous les champs sont présents** — les vagues d'information passent par
/// `Nullable` (null mesuré), jamais par une absence.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    pub agent: Nullable<String>,
    pub cwd: Nullable<String>,
    pub focused: bool,
    pub pane_id: String,
    pub parent_session: Nullable<String>,
    pub session_cwd: Nullable<String>,
    /// Trois états sur le fil : `true | false | null` — null = non
    /// vérifiable (D03), jamais confondu avec faux.
    pub session_cwd_matches: Nullable<bool>,
    pub session_id: Nullable<String>,
    pub session_kind: Nullable<crate::SessionRefKind>,
    pub session_path: Nullable<String>,
    pub status: AgentStatus,
    pub tab_label: Nullable<String>,
    pub tab_id: String,
    pub tab_number: Nullable<u64>,
    pub name: Nullable<String>,
    pub pane_rank: Nullable<u64>,
    pub tab_pane_count: u64,
    pub title: Nullable<String>,
    pub workspace_label: Nullable<String>,
    pub workspace_id: String,
}

/// Une ligne de workspace de l'overview (homologue de `WorkspaceViewSchema`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    pub agent_panes: Vec<String>,
    pub agent_status: Nullable<AgentStatus>,
    /// Le chemin réel où lancer un agent — absent plutôt qu'inventé (D02).
    pub checkout_path: Nullable<String>,
    pub focused: bool,
    pub label: Nullable<String>,
    pub pane_count: u64,
    pub tab_count: u64,
    pub workspace_id: String,
}

/// La réponse d'overview complète.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewResponse {
    pub agents: Vec<AgentView>,
    pub herdr_protocol: u64,
    pub herdr_version: String,
    pub without_session: u64,
    pub workspaces: Vec<WorkspaceView>,
}
