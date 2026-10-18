//! Les arguments d'appels d'outils de la famille **OpenAI** (T016) —
//! partagés uniquement là où les fixtures établissent la même forme.

use serde_json::Value;

/// Les arguments d'un appel d'outil, quelle que soit sa forme (mesuré sur
/// codex.ts) :
///
/// - `function_call` donne du JSON **dans une chaîne** `arguments` ;
/// - `custom_tool_call` donne un script **brut** dans `input`.
///
/// ⚠️ **Un JSON d'arguments invalide est conservé brut** — on ne convertit
/// pas le script en objet : ce n'est pas du JSON, et l'inventer serait pire
/// que de l'afficher tel quel (preuve T016).
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Arguments {
    /// Du JSON valide (décodé) — l'entrée était déjà un objet/tableau, ou
    /// la chaîne s'est décodée.
    Objet(Value),
    /// Une chaîne qui n'est PAS du JSON valide — conservée brute.
    Brut(String),
    /// Rien d'utilisable.
    Absents,
}

/// Extrait les arguments d'un payload d'appel.
#[must_use]
pub fn arguments_de(payload: &Value) -> Arguments {
    let objet = match payload.as_object() {
        Some(objet) => objet,
        None => return Arguments::Absents,
    };
    if let Some(arguments) = objet.get("arguments") {
        if let Some(texte) = arguments.as_str() {
            return match serde_json::from_str::<Value>(texte) {
                Ok(objet) => Arguments::Objet(objet),
                Err(_) => Arguments::Brut(texte.to_string()),
            };
        }
        if !arguments.is_null() {
            return Arguments::Objet(arguments.clone());
        }
    }
    match objet.get("input") {
        Some(entree) if entree.is_string() => {
            Arguments::Brut(entree.as_str().unwrap_or_default().to_string())
        }
        _ => Arguments::Absents,
    }
}
