//! Le répondant (T032) : rien n'est envoyé hors des choix offerts, la
//! séquence saisie libre (numéro, enter, texte, enter), la RELECTURE après
//! la frappe — un faux port local de quelques lignes suffit.
//! Prouve : A12.

use domain::ids::PaneId;
use domain::observation::{AgentListObservation, ScreenObservation, Snapshot, UpstreamPing};
use domain::ports::{
    ControlPort, CreateTab, CreatedTab, FocusEvidence, PortFuture, PromptEvidence, ScreenRead,
    StartAgent, StartEvidence, StopEvidence, TargetedKeys, TargetedPrompt, TargetedText,
    TransportEvidence,
};
use interactions::repondre::{EtatReponse, repondre_question};
use std::sync::Mutex;

/// Le faux port : des écrans SCRIPTÉS et la capture des touches — le faux
/// client de quelques lignes que le fil exige (aucune dépendance à
/// test-support).
struct FauxPort {
    ecrans: Mutex<Vec<String>>,
    touches: Mutex<Vec<Vec<String>>>,
    textes: Mutex<Vec<String>>,
}

impl FauxPort {
    fn nouveau(ecrans: Vec<String>) -> Self {
        Self {
            ecrans: Mutex::new(ecrans),
            touches: Mutex::new(Vec::new()),
            textes: Mutex::new(Vec::new()),
        }
    }
}

impl ControlPort for FauxPort {
    fn ping(&self) -> PortFuture<'_, UpstreamPing> {
        Box::pin(async {
            Ok(UpstreamPing {
                protocol: 22,
                version: String::from("0.9.3"),
            })
        })
    }
    fn snapshot(&self) -> PortFuture<'_, Snapshot> {
        Box::pin(async { Ok(Snapshot::default()) })
    }
    fn list_agents(&self) -> PortFuture<'_, AgentListObservation> {
        Box::pin(async { Ok(AgentListObservation { agents: Vec::new() }) })
    }
    fn read_screen(&self, request: ScreenRead) -> PortFuture<'_, ScreenObservation> {
        Box::pin(async move {
            let mut ecrans = self
                .ecrans
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let texte = ecrans.first().cloned().unwrap_or_default();
            if ecrans.len() > 1 {
                ecrans.remove(0);
            }
            Ok(ScreenObservation {
                pane_id: request.pane,
                text: Some(texte),
                truncated: Some(false),
                source: None,
            })
        })
    }
    fn prompt(&self, request: TargetedPrompt) -> PortFuture<'_, PromptEvidence> {
        Box::pin(async move {
            Ok(PromptEvidence::Confirmed {
                fingerprint: request.fingerprint,
            })
        })
    }
    fn send_text(&self, request: TargetedText) -> PortFuture<'_, TransportEvidence> {
        Box::pin(async move {
            self.textes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(request.text);
            Ok(TransportEvidence {
                outcome: domain::ports::TransportOutcome::Delivered,
                partial: vec![domain::ports::PartialStep::LiteralTextWritten],
                detail: String::new(),
            })
        })
    }
    fn send_keys(&self, request: TargetedKeys) -> PortFuture<'_, TransportEvidence> {
        Box::pin(async move {
            self.touches
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(request.keys);
            Ok(TransportEvidence {
                outcome: domain::ports::TransportOutcome::Delivered,
                partial: vec![domain::ports::PartialStep::KeysSent],
                detail: String::new(),
            })
        })
    }
    fn focus(&self, _pane: PaneId) -> PortFuture<'_, FocusEvidence> {
        Box::pin(async { Ok(FocusEvidence::Focused) })
    }
    fn create_tab(&self, _request: CreateTab) -> PortFuture<'_, CreatedTab> {
        Box::pin(async {
            Ok(CreatedTab {
                tab: domain::ids::TabId::from(String::from("t")),
                pane: domain::ids::PaneId::from(String::from("p")),
            })
        })
    }
    fn start_agent(&self, _request: StartAgent) -> PortFuture<'_, StartEvidence> {
        Box::pin(async {
            Ok(StartEvidence::Started {
                pane: domain::ids::PaneId::from(String::from("p")),
            })
        })
    }
    fn stop(&self, _pane: PaneId) -> PortFuture<'_, StopEvidence> {
        Box::pin(async { Ok(StopEvidence::InterruptSent) })
    }

    fn fermer_onglet(&self, _tab: domain::ids::TabId) -> PortFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

