//! Le moteur (T033/C03/C17) : une confirmation à la MAUVAISE empreinte n'est
//! pas une confirmation ; les cinq cas du fil donnent aucun faux succès.

use domain::ids::{DeliveryFingerprint, PaneId};
use domain::observation::{AgentListObservation, ScreenObservation, Snapshot, UpstreamPing};
use domain::ports::{
    ControlPort, CreateTab, CreatedTab, FocusEvidence, PortFuture, PromptEvidence, ScreenRead,
    StartAgent, StartEvidence, StopEvidence, TargetedKeys, TargetedPrompt, TargetedText,
    TransportEvidence,
};
use interactions::engine::{preuve_reconnue, question_a_change, soumet_prompt};
use std::sync::Mutex;

/// Le faux port qui RÉPOND l'empreinte qu'on lui programme — le seul
/// comportement paramétré de ce cahier.
struct FauxPort {
    empreinte_repondue: Mutex<Option<String>>,
    ecran_repondu: Mutex<String>,
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
            Ok(ScreenObservation {
                pane_id: request.pane,
                text: Some(
                    self.ecran_repondu
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .clone(),
                ),
                truncated: Some(false),
                source: None,
            })
        })
    }
    fn prompt(&self, request: TargetedPrompt) -> PortFuture<'_, PromptEvidence> {
        Box::pin(async move {
            let empreinte = self
                .empreinte_repondue
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
                .unwrap_or_else(|| request.fingerprint.as_str().to_string());
            Ok(PromptEvidence::Confirmed {
                fingerprint: DeliveryFingerprint::from(empreinte),
            })
        })
    }
    fn send_text(&self, _request: TargetedText) -> PortFuture<'_, TransportEvidence> {
        Box::pin(async {
            Ok(TransportEvidence {
                outcome: domain::ports::TransportOutcome::Delivered,
                partial: vec![domain::ports::PartialStep::LiteralTextWritten],
                detail: String::new(),
            })
        })
    }
    fn send_keys(&self, _request: TargetedKeys) -> PortFuture<'_, TransportEvidence> {
        Box::pin(async {
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
}

#[test]
fn une_confirmation_à_la_mauvaise_empreinte_est_un_inconnu() {
    // C03 : la preuve ne reconnaît que SON empreinte.
    let demandee = DeliveryFingerprint::from(String::from("empreinte-a"));
    let preuve = PromptEvidence::Confirmed {
        fingerprint: DeliveryFingerprint::from(String::from("empreinte-b")),
    };
    match preuve_reconnue(&demandee, &preuve) {
        Some(PromptEvidence::Unknown { detail, .. }) => {
            assert!(
                detail.contains("empreinte-b") && detail.contains("empreinte-a"),
                "{detail}"
            );
        }
        autre => panic!("une autre empreinte se rapporte en inconnu : {autre:?}"),
    }
    // La BONNE empreinte : valide.
    assert!(
        preuve_reconnue(
            &demandee,
            &PromptEvidence::Confirmed {
                fingerprint: demandee.clone()
            }
        )
        .is_none()
    );
    // Les états honnêtes passent tels quels (rien à corriger).
    assert!(
        preuve_reconnue(
            &demandee,
            &PromptEvidence::Failed {
                detail: String::from("x")
            }
        )
        .is_none()
    );
}

#[test]
fn la_nouvelle_question_après_frappe_n_atteste_rien() {
    // C17 : une question DIFFÉRENTE après la frappe — la frappe a visé autre
    // chose ; on ne dit PAS appliquée.
    let avant = "Veux-tu exécuter ?\n1. Allow once\n2. Deny\nenter submit\n";
    let nouvelle = "Le port est-il fiable ?\n1. Allow once\n2. Deny\nenter submit\n";
    assert!(
        question_a_change(avant, nouvelle),
        "une nouvelle question = un changement"
    );
    // La MÊME question : pas un changement.
    assert!(!question_a_change(avant, avant));
    // La question PARTIE : le succès attendu — pas un changement.
    assert!(!question_a_change(avant, "l'agent travaille…"));
    // La SÉLECTION déplacée (le › a bougé — Claude, mesuré) : un changement.
    let deplacee = "Veux-tu exécuter ?\n1. Allow once\n›2. Deny\nenter submit\n";
    assert!(
        question_a_change(
            avant,
            deplacee.replace("1. Allow once", "›1. Allow once").as_str()
        ) || question_a_change(avant, deplacee),
        "une sélection déplacée = un changement"
    );
}

#[test]
fn le_moteur_du_prompt_rapporte_l_identité_reconnue() {
    let port = FauxPort {
        empreinte_repondue: Mutex::new(Some(String::from("empreinte-portee"))),
        ecran_repondu: Mutex::new(String::new()),
    };
    let demande = TargetedPrompt {
        pane: PaneId::from(String::from("wA:p1")),
        literal_text: String::from("le texte"),
        fingerprint: DeliveryFingerprint::from(String::from("empreinte-demandee")),
    };
    let rendu = soumet_prompt(&port, demande)
        .unwrap_or_else(|cause| panic!("un échec de port est réel : {cause}"));
    match rendu {
        PromptEvidence::Unknown { detail, .. } => {
            assert!(
                detail.contains("pas celle demandée"),
                "le faux succès se rapporte en inconnu : {detail}"
            );
        }
        autre => panic!("une confirmation étrangère n'est jamais un succès : {autre:?}"),
    }
    // Le port qui répond l'EMPREINTE DEMANDÉE : un succès reconnu.
    let port = FauxPort {
        empreinte_repondue: Mutex::new(Some(String::from("empreinte-demandee"))),
        ecran_repondu: Mutex::new(String::new()),
    };
    let demande = TargetedPrompt {
        pane: PaneId::from(String::from("wA:p1")),
        literal_text: String::from("le texte"),
        fingerprint: DeliveryFingerprint::from(String::from("empreinte-demandee")),
    };
    match soumet_prompt(&port, demande)
        .unwrap_or_else(|cause| panic!("un échec de port est réel : {cause}"))
    {
        PromptEvidence::Confirmed { fingerprint } => {
            assert!(fingerprint.as_str() == "empreinte-demandee");
        }
        autre => panic!("la bonne empreinte est un succès : {autre:?}"),
    }
}

#[test]
fn l_agent_sorti_ne_donne_aucun_succès() {
    // La question périmée : l'agent est SORTI (l'écran vide) — la relecture
    // le voit ; la frappe partie reste partie.
    let port = FauxPort {
        empreinte_repondue: Mutex::new(None),
        ecran_repondu: Mutex::new(String::from("")),
    };
    let avant = "Veux-tu exécuter ?\n1. Allow once\n2. Deny\nenter submit\n";
    match interactions::engine::relit_apres_frappe(
        &port,
        &PaneId::from(String::from("wA:p1")),
        avant,
    )
    .unwrap_or_else(|cause| panic!("un échec de port est réel : {cause}"))
    {
        // L'écran est vide : la question est partie (pas de changement) —
        // le moteur rend None (le success du fait observé).
        None => (),
        autre => panic!("l'agent sorti = la question partie : {autre:?}"),
    }
}
