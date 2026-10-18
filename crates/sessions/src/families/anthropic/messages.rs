//! Le codec Anthropic (T016) — le port fidèle de `claude.ts` : seuls `user`
//! et `assistant` portent la conversation, et on trie **sur le type de
//! ligne, jamais sur le rôle** (le piège `api-request-blob`).

use super::super::openai::text::{bloc_texte, modele_utilisable, texte_de};
use domain::session::LignePi;
use serde_json::{Value, json};

/// Ce que Claude Code écrit **en rôle `user`** sans que l'utilisateur ait
/// rien demandé — relevé du 2026-10-16 sur 132 sessions : 320 lignes `user`
/// portant du texte, dont **15 %** n'étaient pas des demandes.
const MARQUES_APPLICATION: [&str; 6] = [
    "<system-reminder>",
    "<local-command-caveat>",
    "<local-command-stdout>",
    "<task-notification>",
    "[Request interrupted",
    "This session is being continued",
];

fn est_sans_demande(texte: &str) -> bool {
    let debut = texte.trim_start();
    MARQUES_APPLICATION
        .iter()
        .any(|marque| debut.starts_with(marque))
}

/// Une commande à barre oblique : Claude Code remplace ce que l'utilisateur
/// a tapé par un bloc XML — on ne refuse PAS cette ligne : on rend la
/// commande et ses arguments.
fn commande_de(texte: &str) -> Option<String> {
    let nom = entre_balises(texte, "<command-name>", "</command-name>")?;
    let nom = nom.trim();
    if nom.is_empty() {
        return None;
    }
    let arguments = entre_balises(texte, "<command-args>", "</command-args>")
        .map(|arguments| arguments.trim().to_string())
        .unwrap_or_default();
    Some(if arguments.is_empty() {
        nom.to_string()
    } else {
        format!("{nom} {arguments}")
    })
}

fn entre_balises(texte: &str, ouvrante: &str, fermante: &str) -> Option<String> {
    let debut = texte.find(ouvrante)? + ouvrante.len();
    let fin = texte[debut..].find(fermante)? + debut;
    Some(texte[debut..fin].to_string())
}

/// Le texte d'une ligne `user`, s'il porte une demande — le point unique du
/// filtre : chaîne nue comme blocs passent par ici.
fn texte_de_demande(texte: &str) -> Option<String> {
    let debut = texte.trim_start();
    if est_sans_demande(debut) {
        return None;
    }
    match commande_de(debut) {
        Some(commande) => Some(commande),
        None => Some(texte.to_string()),
    }
}

