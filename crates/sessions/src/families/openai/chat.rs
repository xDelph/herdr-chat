//! Le codec **Chat** (T016) — la forme conversation `{role, content}` :
//! **séparé** du codec Responses. Une enveloppe `response_item`/`event_msg`
//! ne se décode PAS ici, jamais : les deux formes ne partagent rien (preuve
//! T016).

use super::text::bloc_texte;
use domain::session::LignePi;
use serde_json::{Value, json};

/// Traduit une ligne de forme Chat en ligne pi — `None` sinon.
#[must_use]
pub fn ligne_vers_pi(parsed: &Value) -> Option<LignePi> {
    let objet = parsed.as_object()?;
    // Le refus explicite des enveloppes Responses : un `type` qui annonce
    // l'autre famille n'est pas une ligne Chat.
    match objet.get("type").and_then(Value::as_str) {
        Some("response_item") | Some("event_msg") | Some("turn_context") => return None,
        _ => (),
    }
    let role = objet.get("role").and_then(Value::as_str)?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let contenu = objet.get("content")?;
    // Chaîne nue ou blocs textuels — la même lecture bornée que les autres
    // familles, jamais une bulle vide.
    let blocs = match contenu {
        Value::String(texte) => {
            if texte.trim().is_empty() {
                return None;
            }
            vec![bloc_texte(texte)]
        }
        Value::Array(blocs) => blocs
            .iter()
            .filter_map(|bloc| {
                let texte = bloc.get("text").and_then(Value::as_str)?;
                if texte.trim().is_empty() {
                    return None;
                }
                Some(bloc_texte(texte))
            })
            .collect::<Vec<Value>>(),
        _ => return None,
    };
    if blocs.is_empty() {
        return None;
    }
    Some(
        serde_json::from_value(json!({
            "type": "message",
            "message": { "content": blocs, "role": role },
        }))
        .unwrap_or_else(|cause| panic!("rebuilt chat line invalid: {cause}")),
    )
}
