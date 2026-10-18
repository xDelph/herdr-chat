//! `GET /api/agents/:pane/session` — la page de session paginée.

use crate::http::errors::ReadCause;
use crate::presence::{Field, Nullable};
use serde::{Deserialize, Serialize};

/// Une entrée de session **rendue au client** : la ligne brute entière, plus
/// les trois champs de position (mesuré sur `SessionEntrySchema`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
    /// Le type de la ligne, tel que la source l'a écrit — chaîne libre du
    /// fil : les lecteurs tranchent, le contrat transporte.
    #[serde(rename = "type")]
    pub genre: String,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub id: Field<String>,
    /// Le parent, omissible ET nullable (`Schema.optional(Schema.NullOr)`) :
    /// absent ≠ null — deux faits distincts.
    #[serde(
        default,
        deserialize_with = "crate::presence::optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_id: Field<Nullable<String>>,
    /// La ligne JSONL **entière**, telle qu'écrite — aucun raw perdu.
    pub raw: String,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub timestamp: Field<String>,
}

/// La réponse de session : quatre clauses nommées du fil (l'union
/// [`ReadCause`]), la page, et les curseurs **opaques** (le codec interne
/// appartient à `sessions`, TECH §5).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub cause: ReadCause,
    pub entries: Vec<SessionEntry>,
    pub incremental: bool,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub cursor: Field<String>,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub previous_cursor: Field<String>,
    pub has_more: bool,
    pub reset: bool,
    pub session_path: String,
}
