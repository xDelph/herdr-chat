//! Les DTO du fil HTTP — un module par famille de routes (TECH §5).
//!
//! ⚠️ **Représentation exacte, pas représentation commode.** Chaque champ
//! porte l'une des quatre présences de [`crate::presence`] selon le schéma
//! TS autoritaire ; chaque nom du fil est verrouillé par serde (`camelCase`
//! pour les vues api.ts, `snake_case` natif pour la famille snapshot).
//! Aucun champ inventé, aucun champ perdu.

pub mod catalog;
pub mod commands;
pub mod conversations;
pub mod diagnostics;
pub mod errors;
pub mod files;
pub mod health;
pub mod interactive;
pub mod launch;
pub mod lectures;
pub mod overview;
pub mod push;
pub mod sessions;
pub mod taches;