const ECRAN_AVEC_QUESTION: &str = "Veux-tu exécuter ?\n1. Allow once\n2. Deny\nenter submit\n";

#[test]
fn rien_n_est_envoyé_hors_des_choix_offerts() {
    let port = FauxPort::nouveau(vec![ECRAN_AVEC_QUESTION.to_string()]);
    // Le 3 n'a jamais été proposé : RIEN ne part — le détail nomme les offerts.
    let reponse = repondre_question(&port, &PaneId::from(String::from("wA:p1")), 3, None)
        .unwrap_or_else(|cause| panic!("un refus est une valeur : {cause}"));
    assert!(reponse.etat == EtatReponse::Refusee, "{reponse:?}");
    assert!(
        reponse.detail.contains("only offers 1, 2") && reponse.detail.contains("nothing was sent")
    );
    // La capture : AUCUNE touche partie.
    assert!(
        port.touches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    );
    // Aucun texte partie.
    assert!(
        port.textes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    );
}

#[test]
fn pas_de_question_à_l_écran_rien_ne_part() {
    let port = FauxPort::nouveau(vec![String::from("aucune question ici")]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("wA:p1")), 1, None)
        .unwrap_or_else(|cause| panic!("un refus est une valeur : {cause}"));
    assert!(reponse.etat == EtatReponse::Refusee);
    assert!(
        reponse.detail.contains("no readable question"),
        "{reponse:?}"
    );
    assert!(
        port.touches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    );
}

#[test]
fn la_séquence_numérotée_et_la_relecture() {
    // Le port rend DEUX écrans : la question, PUIS l'agent repris (la
    // question partie) → appliquee.
    let port = FauxPort::nouveau(vec![
        ECRAN_AVEC_QUESTION.to_string(),
        String::from("l'agent travaille…"),
    ]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("wA:p1")), 1, None)
        .unwrap_or_else(|cause| panic!("un échec de port est réel : {cause}"));
    assert!(reponse.etat == EtatReponse::Appliquee, "{reponse:?}");
    assert!(reponse.detail.contains("Allow once") && reponse.detail.contains("the agent resumed"));
    // La séquence frappée : le numéro puis enter — UNE frappe groupée.
    let frappees = port
        .touches
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert!(
        frappees.len() == 1 && frappees[0] == vec!["1", "enter"],
        "le numéro puis enter : {frappees:?}"
    );
    assert!(
        port.textes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    );
}

#[test]
fn l_invite_toujours_à_l_écran_est_transmise_pas_appliquée() {
    // La relecture voit ENCORE la question : un succès de transport, pas
    // d'application — le dire est plus utile qu'afficher « envoyé ».
    let port = FauxPort::nouveau(vec![
        ECRAN_AVEC_QUESTION.to_string(),
        ECRAN_AVEC_QUESTION.to_string(),
    ]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("wA:p1")), 2, None)
        .unwrap_or_else(|cause| panic!("un échec de port est réel : {cause}"));
    assert!(reponse.etat == EtatReponse::Transmise, "{reponse:?}");
    assert!(reponse.detail.contains("still on screen"), "{reponse:?}");
}

