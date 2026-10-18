//! `GET /api/health` — l'état du daemon, tel qu'annoncé.

use crate::presence::Field;
use serde::{Deserialize, Serialize};

/// La santé du service (mesurée sur `HealthResponse` de api.ts).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub herdr: HerdrHealth,
    /// Absent ou valeur — un null explicite est un refus (`Schema.optional`).
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub log: Field<String>,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub uptime_ms: Field<u64>,
}

/// La partie Herdr de la santé — protocol/version **omissibles** (mesuré :
/// absents tant qu'aucun ping n'a réussi), socket et reachable toujours là.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HerdrHealth {
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub protocol: Field<u64>,
    pub reachable: bool,
    pub socket: String,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub version: Field<String>,
}
