//! Le codec **devin** (T022) — le port de `devin.ts` : les `chat_message`
//! de `message_nodes` vers la forme pi.
//!
//! ⚠️ Mesuré : `system` est MAJORITAIRE (129 lignes sur 163) — le contexte
//! injecté, écarté (le piège `developer` de codex, une fois de plus). La
//! réflexion est **en clair** (`thinking.thinking`). `created_at` est DÉJÀ
//! ISO — rien à convertir (à la différence d'opencode).

use crate::families::openai::text::{bloc_texte, modele_utilisable, texte_de};
use domain::session::LignePi;
use serde_json::{Value, json};

/// Arguments littéralement encodés en JSON, ou la chaîne telle quelle —
/// **perdre l'argument serait pire qu'afficher un argument non décodé**.
fn arguments_de(brut: &Value) -> Value {
    match brut.as_str() {
        Some(texte) => serde_json::from_str(texte).unwrap_or(Value::from(texte)),
        None => brut.clone(),
    }
}

/// Un appel d'outil devin → bloc `toolCall`.
///
/// ⚠️ **Cette forme n'a PAS été mesurée** — les huit messages `assistant` de
/// la base portent tous un `tool_calls` VIDE. Elle décrit la forme
/// OpenAI-compatible (faisceau d'indices, pas une preuve) ; ⚠️ **le
/// garde-fou, lui, est strict** : un appel n'est retenu que s'il porte un
/// `function.name` — si la forme réelle diffère, la traduction ne produit
/// RIEN (le fil perd les lignes d'outils, n'affiche jamais d'inventé).
fn blocs_d_appels(appels: &Value) -> Vec<Value> {
    let tableau = match appels.as_array() {
        Some(tableau) => tableau,
        None => return Vec::new(),
    };
    tableau
        .iter()
        .filter_map(|appel| {
            let objet = appel.as_object()?;
            let fonction = appel
                .get("function")
                .and_then(Value::as_object)
                .unwrap_or(objet);
            let nom = texte_de(fonction.get("name").unwrap_or(&Value::Null))?;
            let arguments = arguments_de(
                fonction
                    .get("arguments")
                    .filter(|v| !v.is_null())
                    .unwrap_or(fonction.get("input").unwrap_or(&Value::Null)),
            );
            Some(json!({
                "arguments": arguments,
                "id": texte_de(appel.get("id").unwrap_or(&Value::Null))
                    .unwrap_or_else(|| format!("devin:{nom}")),
                "name": nom,
                "type": "toolCall",
            }))
        })
        .collect()
}

/// `metadata.created_at`, déjà ISO — ou rien.
fn horodatage_de(message: &Value) -> Option<String> {
    texte_de(message.get("metadata")?.get("created_at")?)
}

/// Traduit un `chat_message` devin en ligne de forme pi — `None` quand ce
/// n'est pas de la conversation (l'appelant garde la brute).
#[must_use]
pub fn ligne_devin_vers_pi(chat_message: &Value, id: &str) -> Option<LignePi> {
    let objet = chat_message.as_object()?;
    let role = texte_de(objet.get("role").unwrap_or(&Value::Null))?;
    // ⚠️ Le contexte injecté, et il est majoritaire (129/163) : écarté.
    if role == "system" {
        return None;
    }
    let horodatage = horodatage_de(chat_message);
    // Le modèle, sur le message lui-même (mesuré :
    // `metadata.generation_model` = `swe-1-6-slow`).
    let modele = modele_utilisable(
        objet
            .get("metadata")
            .and_then(|m| m.get("generation_model"))
            .unwrap_or(&Value::Null),
    );

    let enveloppe = |message: Value| -> Option<LignePi> {
        let mut complet = json!({
            "type": "message",
            "id": format!("devin:{id}"),
            "message": message,
        });
        if let Some(horodatage) = &horodatage {
            complet["timestamp"] = json!(horodatage);
        }
        if let Some(modele) = &modele {
            complet["message"]["model"] = json!(modele);
        }
        serde_json::from_value(complet).ok()
    };

    if role == "user" {
        let contenu = objet.get("content").and_then(Value::as_str).unwrap_or("");
        if contenu.trim().is_empty() {
            return None;
        }
        return enveloppe(json!({ "content": [bloc_texte(contenu)], "role": "user" }));
    }
    if role != "assistant" {
        return None;
    }
    let mut blocs: Vec<Value> = Vec::new();
    // La réflexion est EN CLAIR ; `redacted` reste faux (comme opencode).
    let pensee = objet
        .get("thinking")
        .and_then(|reflexion| reflexion.get("thinking"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if !pensee.is_empty() {
        blocs.push(json!({ "redacted": false, "thinking": pensee, "type": "thinking" }));
    }
    let prose = objet.get("content").and_then(Value::as_str).unwrap_or("");
    if !prose.trim().is_empty() {
        blocs.push(bloc_texte(prose));
    }
    blocs.extend(blocs_d_appels(
        objet.get("tool_calls").unwrap_or(&Value::Null),
    ));
    // Un message sans bloc n'est pas un message : pas de bulle vide.
    if blocs.is_empty() {
        return None;
    }
    enveloppe(json!({ "content": blocs, "role": "assistant" }))
}
