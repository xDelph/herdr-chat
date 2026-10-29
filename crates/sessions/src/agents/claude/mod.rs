//! Le profil **Claude** (T020/D14) — la session JSONL de Claude Code.
pub mod politique;

pub use politique::{ProfilClaude, demande_en_cours_de_tour, ligne_claude_vers_pi, ligne_traitee};
