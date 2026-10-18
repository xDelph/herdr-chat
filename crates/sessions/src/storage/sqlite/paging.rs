//! Les formes de requête **communes** (T015) : pages avant/arrière sur une
//! colonne d'ordre — `seq` chez opencode, `row_id` chez Devin — paramètres
//! **liés**, jamais interpolés.
//!
//! ⚠️ L'ordre du fil : `ASC` en avant, `DESC` **et `<` strict** en arrière —
//! le curseur d'arrière est la borne, pas un rang recomposé.

use serde_json::Value;

/// La page **avant** depuis une borne (exclusive) — la borne est le dernier
/// ordre déjà servi ; une borne absente part du début.
#[must_use]
pub fn sql_avant(table: &str, colonne_ordre: &str, limite: u32) -> String {
    format!("SELECT * FROM {table} ORDER BY {colonne_ordre} ASC LIMIT {limite}")
}

/// La page **avant** après une borne : les lignes **au-delà** de l'ordre déjà
/// servi — la borne est liée (`?`), jamais interpolée.
#[must_use]
pub fn sql_avant_apres(table: &str, colonne_ordre: &str, limite: u32) -> String {
    format!(
        "SELECT * FROM {table} WHERE {colonne_ordre} > ?1 ORDER BY {colonne_ordre} ASC LIMIT {limite}"
    )
}

/// La page **arrière** avant une borne : `< ?1` strict, ordre **décroissant**,
/// puis la limite — le consommateur remet dans l'ordre de lecture.
#[must_use]
pub fn sql_arriere(table: &str, colonne_ordre: &str, limite: u32) -> String {
    format!(
        "SELECT * FROM {table} WHERE {colonne_ordre} < ?1 ORDER BY {colonne_ordre} DESC LIMIT {limite}"
    )
}

/// La valeur de borne d'une ligne rendue (par nom de colonne) — le curseur
/// de la page suivante.
#[must_use]
pub fn borne_de(lignes: &[super::worker::Ligne], colonne: &str) -> Option<Value> {
    let derniere = lignes.last()?;
    let position = derniere.colonnes.iter().position(|nom| nom == colonne)?;
    derniere.valeurs.get(position).cloned()
}