/// Le texte d'un `tool_result` : une chaîne, ou une liste de blocs.
fn texte_de_resultat(contenu: &Value) -> String {
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

/// Une ligne qui **prétend** porter la conversation (type `user`/`assistant`)
/// — et que l'adaptateur peut refuser : l'appelant DOIT alors employer
/// [`sans_message`], sinon une ligne refusée reste lisible et réinjecte ce
/// qu'on vient d'écarter (le piège propre à claude, dont la forme ressemble
/// trop à celle de pi).
#[must_use]
pub fn est_ligne_de_conversation(parsed: &Value) -> bool {
    matches!(
        parsed.get("type").and_then(Value::as_str),
        Some("user") | Some("assistant")
    )
}

/// La ligne, privée de son message — tout le reste (horodatage, identité,
/// type) est conservé ; plus rien ne peut la relire comme un message.
#[must_use]
pub fn sans_message(parsed: &Value) -> Value {
    match parsed.as_object() {
        Some(objet) => {
            let mut copie = objet.clone();
            copie.remove("message");
            Value::Object(copie)
        }
        None => parsed.clone(),
    }
}

/// Traduit une ligne de session Claude Code en ligne de forme pi — `None`
/// quand ce n'est pas de la conversation (l'appelant garde la ligne brute,
/// avec [`sans_message`]).
#[must_use]
pub fn ligne_vers_pi(parsed: &Value) -> Option<LignePi> {
    let objet = parsed.as_object()?;
    let genre = objet.get("type").and_then(Value::as_str)?;
    // ⚠️ **Sur le TYPE, jamais sur le rôle** : `api-request-blob` porte un
    // `message.role === "user"` qui est le prompt système.
    if genre != "user" && genre != "assistant" {
        return None;
    }
    let message = objet.get("message")?.as_object()?;
    let contenu = message.get("content")?;

    // Le modèle vit sur le message lui-même (mesuré : chaque réponse
    // assistant le porte) ; fournisseur et niveau n'EXISTENT PAS ici — on
    // ne les invente pas.
    let modele = modele_utilisable(message.get("model").unwrap_or(&Value::Null));
    let horodatage = texte_de(objet.get("timestamp").unwrap_or(&Value::Null));
    let uuid = texte_de(objet.get("uuid").unwrap_or(&Value::Null));

    let enveloppe = |corps: Value| -> Option<LignePi> {
        let mut complet = json!({
            "type": "message",
            "message": match &modele {
                Some(modele) => {
                    let mut corps = corps.clone();
                    corps["model"] = json!(modele);
                    corps
                }
                None => corps.clone(),
            },
        });
        if let Some(horodatage) = &horodatage {
            complet["timestamp"] = json!(horodatage);
        }
        if let Some(uuid) = &uuid {
            complet["id"] = json!(format!("claude:{uuid}"));
        }
        serde_json::from_value(complet).ok()
    };

    // Une chaîne nue : le cas le plus courant d'une demande.
    if let Some(texte) = contenu.as_str() {
        let demande = texte_de_demande(texte)?;
        if demande.trim().is_empty() {
            return None;
        }
        return enveloppe(json!({ "content": [bloc_texte(&demande)], "role": "user" }));
    }

    let blocs = contenu.as_array()?;
    let resultats: Vec<&Value> = blocs
        .iter()
        .filter(|bloc| bloc.get("type").and_then(Value::as_str) == Some("tool_result"))
        .collect();
    if !resultats.is_empty() {
        // ⚠️ Un résultat d'outil est une ligne À PART : il arrive en rôle
        // user (la forme de l'API) mais c'est la réponse à l'appel précédent.
        let texte = resultats
            .iter()
            .map(|bloc| texte_de_resultat(bloc.get("content").unwrap_or(&Value::Null)))
            .collect::<String>();
        let en_echec = resultats
            .iter()
            .any(|bloc| bloc.get("is_error").and_then(Value::as_bool) == Some(true));
        let mut corps = json!({
            "content": [bloc_texte(&texte)],
            "role": "toolResult",
            "toolName": "outil",
        });
        if en_echec {
            corps["isError"] = json!(true);
        }
        return enveloppe(corps);
    }

    let textes: Vec<String> = blocs
        .iter()
        .filter(|bloc| bloc.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|bloc| bloc.get("text").and_then(Value::as_str))
        .map(str::to_string)
        .collect();
    let appels: Vec<Value> = blocs
        .iter()
        .filter(|bloc| bloc.get("type").and_then(Value::as_str) == Some("tool_use"))
        .map(|bloc| {
            json!({
                // L'entrée est DÉJÀ un objet dans cette forme (input) : rien
                // à décoder (à la différence de la chaîne JSON de devin).
                "arguments": bloc.get("input").cloned().unwrap_or(json!({})),
                "id": texte_de(bloc.get("id").unwrap_or(&Value::Null)).unwrap_or_else(|| String::from("appel")),
                "name": texte_de(bloc.get("name").unwrap_or(&Value::Null)).unwrap_or_else(|| String::from("outil")),
                "type": "toolCall",
            })
        })
        .collect();

    if genre == "user" {
        // Tous les blocs étaient des marques de l'application : pas une
        // demande.
        let demandes: Vec<Value> = textes
            .iter()
            .filter_map(|texte| texte_de_demande(texte))
            .filter(|texte| !texte.trim().is_empty())
            .map(|texte| bloc_texte(&texte))
            .collect();
        if demandes.is_empty() {
            return None;
        }
        return enveloppe(json!({ "content": demandes, "role": "user" }));
    }

    let textes_utiles: Vec<Value> = textes
        .iter()
        .filter(|texte| !texte.is_empty() && !est_sans_demande(texte))
        .map(|texte| bloc_texte(texte))
        .collect();
    let mut sortie = textes_utiles;
    sortie.extend(appels);
    // Un message sans bloc n'est pas un message : pas de bulle vide.
    if sortie.is_empty() {
        return None;
    }
    enveloppe(json!({ "content": sortie, "role": "assistant" }))
}
