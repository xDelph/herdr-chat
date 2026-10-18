//! Les primitives de texte de la famille OpenAI (T016) — la sortie d'outil
//! sous ses deux formes mesurées, et les lectures sûres du pi partagé.

use serde_json::{Value, json};

/// Le texte d'une **sortie d'outil** (mesuré : `output` est une LISTE de
/// blocs `{type:"input_text", text}` pour `function_call_output`, mais une
/// simple chaîne ailleurs — les deux formes dans le même fichier).
#[must_use]
pub fn texte_de_sortie(sortie: &Value) -> String {
    if let Some(texte) = sortie.as_str() {
        return texte.to_string();
    }
    let tableau = match sortie.as_array() {
        Some(tableau) => tableau,
        None => return String::new(),
    };
    tableau
        .iter()
        .filter_map(|bloc| bloc.get("text"))
        .filter_map(Value::as_str)
        .collect::<Vec<&str>>()
        .join("")
}

/// Une chaîne non vide, ou rien (pi.ts `texteDe`).
#[must_use]
pub fn texte_de(valeur: &Value) -> Option<String> {
    let texte = valeur.as_str()?;
    if texte.trim().is_empty() {
        return None;
    }
    Some(texte.to_string())
}

/// Un nom de modèle **utilisable**, ou rien — tout ce qui est entre chevrons
/// (`<synthetic>`) est un substitut fabriqué par l'agent, jamais un modèle
/// (pi.ts, mesure `9054562f-7ce…`) : l'afficher remplacerait « inconnu » par
/// une valeur qui *a l'air* d'un modèle.
#[must_use]
pub fn modele_utilisable(valeur: &Value) -> Option<String> {
    let texte = texte_de(valeur)?;
    if texte.starts_with('<') && texte.ends_with('>') {
        return None;
    }
    Some(texte)
}

/// Un bloc de texte pi — la brique commune des messages traduits.
#[must_use]
pub fn bloc_texte(texte: &str) -> Value {
    json!({ "text": texte, "type": "text" })
}
