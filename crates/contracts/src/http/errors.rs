//! La forme d'erreur partagée — le seul `error: string` du fil.

use crate::presence::Field;
use serde::{Deserialize, Serialize};

/// L'union fermée des causes de lecture — **une seule définition**, celle du
/// domaine (`domain::errors::ReadCause`, libellés du fil exacts
/// `absente | vide | invalide | io`), réexportée ici (C01).
pub use domain::errors::ReadCause;

/// `ApiErrorResponse` (api.ts) : le message réel, un indicateur optionnel,
/// et la cause de lecture quand il y en a une — nommée, jamais reformée.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorResponse {
    /// `absente | vide | invalide | io` — la cause de lecture, présente
    /// seulement quand l'erreur en porte une.
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub cause: Field<ReadCause>,
    pub error: String,
    #[serde(
        default,
        deserialize_with = "crate::presence::refuse_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub hint: Field<String>,
}