#[test]
fn la_saisie_libre_écrit_le_texte_après_le_choix() {
    // « Type your own answer » ouvre un champ : numéro, enter, texte, enter.
    let port = FauxPort::nouveau(vec![
        ECRAN_AVEC_QUESTION.to_string(),
        String::from("l'agent travaille…"),
    ]);
    let reponse = repondre_question(
        &port,
        &PaneId::from(String::from("wA:p1")),
        1,
        Some("  le texte de l'utilisateur  "),
    )
    .unwrap_or_else(|cause| panic!("un échec de port est réel : {cause}"));
    assert!(reponse.etat == EtatReponse::Appliquee);
    let frappees = port
        .touches
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert!(frappees.len() == 2, "deux frappes : {frappees:?}");
    assert!(frappees[0] == vec!["1", "enter"], "le choix");
    assert!(frappees[1] == vec!["enter"], "la validation du champ");
    let textes = port
        .textes
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert!(
        textes.len() == 1 && textes[0] == "le texte de l'utilisateur",
        "le texte trimpé : {textes:?}"
    );
    // Un texte fait d'espaces n'écrit RIEN (valider un champ vide ferait
    // avancer l'agent sur du vent).
    let port = FauxPort::nouveau(vec![
        ECRAN_AVEC_QUESTION.to_string(),
        String::from("repris"),
    ]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("wA:p1")), 1, Some("   "))
        .unwrap_or_else(|cause| panic!("un échec de port est réel : {cause}"));
    assert!(reponse.etat == EtatReponse::Appliquee);
    assert!(
        port.textes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty(),
        "aucun texte envoyé"
    );
}

/// Les touches frappées, dans l'ordre.
fn frappees(port: &FauxPort) -> Vec<Vec<String>> {
    port.touches
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

fn touches(liste: &[&[&str]]) -> Vec<Vec<String>> {
    liste
        .iter()
        .map(|frappe| frappe.iter().map(|t| (*t).to_string()).collect())
        .collect()
}

/// Retour du 2026-10-29 : sur le sélecteur de Claude Code (et de Codex), le
/// chiffre VALIDE à lui seul. Un `enter` de plus tombait sur l'écran suivant
/// et y répondait « 1 » sans que personne l'ait choisi.
#[test]
fn le_chiffre_qui_valide_part_seul() {
    let port = FauxPort::nouveau(vec![
        crate::unit::ecran::ECRAN_CLAUDE.to_string(),
        String::from("l'agent travaille…"),
    ]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("wB:p1")), 2, None)
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert!(reponse.etat == EtatReponse::Appliquee, "{reponse:?}");
    assert_eq!(
        frappees(&port),
        touches(&[&["2"]]),
        "le chiffre, sans enter"
    );
}

/// Le danger mesuré : après le chiffre, la question SUIVANTE s'affiche (avec
/// son option 1 surlignée). Aucun `enter` ne part — sinon il y répondrait.
#[test]
fn la_question_suivante_ne_recoit_jamais_d_enter() {
    let suivante = crate::unit::ecran::ECRAN_CLAUDE.replace(
        "Which environment should I browse?",
        "Which browser should I use?",
    );
    let port = FauxPort::nouveau(vec![
        crate::unit::ecran::ECRAN_CLAUDE.to_string(),
        suivante.clone(),
        suivante,
    ]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("wB:p1")), 1, None)
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(frappees(&port), touches(&[&["1"]]));
    // La relecture voit UNE question (la suivante) : pas « appliquée » au sens
    // fort, mais rien d'autre n'est parti.
    assert!(reponse.etat == EtatReponse::Transmise, "{reponse:?}");
}

