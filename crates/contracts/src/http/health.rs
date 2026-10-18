//! `GET /api/health` — l'état du daemon, tel qu'annoncé.

use crate::presence::Field;
use serde::{Deserialize, Serialize};

/// La santé du service (mesurée sur `HealthResponse` de api.ts).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub herdr: HerdrHealth,
    /// Absent ou valeur — un null explicite est un refus (`Schema.optional`).
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub log: Field<String>,
    pub ok: bool,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub uptime_ms: Field<u64>,
}

/// La partie Herdr de la santé — protocol/version **omissibles** (mesuré :
/// absents tant qu'aucun ping n'a réussi), socket et reachable toujours là.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HerdrHealth {
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub protocol: Field<u64>,
    pub reachable: bool,
    pub socket: String,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub version: Field<String>,
}
