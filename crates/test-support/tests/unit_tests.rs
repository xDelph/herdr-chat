//! Cible Cargo externe : les tests unitaires de `test-support`, présentés en
//! sous-modules de `tests/unit` (aucun test sous `src/`).
//!
//! ⚠️ Politique clippy héritée (`unwrap_used`/`expect_used`) : les tests
//! n'utilisent ni `unwrap` ni `expect` — les échecs annoncent leur motif via
//! `assert`, `match` ou `panic!` explicite. Une porte doit être prouvée
//! capable d'échouer.

mod unit;
