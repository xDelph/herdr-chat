//! Le codec **opencode** (T021/D15/D17) — le port de `opencode.ts` : les
//! lignes de `session_message` vers la forme pi.
//!
//! ⚠️ **Les refus sont délibérés et mesurés** : `idle` (fin de tour — Herdr
//! porte déjà la frontière), `system` (configuration, le piège `developer`
//! de codex), `synthetic` (la commande est DANS une balise — la reconstituer
//! serait une déduction), `compaction` (pas la forme de pi). Un refus
//! explicite coûte deux lignes sur 1 931 ; une traduction inventée coûterait
//! la confiance dans tout le reste.

use crate::families::openai::text::{bloc_texte, modele_utilisable, texte_de};
use domain::session::LignePi;
use serde_json::{Value, json};

/// Les arguments d'un appel d'outil : `state.input` doit être un objet —
/// ⚠️ une valeur d'une autre forme est conservée **sous une clé** plutôt que
/// jetée (perdre la commande d'un appel serait pire qu'une forme inattendue).
fn arguments_de(entree: &Value) -> Value {
    if entree.is_object() {
        return entree.clone();
    }
    if entree.is_null() {
        return json!({});
    }
    json!({ "valeur": entree })
}

/// Une image depuis une URI `data:` base64 — tout le reste est refusé :
/// pas d'image inventée, pas de chemin interprété.
fn image_de(part: &Value) -> Option<(String, String)> {
    let uri = part.get("uri")?.as_str()?;
    let reste = uri.strip_prefix("data:")?;
    let (mime, donnees) = reste.split_once(";base64,")?;
    if mime.is_empty() || donnees.is_empty() {
        return None;
    }
    Some((mime.to_string(), donnees.to_string()))
}

/// Un appel d'outil opencode → **appel, puis résultat** (pi les sépare ;
/// le regroupement rattache le résultat au dernier appel publié). ⚠️ Aucun
/// résultat vide : un appel en cours n'a pas encore de sortie.
fn blocs_d_outils(part: &Value) -> Vec<Value> {
    let identifiant =
        texte_de(part.get("id").unwrap_or(&Value::Null)).unwrap_or_else(|| String::from("appel"));
    let nom =
        texte_de(part.get("name").unwrap_or(&Value::Null)).unwrap_or_else(|| String::from("outil"));
    let etat = part.get("state").and_then(Value::as_object);
    let mut textes: Vec<String> = Vec::new();
    let mut images: Vec<(String, String)> = Vec::new();
    for sortie in part
        .get("content")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        let genre = sortie.get("type").and_then(Value::as_str).unwrap_or("");
        match genre {
            "text" => {
                if let Some(texte) = sortie.get("text").and_then(Value::as_str) {
                    textes.push(texte.to_string());
                }
            }
            "file" => {
                if let Some(image) = image_de(sortie) {
                    images.push(image);
                }
            }
            _ => (),
        }
    }
    let mut blocs = vec![json!({
        "arguments": arguments_de(etat.and_then(|etat| etat.get("input")).unwrap_or(&Value::Null)),
        "id": identifiant,
        "name": nom,
        "type": "toolCall",
    })];
    let texte = textes.join("");
    if !texte.is_empty() || !images.is_empty() {
        // `status: "error"` est le SEUL marqueur d'échec que la base porte.
        let en_echec = etat
            .and_then(|etat| etat.get("status"))
            .and_then(Value::as_str)
            == Some("error");
        let mut resultat = json!({
            "isError": en_echec,
            "text": texte,
            "toolName": nom,
            "type": "toolResult",
        });
        if !images.is_empty() {
            resultat["images"] = json!(
                images
                    .iter()
                    .map(|(donnees, mime)| json!({ "data": donnees, "mimeType": mime }))
                    .collect::<Vec<Value>>()
            );
        }
        blocs.push(resultat);
    }
    blocs
}

/// Une partie de contenu → zéro, un ou deux blocs pi.
fn blocs_de_partie(part: &Value) -> Vec<Value> {
    let genre = part.get("type").and_then(Value::as_str).unwrap_or("");
    match genre {
        "text" => {
            let texte = part.get("text").and_then(Value::as_str).unwrap_or("");
            if texte.is_empty() {
                Vec::new()
            } else {
                vec![bloc_texte(texte)]
            }
        }
        // La réflexion d'opencode est EN CLAIR (contrairement à codex) :
        // publiée, `redacted: false`.
        "reasoning" => {
            let texte = part.get("text").and_then(Value::as_str).unwrap_or("");
            if texte.is_empty() {
                Vec::new()
            } else {
                vec![json!({ "redacted": false, "thinking": texte, "type": "thinking" })]
            }
        }
        "tool" => blocs_d_outils(part),
        "file" => match image_de(part) {
            Some((donnees, mime)) => {
                vec![json!({ "data": donnees, "mimeType": mime, "type": "image" })]
            }
            None => Vec::new(),
        },
        // Un type de partie inconnu est ÉCARTÉ, pas deviné.
        _ => Vec::new(),
    }
}

