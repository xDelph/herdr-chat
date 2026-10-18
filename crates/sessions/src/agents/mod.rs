//! Les profils d'agents (T018+) — un module par famille : la politique
//! fine de chaque agent, posée sur le pipeline commun (T017).
pub mod codex;
pub mod pi;

pub use codex::ProfilCodex;
pub use pi::ProfilPi;
