//! Le harnais : chaque module `unit/` s'exécute sous un seul binaire.
//! Aucun test sous `src/` (règle du dépôt).

#[path = "unit/mod.rs"]
mod unit;
