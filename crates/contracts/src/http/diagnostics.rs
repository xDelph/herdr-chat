//! Le journal client (`POST` inline) et le corps d'acquittement.

use crate::presence::Field;
use serde::{Deserialize, Serialize};

/// Le corps de log client (inline mesuré Api.ts) : niveau **fermé sur
/// `"error"`** aujourd'hui — l'union grandira avec le fil, pas avant.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientLogRequest {
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub detail: Field<serde_json::Value>,
    pub level: ClientLogLevel,
    pub message: String,
}

/// L'union des niveaux acceptés du fil — un seul membre mesuré (`"error"`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ClientLogLevel {
    Error,
}

/// L'acquittement du log — le `{ok}` du fil : un booléen réel, pas un
/// succès fabriqué (400 quand le corps est refusé).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientLogResponse {
    pub ok: bool,
}
