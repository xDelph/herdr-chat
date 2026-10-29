//! Le codec **Responses** (T016) — le port fidèle de `codex.ts` : les
//! `response_item` et `event_msg` d'une session codex vers la forme pi, et
//! les événements de réglage vers des changements.
//!
//! ⚠️ **Mesures portées par ce code** (toutes documentées dans la source) :
//! les prompts vivent dans `event_msg.item_completed` ; le rôle `developer`
//! est le prompt système (écarté) ; `AGENTS.md` arrive en rôle `user` et se
//! reconnaît à ses **deux** marques ensemble (l'en-tête + `<INSTRUCTIONS>`) ;
//! la réflexion de codex est **chiffrée** (on la dit masquée, on ne l'invente
//! pas) ; les arguments invalides restent bruts.

use super::arguments::arguments_de;
use super::text::{bloc_texte, modele_utilisable, texte_de, texte_de_sortie};
use domain::session::{ChangePi, LignePi};
use serde_json::{Value, json};

/// Les rôles qui font partie de la conversation — le reste est de la
/// configuration (`developer` = le prompt système, écarté comme pi écarte
/// ses tours système).
const ROLES_CONVERSATION: [&str; 2] = ["user", "assistant"];

/// Les types de bloc porteurs de texte, du côté codex.
const TYPES_TEXTE: [&str; 2] = ["input_text", "output_text"];

/// Les marques du contexte que codex **ajoute lui-même** — les deux marques
/// d'`AGENTS.md` sont exigées **ensemble** (l'en-tête ET `<INSTRUCTIONS>`) :
/// un utilisateur qui *parle* de son AGENTS.md n'est pas effacé.
const MARQUE_AGENTS_MD: &str = "# AGENTS.md instructions for ";
const MARQUE_ENV: &str = "<environment_context>";

fn est_bloc_de_contexte(texte: &str) -> bool {
    let debut = texte.trim_start();
    if debut.starts_with(MARQUE_ENV) {
        return true;
    }
    debut.starts_with(MARQUE_AGENTS_MD) && debut.contains("<INSTRUCTIONS>")
}

/// L'enveloppe commune : id `codex:{ordinal|horodatage}:…`, horodatage si
/// présent.
fn enveloppe(
    horodatage: Option<&str>,
    ordinal: Option<u64>,
    id: Option<&str>,
    message: Value,
) -> LignePi {
    let timestamp_id = match ordinal {
        Some(ordinal) => ordinal.to_string(),
        None => horodatage.unwrap_or("entry").to_string(),
    };
    let mut complet = json!({
        "type": "message",
        "id": format!("codex:{timestamp_id}:{}", id.unwrap_or("item")),
        "message": message,
    });
    if let Some(horodatage) = horodatage {
        complet["timestamp"] = json!(horodatage);
    }
    serde_json::from_value(complet)
        .unwrap_or_else(|cause| panic!("rebuilt codex line invalid: {cause}"))
}

/// Le texte d'un contenu d'événement utilisateur : chaîne ou blocs.
fn texte_de_contenu_evenement(contenu: &Value) -> String {
    if let Some(texte) = contenu.as_str() {
        return texte.to_string();
    }
    match contenu.as_array() {
        Some(blocs) => blocs
            .iter()
            .filter_map(|bloc| bloc.get("text"))
            .filter_map(Value::as_str)
            .collect::<Vec<&str>>()
            .join(""),
        None => String::new(),
    }
}

