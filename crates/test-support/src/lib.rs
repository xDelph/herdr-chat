//! Ressources de tests, et rien d'autre (TECH §2) : faux ports, horloge
//! contrôlée, magasins jetables, charges synthétiques et capture d'actions.
//!
//! ⚠️ Cette crate est **dev-only** (`publish = false`) : rien de ceci ne
//! peut devenir un défaut de production. Elle conn uniquement `domain` —
//! jamais Herdr, jamais un agent, jamais le HOME, jamais un socket réel.
//! Toute médiation passe par les constructeurs : une racine temporaire
//! créée **sous le tmpdir du système**, nettoyée à la dernière main.
//!
//! Modules (TECH §2, liste exacte) :
//!
//! - `fake_herdr` — le faux port de contrôle Herdr et sa capture ordonnée ;
//! - `fake_clock` — horloge contrôlée, avancée à la main ;
//! - `temp_stores` — racine temporaire, magasins JSONL et SQLite jetables ;
//! - `fixtures` — charges synthétiques classées et processus de catalogue factice ;
//! - `push_sink` — faux port de notification : remises capturées, pas envoyées.

pub mod fake_clock;
pub mod fake_herdr;
pub mod fixtures;
pub mod push_sink;
pub mod temp_stores;
