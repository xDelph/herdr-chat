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

use domain::errors::PortError;
use domain::ids::PaneId;
use domain::ports::{ControlPort, ScreenRead, TargetedKeys};

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

/// Les touches d'une réponse de confiance, **par famille mesurée** — et
/// `None` pour toute famille qu'on n'a pas mesurée.
///
/// ⚠️ **Ce `None` est un garde-fou, pas une timidité.** Le défaut mesuré :
/// le type d'agent n'était pas lu, la famille valait `null`, et la table
/// retombait sur les touches de **codex** — `1` puis `enter`. Sur l'invite
/// de claude, qui est une **sélection sans numéros**, le `1` est ignoré et
/// le `enter` valide l'option déjà surlignée : « No, exit ». L'agent
/// **sortait**. Envoyer une touche non mesurée, c'est appuyer au hasard sur
/// une invite dont on ne connaît pas les options.
#[must_use]
pub fn touches_de_confiance(famille: Option<&str>, accepte: bool) -> Option<Vec<String>> {
    match (famille, accepte) {
        // claude : une SÉLECTION — descendre puis valider ; ou valider le
        // « No, exit » déjà surligné.
        (Some("claude"), true) => Some(vec![String::from("down"), String::from("enter")]),
        (Some("claude"), false) => Some(vec![String::from("enter")]),
        // codex : des options NUMÉROTÉES — un chiffre suffit, pas d'enter.
        (Some("codex"), true) => Some(vec![String::from("1"), String::from("enter")]),
        (Some("codex"), false) => Some(vec![String::from("2")]),
        _ => None,
    }
}

/// L'état d'une confiance tranchée — les quatre libellés du fil, aucun
/// n'affirme plus que ce qui a été observé.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum EtatConfiance {
    /// La frappe est partie, l'acceptation n'est **pas** prouvée.
    Transmise,
    /// L'invite a disparu ET l'agent est encore là : la confiance est écrite.
    Acceptee,
    /// Le refus est prouvé par la disparition de l'invite.
    Refusee,
    /// Rien n'a été envoyé, et la cause est nommée.
    NonApplicable,
}

/// Le résultat d'une réponse de confiance — `accepted` n'est vrai que si
/// l'acceptation est **prouvée**, jamais parce que l'utilisateur l'a voulue.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ReponseConfiance {
    pub accepted: bool,
    pub etat: EtatConfiance,
    pub detail: String,
}

/// Répond à l'invite de confiance — **sans jamais prétendre que la confiance
/// a été accordée** (B06).
///
/// ⚠️ **Pourquoi relire après l'envoi.** `send_keys` dit que la frappe est
/// partie : c'est un succès de **transport**, pas d'acceptation. Herdr peut
/// refuser la touche, l'agent peut redémarrer, l'invite peut ne pas être
/// celle qu'on croyait.
///
/// ⚠️ **La preuve, c'est deux choses, pas une.** L'invite qui disparaît ne
/// suffit pas : un agent qui **meurt** n'affiche plus d'invite non plus — le
/// défaut a été vu en vrai, la carte annonçait « accordé » alors que l'agent
/// venait de sortir. On exige donc aussi que l'agent soit encore là.
pub fn repondre_confiance(
    port: &dyn ControlPort,
    pane: &PaneId,
    accepte: bool,
    famille: Option<&str>,
) -> Result<ReponseConfiance, PortError> {
    // 1) Lire AVANT : un agent peut avoir été débloqué entre-temps — on ne
    //    touche alors à rien.
    let avant = attends(&mut port.read_screen(ScreenRead {
        pane: pane.clone(),
        max_lines: 200,
    }))?;
    if !est_invite_confiance(avant.text.as_deref().unwrap_or("")) {
        return Ok(ReponseConfiance {
            accepted: false,
            etat: EtatConfiance::NonApplicable,
            detail: String::from("the trust prompt is no longer on screen — nothing was sent"),
        });
    }
    // 2) Les touches viennent de la famille MESURÉE ; inconnue = refus.
    let Some(touches) = touches_de_confiance(famille, accepte) else {
        return Ok(ReponseConfiance {
            accepted: false,
            etat: EtatConfiance::NonApplicable,
            detail: format!(
                "no known key sequence for the prompt of “{}” — answer it on the Mac",
                famille.unwrap_or("this agent")
            ),
        });
    };
    attends(&mut port.send_keys(TargetedKeys {
        pane: pane.clone(),
        keys: touches,
    }))?;
    // 3) L'agent est-il ENCORE LÀ ? Une invite disparue sur un agent mort ne
    //    prouve rien de la confiance.
    let vivant = match attends(&mut port.list_agents()) {
        Ok(liste) => liste.agents.iter().any(|agent| agent.pane_id == *pane),
        // La lecture de la liste a échoué : l'état de l'agent est
        // inconnaissable — « transmise », jamais « accordée ».
        Err(_) => false,
    };
    if !vivant {
        return Ok(ReponseConfiance {
            accepted: false,
            etat: EtatConfiance::Transmise,
            detail: format!(
                "the agent of {} is gone — nothing is proven about the trust",
                pane.as_str()
            ),
        });
    }
    // 4) Relire : l'acceptation est un **fait observé**, pas une intention.
    let apres = attends(&mut port.read_screen(ScreenRead {
        pane: pane.clone(),
        max_lines: 200,
    }))?;
    if est_invite_confiance(apres.text.as_deref().unwrap_or("")) {
        return Ok(ReponseConfiance {
            accepted: false,
            etat: EtatConfiance::Transmise,
            detail: if accepte {
                String::from(
                    "decision sent — the prompt is still on screen, so acceptance is not proven",
                )
            } else {
                String::from("decision sent — the refusal is not yet confirmed by the screen")
            },
        });
    }
    Ok(if accepte {
        ReponseConfiance {
            accepted: true,
            etat: EtatConfiance::Acceptee,
            detail: format!(
                "trust granted for this folder — {} will be able to run code there",
                famille.unwrap_or("the agent")
            ),
        }
    } else {
        // Le refus **arrête** l'agent : codex l'écrit (`2. Quit`), claude
        // aussi (`No, exit`). On nomme la conséquence au lieu de la masquer.
        ReponseConfiance {
            accepted: false,
            etat: EtatConfiance::Refusee,
            detail: String::from(
                "trust denied: the folder stays unapproved, and this option quits the agent",
            ),
        }
    })
}

/// L'attente d'un port : les adaptateurs de ce socle sont bloquants
/// déguisés — ils répondent au premier poll. Un `Pending` est un
/// branchement cassé, dit comme tel.
fn attends<T: Send>(fut: &mut domain::ports::PortFuture<'_, T>) -> Result<T, PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match fut.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => {
            panic!("un port bloquant répond au premier poll ; Pending est un branchement cassé")
        }
    }
}
