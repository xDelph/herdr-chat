//! Cible Cargo externe : les tests de `notifications`, présentés en
//! sous-modules de `tests/unit` (aucun test sous `src/`).
//!
//! ⚠️ Politique clippy héritée (`unwrap_used`/`expect_used`) : ni `unwrap`
//! ni `expect` — les échecs annoncent leur motif via `assert`, `match` ou
//! `panic!`. Une porte doit être prouvée capable d'échouer.

mod unit;
