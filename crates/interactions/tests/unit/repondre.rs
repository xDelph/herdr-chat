//! Le répondant (T032) : rien n'est envoyé hors des choix offerts, la
//! séquence saisie libre (numéro, enter, texte, enter), la RELECTURE après
//! la frappe — un faux port local de quelques lignes suffit.

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