/// Traduit une ligne codex en ligne de forme pi — `None` quand ce n'est pas
/// un message de conversation (l'appelant garde la ligne brute, comme pour
/// tout type inconnu).
#[must_use]
pub fn ligne_vers_pi(parsed: &Value) -> Option<LignePi> {
    let objet = parsed.as_object()?;
    let horodatage = texte_de(objet.get("timestamp").unwrap_or(&Value::Null));
    let ordinal = objet.get("ordinal").and_then(Value::as_u64);

    // Les événements utilisateur : prompts, commandes, diffs — tout le
    // travail qui n'arrive pas en response_item.
    if objet.get("type").and_then(Value::as_str) == Some("event_msg") {
        let payload = objet.get("payload")?.as_object()?;
        if payload.get("type").and_then(Value::as_str) != Some("item_completed") {
            return None;
        }
        let item = payload.get("item")?.as_object()?;
        let id = texte_de(item.get("id").unwrap_or(&Value::Null));
        let genre = item.get("type").and_then(Value::as_str).unwrap_or("");
        match genre {
            "UserMessage" => {
                let texte = texte_de_contenu_evenement(item.get("content").unwrap_or(&Value::Null));
                if texte.trim().is_empty() {
                    return None;
                }
                return Some(enveloppe(
                    horodatage.as_deref(),
                    ordinal,
                    id.as_deref(),
                    json!({ "content": [bloc_texte(&texte)], "role": "user" }),
                ));
            }
            "AgentMessage" => {
                let texte = texte_de_contenu_evenement(item.get("content").unwrap_or(&Value::Null));
                if texte.trim().is_empty() {
                    return None;
                }
                let phase = texte_de(item.get("phase").unwrap_or(&Value::Null));
                return Some(enveloppe(horodatage.as_deref(), ordinal, id.as_deref(), {
                    let mut corps = json!({ "content": [bloc_texte(&texte)], "role": "assistant" });
                    if let Some(phase) = phase {
                        corps["phase"] = json!(phase);
                    }
                    corps
                }));
            }
            "CommandExecution" => {
                // La DERNIÈRE commande de la liste (mesuré : findLast).
                let commande = item
                    .get("command")
                    .and_then(Value::as_array)
                    .and_then(|parts| parts.iter().filter_map(Value::as_str).next_back());
                let commande = commande?;
                let statut = item.get("status").and_then(Value::as_str);
                return Some(enveloppe(
                    horodatage.as_deref(),
                    ordinal,
                    id.as_deref(),
                    json!({
                        "cancelled": statut == Some("cancelled"),
                        "command": commande,
                        "content": [],
                        "exitCode": item.get("exit_code").and_then(Value::as_i64).map(Value::from).unwrap_or(Value::Null),
                        "output": item.get("aggregated_output").and_then(Value::as_str).unwrap_or(""),
                        "role": "bashExecution",
                        "truncated": false,
                    }),
                ));
            }
            "FileChange" => {
                let changements = item.get("changes")?.as_object()?;
                let mut contenus = Vec::new();
                for (chemin, changement) in changements.iter() {
                    let Some(changement) = changement.as_object() else {
                        continue;
                    };
                    let diff = changement
                        .get("unified_diff")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let mut edits: Vec<Value> = Vec::new();
                    let mut anciennes: Vec<&str> = Vec::new();
                    let mut nouvelles: Vec<&str> = Vec::new();
                    let ferme = |anciennes: &mut Vec<&str>,
                                 nouvelles: &mut Vec<&str>,
                                 edits: &mut Vec<Value>| {
                        if !anciennes.is_empty() || !nouvelles.is_empty() {
                            edits.push(json!({
                                "newText": nouvelles.join("\n"),
                                "oldText": anciennes.join("\n"),
                            }));
                            anciennes.clear();
                            nouvelles.clear();
                        }
                    };
                    for ligne in diff.lines() {
                        if ligne.starts_with("@@") {
                            ferme(&mut anciennes, &mut nouvelles, &mut edits);
                        } else if ligne.starts_with('+') && !ligne.starts_with("+++") {
                            nouvelles.push(&ligne[1..]);
                        } else if ligne.starts_with('-') && !ligne.starts_with("---") {
                            anciennes.push(&ligne[1..]);
                        } else if !ligne.starts_with('\\') {
                            ferme(&mut anciennes, &mut nouvelles, &mut edits);
                        }
                    }
                    ferme(&mut anciennes, &mut nouvelles, &mut edits);
                    let mut arguments = json!({ "edits": edits, "path": chemin });
                    if let Some(vers) = changement.get("move_path").and_then(Value::as_str) {
                        arguments["movePath"] = json!(vers);
                    }
                    if let Some(genre) = changement.get("type") {
                        arguments["changeType"] = genre.clone();
                    }
                    contenus.push(json!({
                        "arguments": arguments,
                        "id": format!("{}:{chemin}", id.as_deref().unwrap_or("file")),
                        "name": "edit",
                        "type": "toolCall",
                    }));
                }
                if contenus.is_empty() {
                    return None;
                }
                return Some(enveloppe(
                    horodatage.as_deref(),
                    ordinal,
                    id.as_deref(),
                    json!({ "content": contenus, "role": "assistant" }),
                ));
            }
            _ => return None,
        }
    }

    if objet.get("type").and_then(Value::as_str) != Some("response_item") {
        return None;
    }
    let payload = objet.get("payload")?.as_object()?;
    let genre = payload.get("type").and_then(Value::as_str).unwrap_or("");
    match genre {
        // Les appels d'outils et la réflexion passent par le même adaptateur.
        "function_call" | "custom_tool_call" => {
            let arguments = arguments_de(&Value::Object(payload.clone()));
            let arguments_valeur = match arguments {
                super::arguments::Arguments::Objet(valeur) => valeur,
                super::arguments::Arguments::Brut(texte) => Value::from(texte),
                super::arguments::Arguments::Absents => Value::Null,
            };
            return Some(enveloppe(
                horodatage.as_deref(),
                ordinal,
                None,
                json!({
                    "content": [{
                        "arguments": arguments_valeur,
                        "id": payload.get("call_id").cloned().unwrap_or(Value::Null),
                        "name": texte_de(payload.get("name").unwrap_or(&Value::Null)).unwrap_or_else(|| String::from("outil")),
                        "type": "toolCall",
                    }],
                    "role": "assistant",
                }),
            ));
        }
        "function_call_output" | "custom_tool_call_output" => {
            return Some(enveloppe(
                horodatage.as_deref(),
                ordinal,
                None,
                json!({
                    "content": [bloc_texte(&texte_de_sortie(payload.get("output").unwrap_or(&Value::Null)))],
                    "role": "toolResult",
                    "toolName": "outil",
                }),
            ));
        }
        // Codex CHIFFRE sa réflexion : on la dit masquée, on ne l'invente pas.
        "reasoning" => {
            return Some(enveloppe(
                horodatage.as_deref(),
                ordinal,
                None,
                json!({ "content": [{ "redacted": true, "type": "thinking" }], "role": "assistant" }),
            ));
        }
        "message" => (),
        _ => return None,
    }

    let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
    if !ROLES_CONVERSATION.contains(&role) {
        return None;
    }
    let contenu = payload.get("content").and_then(Value::as_array)?;
    let blocs: Vec<Value> = contenu
        .iter()
        .filter_map(|bloc| {
            let genre = bloc.get("type").and_then(Value::as_str)?;
            if !TYPES_TEXTE.contains(&genre) {
                return None;
            }
            let texte = bloc.get("text").and_then(Value::as_str).unwrap_or("");
            if texte.is_empty() {
                return None;
            }
            Some(bloc_texte(texte))
        })
        .collect();
    if blocs.is_empty() {
        return None;
    }
    // Le contexte projet injecté en rôle user n'est pas de l'utilisateur —
    // et `every` sur TOUS les blocs : un vrai message qui commence par une
    // marque garde ses autres blocs normaux.
    if role == "user"
        && blocs.iter().all(|bloc| {
            est_bloc_de_contexte(bloc.get("text").and_then(Value::as_str).unwrap_or(""))
        })
    {
        return None;
    }
    Some(enveloppe(
        horodatage.as_deref(),
        ordinal,
        None,
        json!({ "content": blocs, "role": role }),
    ))
}

