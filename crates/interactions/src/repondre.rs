//! Répondre à une question posée à l'écran (T032) — **la règle qui compte
//! plus que les autres : on n'envoie jamais une touche qui n'est pas un
//! choix offert par la question affichée.** Pas de « 1 par défaut », pas de
//! touche devinée, pas d'`enter` seul — une invite de codex peut autoriser
//! l'exécution de code ; envoyer un chiffre que personne n'a proposé serait
//! envoyer une décision que l'utilisateur n'a pas prise.

use crate::ecran::{Choix, Navigation, Question, est_option_saisie_libre, question_de_l_ecran};
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
/// texte, `enter`. Chez Claude Code (« Type something. »), le chiffre place
/// le curseur dans le champ : numéro, texte, `enter`. ⚠️ L'ordre est **prouvé par le code d'opencode** (bundle
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
    let reponse_libre = texte.unwrap_or("").trim();
    let saisie_libre = question
        .choix
        .iter()
        .find(|choix| choix.numero == numero as u64)
        .is_some_and(|choix| est_option_saisie_libre(&choix.libelle));

    /*
      ⚠️ **La séquence se décide sur ce que l'écran MONTRE, pas sur un agent
      supposé** (retour du 2026-10-29). Mesuré dans les codes sources :
      - Codex (`list_selection_view.rs`) et le sélecteur standard de Claude
        Code (2.1.312) VALIDENT au chiffre : un `enter` de plus tombait sur
        l'écran suivant — la question 2, ou l'approbation suivante, dont
        l'option 1 (« Yes ») est sélectionnée par défaut. On répondait à une
        question que personne n'avait lue.
      - opencode (bundle 2.0.23), la variante « aperçus » de Claude et les
        lignes « confirmation explicite » de Codex SÉLECTIONNENT au chiffre,
        et `enter` valide.
      Règle : là où un curseur est visible (`›`, `❯`), on envoie le chiffre
      SEUL, on relit, et `enter` ne part que si c'est la MÊME question avec le
      curseur sur NOTRE choix — `enter` ne peut alors valider que lui. Là où
      aucun curseur n'est visible (opencode surligne en couleur), la séquence
      prouvée par son code : chiffre puis `enter`.
    */
    let curseur_visible = question.choix.iter().any(|choix| choix.selectionne);
    if question.navigation == Navigation::Fleches {
        if let Some(refus) = deplace_curseur(port, pane, &question, numero as u64, &avant)? {
            return Ok(refus);
        }
        attends(&mut port.send_keys(TargetedKeys {
            pane: pane.clone(),
            keys: vec![String::from("enter")],
        }))?;
    } else if curseur_visible {
        if saisie_libre && reponse_libre.is_empty() {
            return Ok(ReponseQuestion {
                etat: EtatReponse::Refusee,
                detail: String::from("this choice needs your text — nothing was sent"),
            });
        }
        attends(&mut port.send_keys(TargetedKeys {
            pane: pane.clone(),
            keys: vec![numero.to_string()],
        }))?;
        let ecran_avant = avant.text.clone().unwrap_or_default();
        let apres_chiffre = relit_apres_frappe(port, pane, &ecran_avant)?;
        if let Some(encore) = question_de_l_ecran(&apres_chiffre)
            && meme_question(&encore, &question)
        {
            let curseur = encore
                .choix
                .iter()
                .find(|choix| choix.selectionne)
                .map(|choix| choix.numero);
            if curseur != Some(numero as u64) {
                return Ok(ReponseQuestion {
                    etat: EtatReponse::Transmise,
                    detail: String::from(
                        "the choice key was sent but the cursor is not on it — nothing was validated",
                    ),
                });
            }
            // Le champ de saisie libre est sous le curseur : le texte, puis
            // `enter` qui le valide. Sinon, `enter` valide NOTRE choix.
            if saisie_libre {
                attends(&mut port.send_text(TargetedText {
                    pane: pane.clone(),
                    text: reponse_libre.to_string(),
                }))?;
            }
            attends(&mut port.send_keys(TargetedKeys {
                pane: pane.clone(),
                keys: vec![String::from("enter")],
            }))?;
        }
    } else {
        // `enter` valide le choix : le numéro seul le sélectionne (opencode).
        attends(&mut port.send_keys(TargetedKeys {
            pane: pane.clone(),
            keys: vec![numero.to_string(), String::from("enter")],
        }))?;
        // ⚠️ Saisie libre : le choix ouvre un champ, il faut y écrire — sinon
        // l'agent bloquait toujours, et rien à l'écran ne le disait.
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

/// La même question : même texte, mêmes libellés de choix.
fn meme_question(a: &Question, b: &Question) -> bool {
    a.texte == b.texte
        && a.choix.len() == b.choix.len()
        && a.choix
            .iter()
            .zip(b.choix.iter())
            .all(|(x, y)| x.libelle == y.libelle)
}

/// Le nombre de relectures après une frappe, et leur intervalle : l'interface
/// de l'agent redessine en quelques dizaines de millisecondes.
const RELECTURES: usize = 8;
const INTERVALLE_RELECTURE: std::time::Duration = std::time::Duration::from_millis(75);

/// Relit l'écran jusqu'à ce qu'il change (la frappe a été dessinée), borné :
/// un écran qui ne bouge pas est rendu tel quel.
fn relit_apres_frappe(
    port: &PortPourQuestion,
    pane: &PaneId,
    avant: &str,
) -> Result<String, PortError> {
    let mut dernier = String::new();
    for _ in 0..RELECTURES {
        std::thread::sleep(INTERVALLE_RELECTURE);
        dernier = attends(&mut port.read_screen(ScreenRead {
            pane: pane.clone(),
            max_lines: 200,
        }))?
        .text
        .unwrap_or_default();
        if dernier != avant {
            break;
        }
    }
    Ok(dernier)
}

/// Le nombre maximal de pas de curseur — une liste d'écran, pas un menu infini.
const PAS_MAXIMUM: u64 = 20;

/// Amène le curseur `→` sur `cible`, un pas à la fois (`j` descend, `k`
/// monte — `extension-selector.js` de pi les lit en texte brut), en RELISANT
/// l'écran après chaque pas. Rend un refus si le curseur n'y arrive pas :
/// `enter` ne part alors jamais.
fn deplace_curseur(
    port: &PortPourQuestion,
    pane: &PaneId,
    question: &Question,
    cible: u64,
    avant: &domain::observation::ScreenObservation,
) -> Result<Option<ReponseQuestion>, PortError> {
    let mut ecran = avant.text.clone().unwrap_or_default();
    let mut courante = question.clone();
    for _ in 0..PAS_MAXIMUM {
        let curseur = courante
            .choix
            .iter()
            .find(|choix| choix.selectionne)
            .map(|choix| choix.numero);
        let Some(curseur) = curseur else { break };
        if curseur == cible {
            return Ok(None);
        }
        let pas = if cible > curseur { "j" } else { "k" };
        attends(&mut port.send_text(TargetedText {
            pane: pane.clone(),
            text: String::from(pas),
        }))?;
        ecran = relit_apres_frappe(port, pane, &ecran)?;
        match question_de_l_ecran(&ecran) {
            Some(suivante) if meme_question(&suivante, question) => {
                let nouveau = suivante
                    .choix
                    .iter()
                    .find(|choix| choix.selectionne)
                    .map(|choix| choix.numero);
                // Un pas sans effet : l'interface ne suit pas — on s'arrête là
                // plutôt que d'y frapper encore.
                if nouveau == Some(curseur) {
                    break;
                }
                courante = suivante;
            }
            _ => break,
        }
    }
    Ok(Some(ReponseQuestion {
        etat: EtatReponse::Transmise,
        detail: String::from(
            "the cursor could not be brought onto the choice — nothing was validated",
        ),
    }))
}
