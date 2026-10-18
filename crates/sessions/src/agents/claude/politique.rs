//! La politique Claude (T020/D14) : le codec Anthropic porte les décisions
//! de forme (T016) ; le profil les pose sur le pipeline, avec le fallback
//! **raw** pour les lignes de conversation refusées (le piège propre à
//! claude — une ligne refusée ne doit PAS rester lisible).

use crate::families::anthropic::messages;
use crate::pipeline::{Capacites, Codec, Profil};
use serde_json::Value;

/// Le profil **Claude** : lisible, catalogue, lancement, interactions
/// (mesuré : la surface TS traite les quatre — le modèle porte sur chaque
/// réponse, la confiance sur dossier).
#[derive(Clone, Copy, Debug)]
pub struct ProfilClaude;

impl ProfilClaude {
    #[must_use]
    pub fn genre() -> &'static str {
        "claude"
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
                ligne_vers_pi: messages::ligne_vers_pi,
                reglage_vers_pi: None,
            },
        }
    }
}

/// Le traitement d'une ligne claude par le lecteur — **la politique D14** :
/// une ligne de conversation refusée est conservée **sans son message** (les
/// autres champs survivent, plus rien ne la relit comme un message) ; les
/// autres lignes passent telles quelles.
#[must_use]
pub fn ligne_traitee(ligne: &Value) -> Value {
    if messages::est_ligne_de_conversation(ligne) {
        if messages::ligne_vers_pi(ligne).is_some() {
            return ligne.clone();
        }
        // Refusée ET de forme pi : privée de son message — sinon l'aperçu
        // relit ce qu'on vient d'écarter (mesuré : [Request interrupted…]
        // annoncé comme « dernière demande »).
        return messages::sans_message(ligne);
    }
    ligne.clone()
}
