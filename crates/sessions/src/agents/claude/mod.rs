//! Le profil **Claude** (T020/D14) — la session JSONL de Claude Code.
pub mod collages;
pub mod harnais;
pub mod politique;
pub mod taches;

pub use politique::{
    ProfilClaude, demande_en_cours_de_tour, execution_shell, ligne_claude_vers_pi, ligne_traitee,
};
