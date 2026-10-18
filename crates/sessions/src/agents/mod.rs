//! Les profils d'agents (T018+) — un module par famille : la politique
//! fine de chaque agent, posée sur le pipeline commun (T017).
pub mod claude;
pub mod codex;
pub mod opencode;
pub mod pi;

pub use claude::ProfilClaude;
pub use codex::ProfilCodex;
pub use opencode::ProfilOpencode;
pub use pi::ProfilPi;