/// Une ligne à confirmation explicite (Codex) : le chiffre déplace seulement
/// le curseur. Même question, curseur sur NOTRE choix : `enter` le valide.
#[test]
fn le_curseur_sur_notre_choix_recoit_enter() {
    let avant = "Would you like to run the following command?\n› 1. Yes, proceed\n  2. No, and tell Codex what to do differently\nPress enter to confirm or esc to cancel\n";
    let selectionne = "Would you like to run the following command?\n  1. Yes, proceed\n› 2. No, and tell Codex what to do differently\nPress enter to confirm or esc to cancel\n";
    let port = FauxPort::nouveau(vec![
        avant.to_string(),
        selectionne.to_string(),
        String::from("l'agent travaille…"),
    ]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("w1:p1")), 2, None)
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert!(reponse.etat == EtatReponse::Appliquee, "{reponse:?}");
    assert_eq!(frappees(&port), touches(&[&["2"], &["enter"]]));
}

/// Le curseur n'est pas allé sur notre choix : rien ne valide à notre place.
#[test]
fn le_curseur_ailleurs_ne_recoit_rien() {
    let ecran = "Would you like to run the following command?\n› 1. Yes, proceed\n  2. No\nPress enter to confirm or esc to cancel\n";
    let port = FauxPort::nouveau(vec![ecran.to_string()]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("w1:p1")), 2, None)
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert!(reponse.etat == EtatReponse::Transmise, "{reponse:?}");
    assert_eq!(frappees(&port), touches(&[&["2"]]), "jamais d'enter");
}

/// La saisie libre de Claude : le chiffre place le curseur dans le champ,
/// puis le texte, puis `enter` — et sans texte, rien ne part.
#[test]
fn la_saisie_libre_de_claude_est_chiffre_texte_enter() {
    let champ = crate::unit::ecran::ECRAN_CLAUDE
        .replace("❯ 1. Production", "  1. Production")
        .replace("  3. Type something.", "❯ 3. Type something.");
    let port = FauxPort::nouveau(vec![
        crate::unit::ecran::ECRAN_CLAUDE.to_string(),
        champ,
        String::from("l'agent travaille…"),
    ]);
    let reponse = repondre_question(
        &port,
        &PaneId::from(String::from("wB:p1")),
        3,
        Some("staging, please"),
    )
    .unwrap_or_else(|cause| panic!("{cause}"));
    assert!(reponse.etat == EtatReponse::Appliquee, "{reponse:?}");
    assert_eq!(frappees(&port), touches(&[&["3"], &["enter"]]));
    let textes = port
        .textes
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert_eq!(textes, vec![String::from("staging, please")]);

    let vide = FauxPort::nouveau(vec![crate::unit::ecran::ECRAN_CLAUDE.to_string()]);
    let refus = repondre_question(&vide, &PaneId::from(String::from("wB:p1")), 3, Some("  "))
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert!(refus.etat == EtatReponse::Refusee, "{refus:?}");
    assert!(frappees(&vide).is_empty(), "rien ne part sans texte");
}

/// pi : aucun chiffre — le curseur descend pas à pas (`j`), l'écran est relu
/// à chaque pas, et `enter` ne part que le curseur sur NOTRE choix.
#[test]
fn pi_le_curseur_est_amene_puis_valide() {
    use crate::unit::ecran::ecran_pi;
    let port = FauxPort::nouveau(vec![
        ecran_pi(0),
        ecran_pi(1),
        ecran_pi(2),
        String::from("l'agent travaille…"),
    ]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("w9:p1")), 3, None)
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert!(reponse.etat == EtatReponse::Appliquee, "{reponse:?}");
    let textes = port
        .textes
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert_eq!(textes, vec![String::from("j"), String::from("j")]);
    assert_eq!(frappees(&port), touches(&[&["enter"]]));
}

/// Le curseur ne bouge pas : `enter` ne part jamais.
#[test]
fn pi_curseur_bloque_rien_ne_valide() {
    use crate::unit::ecran::ecran_pi;
    let port = FauxPort::nouveau(vec![ecran_pi(0)]);
    let reponse = repondre_question(&port, &PaneId::from(String::from("w9:p1")), 2, None)
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert!(reponse.etat == EtatReponse::Transmise, "{reponse:?}");
    assert!(frappees(&port).is_empty(), "jamais d'enter");
}
