//! États à **union fermée**.
//!
//! ⚠️ **Pas de chaîne libre pour un état métier** (A04) : chaque nom vient du
//! schéma Herdr vérifié par exécution (protocole 22), et un état inconnu est un
//! refus de décodage, pas un étiquetage au hasard. Une union fermée qui
//! grossit casse la compilation des consommateurs tant que le nouveau cas
//! n'est pas traité — exactement ce qu'on veut.

use serde::{Deserialize, Serialize};
use std::fmt;

/// État d'un agent : `idle | working | blocked | done | unknown`.
///
/// ⚠️ `unknown` est un état **réel**, vérifié dans l'énum du schéma — pas un
/// fourre-tout local. Déclaré ici avec l'orthographe exacte du fil.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Working,
    Blocked,
    Done,
    Unknown,
}

/// État de la conversation visible sur une ligne de conversation
/// (`available | absent | error`, B10).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SessionState {
    Available,
    Absent,
    Error,
}

impl fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let texte = match self {
            AgentStatus::Idle => "idle",
            AgentStatus::Working => "working",
            AgentStatus::Blocked => "blocked",
            AgentStatus::Done => "done",
            AgentStatus::Unknown => "unknown",
        };
        f.write_str(texte)
    }
}

impl fmt::Display for SessionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let texte = match self {
            SessionState::Available => "available",
            SessionState::Absent => "absent",
            SessionState::Error => "error",
        };
        f.write_str(texte)
    }
}

/// Reconnaît le libellé exact d'un [`AgentStatus`], sinon rien.
///
/// Le décodage **filaire** appartient à `herdr-client` (T021) ; le domaine
/// offre la fonction totale, utile aux politiques et aux tests.
#[must_use]
pub fn statut_d_agent(raw: &str) -> Option<AgentStatus> {
    match raw {
        "idle" => Some(AgentStatus::Idle),
        "working" => Some(AgentStatus::Working),
        "blocked" => Some(AgentStatus::Blocked),
        "done" => Some(AgentStatus::Done),
        "unknown" => Some(AgentStatus::Unknown),
        _ => None,
    }
}

/// Reconnaît le libellé exact d'un [`SessionState`], sinon rien.
#[must_use]
pub fn etat_de_session(raw: &str) -> Option<SessionState> {
    match raw {
        "available" => Some(SessionState::Available),
        "absent" => Some(SessionState::Absent),
        "error" => Some(SessionState::Error),
        _ => None,
    }
}
