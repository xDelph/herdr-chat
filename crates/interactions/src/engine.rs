//! Le moteur commun (T033/C03/C17) : lire → valider l'empreinte → planifier
//! → exécuter → relire — les preuves d'identité/choix avant TOUTE frappe, et
//! **aucun faux succès** dans les cinq cas du fil.
//!
//! ⚠️ **C03** : une confirmation qui ne porte pas l'empreinte DEMANDÉE n'est
//! pas une confirmation — elle se rapporte en inconnu, jamais en succès.
//!
//! ⚠️ **C17** : la question vue après la frappe doit être LA MÊME que celle
//! lue avant — une nouvelle question (ou une sélection déplacée) n'atteste
//! rien ; le résultat partiel (frappe partie, validation ratée) se conserve
//! comme partiel, pas comme appliqué.

use crate::ecran::question_de_l_ecran;
use domain::errors::PortError;
use domain::ids::{DeliveryFingerprint, PaneId};
use domain::ports::{ControlPort, PortFuture, PromptEvidence, ScreenRead, TargetedPrompt};

/// La vérification **d'identité** d'une évidence de prompt : une confirmation
/// portant une AUTRE empreinte se rapporte en inconnu — le client n'affichera
/// jamais « envoyé » sur une preuve qu'il ne reconnaît pas.
#[must_use]
pub fn preuve_reconnue(
    demandee: &DeliveryFingerprint,
    preuve: &PromptEvidence,
) -> Option<PromptEvidence> {
    match preuve {
        PromptEvidence::Confirmed { fingerprint } if fingerprint == demandee => None,
        PromptEvidence::Confirmed { fingerprint } => Some(PromptEvidence::Unknown {
            partial: Vec::new(),
            detail: format!(
                "l'empreinte confirmée ({}) n'est pas celle demandée ({}) — rien n'est prouvé",
                fingerprint.as_str(),
                demandee.as_str()
            ),
        }),
        _ => None,
    }
}

/// La question affichée a-t-elle changé entre la lecture et la relecture ?
/// — ⚠️ **C17** : une NOUVELLE question après la frappe, ou une sélection
/// (`›`) déplacée (Claude, mesuré) : la frappe a peut-être visé autre chose —
/// on ne dit PAS « appliquée ».
#[must_use]
pub fn question_a_change(avant: &str, apres: &str) -> bool {
    let (question_avant, question_apres) = (question_de_l_ecran(avant), question_de_l_ecran(apres));
    match (question_avant, question_apres) {
        (Some(avant), Some(apres)) => {
            // Le texte ET la place du sélecteur doivent être les mêmes.
            avant.texte != apres.texte
                || avant
                    .choix
                    .iter()
                    .zip(apres.choix.iter())
                    .any(|(a, b)| a.selectionne != b.selectionne)
        }
        // La question est partie : c'est le succès attendu — pas un changement.
        (Some(_), None) => false,
        // Une question NOUVELLE apparaît là où il n'y en avait pas : la
        // frappe a visé autre chose.
        (None, Some(_)) => true,
        (None, None) => false,
    }
}

/// L'attente d'un port bloquant-déguisé — le premier poll répond.
fn attends<T: Send>(fut: &mut PortFuture<'_, T>) -> Result<T, PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match fut.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => {
            panic!("un port bloquant répond au premier poll ; Pending est un branchement cassé")
        }
    }
}

/// Le moteur du prompt : exécuter puis RAPPORTER l'empreinte reconnue —
/// les résultats partiels (Unknown/Suppressed/Failed) se conservent TELS
/// QUELS (le client voit la vérité, pas un « envoyé » lissé).
pub fn soumet_prompt(
    port: &dyn ControlPort,
    demande: TargetedPrompt,
) -> Result<PromptEvidence, PortError> {
    let empreinte = demande.fingerprint.clone();
    let preuve = attends(&mut port.prompt(demande))?;
    Ok(preuve_reconnue(&empreinte, &preuve).unwrap_or(preuve))
}

/// Le moteur de la question : la séquence complète avec la relecture
/// **d'identité** — une question partie ou identique passe ; une nouvelle
/// question, une sélection déplacée : la vérité (transmise), jamais un
/// succès fabriqué.
pub fn relit_apres_frappe(
    port: &dyn ControlPort,
    pane: &PaneId,
    ecran_avant: &str,
) -> Result<Option<String>, PortError> {
    let apres = attends(&mut port.read_screen(ScreenRead {
        pane: pane.clone(),
        max_lines: 200,
    }))?;
    let texte_apres = apres.text.as_deref().unwrap_or("");
    if question_a_change(ecran_avant, texte_apres) {
        return Ok(Some(texte_apres.to_string()));
    }
    if question_de_l_ecran(texte_apres).is_some() {
        // La MÊME question reste : la frappe n'a pas été prise.
        return Ok(Some(texte_apres.to_string()));
    }
    Ok(None)
}
