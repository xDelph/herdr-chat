//! Le codec **pi** (T016) — l'identité vérifiée : la forme cible est la
//! forme de pi, une ligne pi se lit donc par validation de forme, jamais
//! par traduction.

use domain::session::LignePi;
use serde_json::Value;

/// Lit une ligne **déjà de forme pi** : `type` (chaîne) + `message` (objet)
/// requis — `None` sinon (l'appelant garde la ligne brute).
#[must_use]
pub fn ligne_vers_pi(parsed: &Value) -> Option<LignePi> {
    let objet = parsed.as_object()?;
    if objet
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
    {
        return None;
    }
    if !objet.get("message").is_some_and(Value::is_object) {
        return None;
    }
    serde_json::from_value(parsed.clone()).ok()
}