/// Traduit un **événement de réglage** codex en changement pi — une fonction
/// à part : l'une produit un **message**, l'autre un **changement** (les
/// vingt lectures de LignePi n'ont pas à payer la variante).
#[must_use]
pub fn reglage_vers_pi(parsed: &Value) -> Option<ChangePi> {
    let objet = parsed.as_object()?;
    let payload = objet.get("payload")?.as_object()?;
    let genre = objet.get("type").and_then(Value::as_str)?;
    if genre == "turn_context" {
        // Ce payload porte le modèle **utilisé** — mais pas le fournisseur :
        // on ne le devine pas (mesuré).
        let modele = modele_utilisable(payload.get("model").unwrap_or(&Value::Null))?;
        let effort = texte_de(payload.get("effort").unwrap_or(&Value::Null));
        let mut changement = json!({ "type": "model_change", "modelId": modele });
        if let Some(effort) = effort {
            changement["thinkingLevel"] = json!(effort);
        }
        return serde_json::from_value(changement).ok();
    }
    if genre == "event_msg"
        && payload.get("type").and_then(Value::as_str) == Some("thread_settings_applied")
    {
        let reglages = payload.get("thread_settings")?.as_object()?;
        let modele = modele_utilisable(reglages.get("model").unwrap_or(&Value::Null))?;
        let fournisseur = texte_de(reglages.get("model_provider_id").unwrap_or(&Value::Null));
        let effort = texte_de(reglages.get("reasoning_effort").unwrap_or(&Value::Null));
        let mut changement = json!({ "type": "model_change", "modelId": modele });
        if let Some(fournisseur) = fournisseur {
            changement["provider"] = json!(fournisseur);
        }
        if let Some(effort) = effort {
            changement["thinkingLevel"] = json!(effort);
        }
        return serde_json::from_value(changement).ok();
    }
    None
}
