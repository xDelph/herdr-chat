//! Les lectures partagées (H22) — « j'ai lu cette conversation jusqu'ici »,
//! tenu par le démon pour TOUS les appareils.
//!
//! ⚠️ **Retour du 2026-10-29.** Le « lu » vivait dans le navigateur : une
//! conversation lue sur le téléphone gardait son point « non lu » sur
//! l'ordinateur. Ce n'est pas du contenu : un instant par pane, rien d'autre.
//! Lire ne touche jamais à Herdr (le focus du Mac reste un geste explicite).

use serde::{Deserialize, Serialize};

/// La lecture notée (`MarkReadRequest`) — l'instant (ms UTC) jusqu'où la
/// conversation a été vue.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkReadRequest {
    pub at: u64,
}

/// La lecture retenue (`MarkReadResponse`) — `readAt` ne recule jamais : une
/// lecture plus ancienne que celle connue rend la connue.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkReadResponse {
    pub pane_id: String,
    pub read_at: u64,
}
