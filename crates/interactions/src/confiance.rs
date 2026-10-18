//! L'invite de confiance à l'écran (T037/C07) : **détectée, jamais
//! supposée** — et surtout, détecter n'est pas répondre.
//!
//! ⚠️ **Pourquoi ne jamais répondre automatiquement.** « Trust this
//! folder? » autorise l'agent à lire, écrire **et exécuter du code** dans ce
//! dossier — et la réponse est **persistante** (elle écrit
//! `[projects."…"] trust_level = "trusted"` dans la config de l'agent).
//! Répondre « oui » à la création d'un agent reviendrait à accorder une
//! confiance à un dossier que l'utilisateur n'a pas choisi de voir. La
//! décision est donc exposée à l'application, devant le nom du dossier ;
//! jamais une touche ne part d'ici.
//!
//! ⚠️ **Sur le texte, faute de code typé** : c'est le texte de l'écran —
//! mesuré sur un pane réel — qui nomme l'invite, pas l'état `blocked` (un
//! agent bloqué est bloqué sur n'importe quel dialogue).

/// Les marqueurs de l'invite de confiance, relevés sur l'écran réel :
/// `agent.start` a renvoyé exactement ce texte pour codex sur un dossier
/// non approuvé — la recherche est celle de la phrase, pas une
/// interprétation de l'état amont.
const MARQUEURS_CONFIANCE: [&str; 2] = ["trust this folder", "trust this directory"];

/// `true` si l'invite de confiance est réellement à l'écran — en minuscules,
/// comme le fil.
#[must_use]
pub fn est_invite_confiance(ecran: &str) -> bool {
    let normalise = ecran.to_lowercase();
    MARQUEURS_CONFIANCE
        .iter()
        .any(|marqueur| normalise.contains(marqueur))
}
