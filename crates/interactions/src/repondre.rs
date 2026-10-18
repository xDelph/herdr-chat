//! Répondre à une question posée à l'écran (T032) — **la règle qui compte
//! plus que les autres : on n'envoie jamais une touche qui n'est pas un
//! choix offert par la question affichée.** Pas de « 1 par défaut », pas de
//! touche devinée, pas d'`enter` seul — une invite de codex peut autoriser
//! l'exécution de code ; envoyer un chiffre que personne n'a proposé serait
//! envoyer une décision que l'utilisateur n'a pas prise.

use crate::ecran::{Choix, question_de_l_ecran};
use domain::errors::PortError;
use domain::ids::PaneId;
use domain::ports::{ControlPort, PortFuture, ScreenRead, TargetedKeys, TargetedText};

/// Ce qui s'est réellement passé — trois états nommés, jamais « envoyé ».
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum EtatReponse {
    /// L'invite a disparu — la réponse a été prise.
    Appliquee,
    /// La frappe est partie, l'invite est **toujours là** : un succès de
    /// transport n'est pas un succès d'application.
    Transmise,
    /// Rien n'a été envoyé, et la cause est nommée.
    Refusee,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ReponseQuestion {
    pub etat: EtatReponse,
    pub detail: String,
}

/// Le numéro est-il un choix **réellement proposé** ? — la garde qui empêche
/// d'envoyer une décision qui n'existe pas (testée seule, comme le fil).
#[must_use]
pub fn numero_offert(choix: &[Choix], numero: i64) -> bool {
    crate::ecran::numero_offert(choix, numero)
}

/// L'attente d'un port : les adaptateurs de ce socle sont **bloquants
/// déguisés** (le transport Unix bloque dans l'appel) — ils répondent au
/// premier poll. Un `Pending` serait un adaptateur mal branché : on le dit,
/// on ne l'attend pas.
fn attends<T: Send>(fut: &mut PortFuture<'_, T>) -> Result<T, PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match fut.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => {
            panic!("un port bloquant répond au premier poll ; Pending est un branchement cassé")
        }
    }
}

/// Le port étroit dont répondre a besoin — **et rien de plus** (mesuré :
/// `Pick<HerdrApi, "readAgent" | "sendKeys" | "sendText">`) : le trait
/// `ControlPort` du domaine le fournit déjà, un faux de quelques lignes
/// suffit aux tests.
pub type PortPourQuestion = dyn ControlPort + 'static;

/// Répond à la question affichée sur un pane.
///
/// ⚠️ **`texte` n'est pas une décoration.** « Type your own answer » est un
/// choix qu'opencode ajoute lui-même : le choisir **ouvre un champ texte** —
/// la séquence complète est le numéro, `enter` (qui ouvre le champ), le
/// texte, `enter`. ⚠️ L'ordre est **prouvé par le code d'opencode** (bundle
/// 2.0.23) : un chiffre SÉLECTIONNE sans valider, et `return` valide.
///
/// ⚠️ Un texte vide ou fait d'espaces n'écrit rien : valider un champ vide
/// ferait avancer l'agent sur du vent.
///
/// ⚠️ On RELIT après avoir frappé — même discipline que la confiance : un
/// succès de send_keys est un succès de **transport**, pas d'application.
/// Ne lève jamais pour un refus : un refus est une **valeur**.
pub fn repondre_question(
    port: &PortPourQuestion,
    pane: &PaneId,
    numero: i64,
    texte: Option<&str>,
) -> Result<ReponseQuestion, PortError> {
    // Lecture AVANT : quelle est la question, quels choix offre-t-elle ?
    let avant = attends(&mut port.read_screen(ScreenRead {
        pane: pane.clone(),
        max_lines: 200,
    }))?;
    let Some(question) = question_de_l_ecran(avant.text.as_deref().unwrap_or("")) else {
        return Ok(ReponseQuestion {
            etat: EtatReponse::Refusee,
            detail: String::from("no readable question on screen — nothing was sent"),
        });
    };
    if !numero_offert(&question.choix, numero) {
        let offerts = question
            .choix
            .iter()
            .map(|choix| choix.numero.to_string())
            .collect::<Vec<String>>()
            .join(", ");
        return Ok(ReponseQuestion {
            etat: EtatReponse::Refusee,
            detail: format!(
                "choice {numero} refused: the question only offers {offerts} — nothing was sent"
            ),
        });
    }
    // `enter` valide le choix : le numéro seul le sélectionne sans soumettre.
    attends(&mut port.send_keys(TargetedKeys {
        pane: pane.clone(),
        keys: vec![numero.to_string(), String::from("enter")],
    }))?;

    // ⚠️ Saisie libre : le choix ouvre un champ, il faut y écrire — sinon
    // l'agent bloquait toujours, et rien à l'écran ne le disait.
    let reponse_libre = texte.unwrap_or("").trim();
    if !reponse_libre.is_empty() {
        attends(&mut port.send_text(TargetedText {
            pane: pane.clone(),
            text: reponse_libre.to_string(),
        }))?;
        attends(&mut port.send_keys(TargetedKeys {
            pane: pane.clone(),
            keys: vec![String::from("enter")],
        }))?;
    }

    // Relecture : l'application est un **fait observé**, pas une intention.
    let apres = attends(&mut port.read_screen(ScreenRead {
        pane: pane.clone(),
        max_lines: 200,
    }))?;
    let libelle = question
        .choix
        .iter()
        .find(|choix| choix.numero == numero as u64)
        .map(|choix| choix.libelle.clone())
        .unwrap_or_else(|| numero.to_string());
    if question_de_l_ecran(apres.text.as_deref().unwrap_or("")).is_some() {
        return Ok(ReponseQuestion {
            etat: EtatReponse::Transmise,
            detail: format!(
                "“{libelle}” sent — the question is still on screen, so it is not proven applied"
            ),
        });
    }
    Ok(ReponseQuestion {
        etat: EtatReponse::Appliquee,
        detail: format!("“{libelle}” — the agent resumed"),
    })
}
