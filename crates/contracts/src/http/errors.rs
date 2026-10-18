//! La forme d'erreur partagée — le seul `error: string` du fil.

use crate::presence::Field;
use serde::{Deserialize, Serialize};

/// L'union fermée des causes de lecture — **une seule définition**, celle du
/// domaine (`domain::errors::ReadCause`, libellés du fil exacts
/// `absente | vide | invalide | io`), réexportée ici (C01).
pub use domain::errors::ReadCause;

/// `ApiErrorResponse` (api.ts) : le message réel, un indicateur optionnel,
/// et la cause de lecture quand il y en a une — nommée, jamais reformée.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorResponse {
    /// `absente | vide | invalide | io` — la cause de lecture, présente
    /// seulement quand l'erreur en porte une.
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub cause: Field<ReadCause>,
    pub error: String,
    #[serde(default, skip_serializing_if = "crate::presence::Field::est_absente")]
    pub hint: Field<String>,
}