/// `time.created`, en millisecondes Unix, depuis le `data` de la ligne.
fn debut_de(data: &Value) -> Option<&Value> {
    data.get("time")?.get("created")
}

/// Un horodatage **ISO 8601** depuis des millisecondes Unix (pi normalise
/// ICI, à l'entrée) — sans dépendance : l'algorithme civil (Howard Hinnant),
/// testé sur les bornes. Une date absurde (0, très au-delà) ne fabrique RIEN.
#[must_use]
pub fn horodatage_iso(millisecondes: i64) -> Option<String> {
    if millisecondes <= 0 || millisecondes > 4_102_444_800_000 {
        return None;
    }
    let secondes = millisecondes.div_euclid(1000);
    let millisecondes_restantes = millisecondes.rem_euclid(1000);
    let jours = secondes.div_euclid(86_400);
    let secondes_du_jour = secondes.rem_euclid(86_400);
    // civil_from_days : z -> (y, m, d)
    let z = jours + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let annee = if m <= 2 { y + 1 } else { y };
    let heure = secondes_du_jour / 3600;
    let minute = (secondes_du_jour % 3600) / 60;
    let seconde = secondes_du_jour % 60;
    Some(format!(
        "{annee:04}-{m:02}-{d:02}T{heure:02}:{minute:02}:{seconde:02}.{millisecondes_restantes:03}Z"
    ))
}

/// Traduit une ligne de `session_message` en ligne de forme pi —
/// `None` quand ce n'est pas de la conversation. ⚠️ L'identifiant est
/// **fourni par l'appelant** (la clé de la ligne) : c'est lui qui rend le
/// message stable d'une lecture à l'autre (D15 — le remplacement par
/// identifiant, pas l'empilement).
#[must_use]
pub fn ligne_opencode_vers_pi(type_ligne: &str, data: &Value, id: &str) -> Option<LignePi> {
    let objet = data.as_object()?;
    let horodatage = debut_de(data)
        .and_then(Value::as_i64)
        .and_then(horodatage_iso);

    // Le modèle, sur le message lui-même — ⚠️ `variant` EST le niveau de
    // raisonnement (le bundle d'opencode l'attache aux niveaux d'effort) ;
    // **`default` est refusé** : c'est le nom d'« aucun niveau choisi »
    // (52 occurrences mesurées) — l'afficher ferait lire un niveau là où
    // l'agent n'a rien déclaré (D17).
    let brut = objet.get("model").and_then(Value::as_object);
    let modele = brut.and_then(|b| modele_utilisable(b.get("id").unwrap_or(&Value::Null)));
    let fournisseur = modele
        .as_ref()
        .and_then(|_| brut.and_then(|b| texte_de(b.get("providerID").unwrap_or(&Value::Null))));
    let variante = brut.and_then(|b| texte_de(b.get("variant").unwrap_or(&Value::Null)));
    let niveau = variante.filter(|variante| variante != "default");

    let enveloppe = |message: Value| -> Option<LignePi> {
        let mut complet = json!({
            "type": "message",
            "id": format!("opencode:{id}"),
            "message": {
                "content": message["content"].clone(),
                "role": message["role"].clone(),
            },
        });
        if let Some(horodatage) = &horodatage {
            complet["timestamp"] = json!(horodatage);
        }
        if let Some(modele) = &modele {
            complet["message"]["model"] = json!(modele);
        }
        if let Some(fournisseur) = &fournisseur {
            complet["message"]["provider"] = json!(fournisseur);
        }
        if let Some(niveau) = &niveau {
            complet["message"]["thinkingLevel"] = json!(niveau);
        }
        serde_json::from_value(complet).ok()
    };

    if type_ligne == "user" {
        // Le message utilisateur porte son texte À LA RACINE.
        let texte = texte_de(objet.get("text").unwrap_or(&Value::Null))?;
        return enveloppe(json!({ "content": [bloc_texte(&texte)], "role": "user" }));
    }
    if type_ligne == "assistant" {
        let blocs = objet
            .get("content")
            .and_then(Value::as_array)
            .map(|parties| {
                parties
                    .iter()
                    .flat_map(blocs_de_partie)
                    .collect::<Vec<Value>>()
            })
            .unwrap_or_default();
        // Un message sans bloc n'est pas un message : pas de bulle vide.
        if blocs.is_empty() {
            return None;
        }
        return enveloppe(json!({ "content": blocs, "role": "assistant" }));
    }
    None
}
