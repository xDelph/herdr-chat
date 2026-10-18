//! La politique Codex (T019/D12–D13) : le codec Responses porte les
//! décisions de forme (T016) ; le profil les POSE sur le pipeline — avec
//! ses capacités mesurées, et sans rien changer au socle.

use crate::families::openai::responses;
use crate::pipeline::{Capacites, Codec, Profil};

/// Le profil **Codex** : lisible, catalogue, lancement, interactions (la
/// surface TS traite les quatre — le questionnement codex passe par la
/// saisie libre, la confiance par la approbation mesurée).
#[derive(Clone, Copy, Debug)]
pub struct ProfilCodex;

impl ProfilCodex {
    #[must_use]
    pub fn genre() -> &'static str {
        "codex"
    }

    #[must_use]
    pub fn capacites() -> Capacites {
        Capacites {
            lisible: true,
            catalogue: true,
            lancement: true,
            interactions: true,
        }
    }

    #[must_use]
    pub fn profil() -> Profil {
        Profil {
            genre: Self::genre(),
            capacites: Self::capacites(),
            codec: Codec {
                ligne_vers_pi: responses::ligne_vers_pi,
                reglage_vers_pi: Some(responses::reglage_vers_pi),
            },
        }
    }
}
