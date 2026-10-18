//! Cible Cargo externe : les tests de `interactions`, sous-modules de
//! `tests/unit` (aucun test sous `src/`).
//!
//! ⚠️ Politique clippy héritée : ni `unwrap` ni `expect` — `assert`/`match`
//! /`panic!` au motif. Une porte doit être prouvée capable d'échouer.

mod unit;
