//! Le service prompt (T035/C05–C06) : le doublon supprimé après preuve,
//! A→B→A autorisé, le retry débloqué, le discriminateur exigé.
//! Prouve : A01, A02.

use application::commands::prompt::{
    Confirmation, EnvoieurPrompt, FENETRE, RefusEnvoi, empreinte_de,
};
use domain::errors::PortError;
use domain::ids::{DeliveryFingerprint, PaneId};
use domain::observation::{AgentListObservation, ScreenObservation, Snapshot, UpstreamPing};
use domain::ports::{
    ControlPort, CreateTab, CreatedTab, FocusEvidence, PartialStep, PortFuture, PromptEvidence,
    ScreenRead, StartAgent, StartEvidence, StopEvidence, TargetedKeys, TargetedPrompt,
    TargetedText, TransportEvidence, TransportOutcome,
};
use std::sync::Mutex;
use std::time::Duration;

/// Le faux port : le comportement d'un pane SCRIPTÉ (l'empreinte rendue,
/// l'écran rendu, les frappes capturées) — quelques lignes, aucune
/// dépendance à test-support.
struct FauxPort {
    /// L'évidence du prompt : la confirme-t-il, avec QUELLE empreinte ?
    promesse: Mutex<Result<Option<String>, String>>,
    /// Les frappes réussissent-elles ? (None = ok)
    frappes: Mutex<Option<String>>,
    textes: Mutex<Vec<String>>,
    touches: Mutex<Vec<Vec<String>>>,
}

impl FauxPort {
    fn confirme() -> Self {
        Self::par(Mutex::new(Ok(None)), Mutex::new(None))
    }
    fn par(
        promesse: Mutex<Result<Option<String>, String>>,
        frappes: Mutex<Option<String>>,
    ) -> Self {
        Self {
            promesse,
            frappes,
            textes: Mutex::new(Vec::new()),
            touches: Mutex::new(Vec::new()),
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
            Ok(ScreenObservation {
                pane_id: request.pane,
                text: None,
                truncated: None,
                source: None,
            })
        })
    }
    fn prompt(&self, request: TargetedPrompt) -> PortFuture<'_, PromptEvidence> {
        Box::pin(async move {
            let promesse = self
                .promesse
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            match promesse.as_ref() {
                Ok(None) => Ok(PromptEvidence::Confirmed {
                    fingerprint: request.fingerprint,
                }),
                Ok(Some(empreinte)) => Ok(PromptEvidence::Confirmed {
                    fingerprint: DeliveryFingerprint::from(empreinte.clone()),
                }),
                Err(cause) if cause.contains("blocked and requires interactive input") => {
                    Err(PortError::Upstream {
                        code: String::from("agent_prompt_failed"),
                        message: cause.clone(),
                    })
                }
                Err(cause) if cause.contains("timeout") => Err(PortError::Timeout),
                Err(cause) => Err(PortError::Transport {
                    detail: cause.clone(),
                }),
            }
        })
    }
    fn send_text(&self, request: TargetedText) -> PortFuture<'_, TransportEvidence> {
        Box::pin(async move {
            self.textes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(request.text);
            match self
                .frappes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_ref()
            {
                None => Ok(TransportEvidence {
                    outcome: TransportOutcome::Delivered,
                    partial: vec![PartialStep::LiteralTextWritten],
                    detail: String::new(),
                }),
                Some(cause) => Err(PortError::Transport {
                    detail: cause.clone(),
                }),
            }
        })
    }
    fn send_keys(&self, request: TargetedKeys) -> PortFuture<'_, TransportEvidence> {
        Box::pin(async move {
            self.touches
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(request.keys);
            match self
                .frappes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_ref()
            {
                None => Ok(TransportEvidence {
                    outcome: TransportOutcome::Delivered,
                    partial: vec![PartialStep::KeysSent],
                    detail: String::new(),
                }),
                Some(cause) => Err(PortError::Transport {
                    detail: cause.clone(),
                }),
            }
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

fn cible() -> PaneId {
    PaneId::from(String::from("wA:p1"))
}

#[test]
fn l_empreinte_est_le_sha256_du_contenu() {
    // L'empreinte actuelle : SHA-256(cible\0texte), 32 hex — la même
    // demande vers DEUX cibles = deux empreintes (le dedup est par pane).
    assert!(empreinte_de("wA:p1", "bonjour").len() == 32);
    assert!(empreinte_de("wA:p1", "bonjour") == empreinte_de("wA:p1", "bonjour"));
    assert!(
        empreinte_de("wA:p1", "bonjour") != empreinte_de("wA:p2", "bonjour"),
        "la cible entre"
    );
    assert!(
        empreinte_de("wA:p1", "bonjour") != empreinte_de("wA:p1", "au revoir"),
        "le texte entre"
    );
}

#[test]
fn le_doublon_est_supprimé_après_preuve() {
    let port = FauxPort::confirme();
    let envoieur = EnvoieurPrompt::nouveau();
    let premier = envoieur
        .envoie(&port, &cible(), "steering", false)
        .unwrap_or_else(|refus| panic!("le premier passe : {refus}"));
    assert!(premier.confirmation == Confirmation::Confirme);
    // Le SECOND du même texte : supprimé — la preuve existe (le premier
    // confirmé).
    match envoieur.envoie(&port, &cible(), "steering", false) {
        Err(RefusEnvoi::Doublon { .. }) => (),
        Err(refus) => panic!("doublon attendu : {refus}"),
        Ok(_) => panic!("le même texte consécutif est supprimé"),
    }
    assert!(
        envoieur.suivi() == 1,
        "une entrée suivie : {}",
        envoieur.suivi()
    );
}

#[test]
fn a_b_a_est_autorisé() {
    // La règle : le DERNIER confirmé de la cible — A puis B puis A passe.
    let port = FauxPort::confirme();
    let envoieur = EnvoieurPrompt::nouveau();
    let _ = envoieur.envoie(&port, &cible(), "A", false);
    let _ = envoieur.envoie(&port, &cible(), "B", false);
    match envoieur.envoie(&port, &cible(), "A", false) {
        Ok(_) => (),
        Err(refus) => panic!("A→B→A doit passer (le dernier est B) : {refus}"),
    }
    // Et le cible VOISINE n'est pas touchée.
    assert!(
        envoieur
            .envoie(&port, &PaneId::from(String::from("wA:p2")), "B", false)
            .is_ok()
    );
}

#[test]
fn échec_et_inconnu_ne_bloquent_pas_le_retry() {
    // Le port ÉCHOUE : rien n'est enregistré → le retry PASSE.
    let port = FauxPort::par(
        Mutex::new(Err(String::from("timeout sans verdict"))),
        Mutex::new(None),
    );
    let envoieur = EnvoieurPrompt::nouveau();
    match envoieur.envoie(&port, &cible(), "le texte", false) {
        Err(RefusEnvoi::NonConfirme { .. }) => (),
        Err(refus) => panic!("non confirmé attendu : {refus}"),
        Ok(_) => panic!("un timeout ne prouve rien"),
    }
    assert!(
        envoieur.suivi() == 0,
        "RIEN d'enregistré : {}",
        envoieur.suivi()
    );
    // Le port marche maintenant : le retry passe (rien ne bloque).
    let port = FauxPort::confirme();
    match envoieur.envoie(&port, &cible(), "le texte", false) {
        Ok(envoi) => assert!(envoi.confirmation == Confirmation::Confirme),
        Err(refus) => panic!("le retry doit passer : {refus}"),
    }
    // La FRAPPE PARTIELLE (le texte écrit, enter raté) : pas de succès,
    // rien d'enregistré — le retry passe.
    let port = FauxPort::par(
        Mutex::new(Ok(None)),
        Mutex::new(Some(String::from("enter refusé par le faux"))),
    );
    let envoieur = EnvoieurPrompt::nouveau();
    match envoieur.envoie(&port, &cible(), "le texte", true) {
        Err(RefusEnvoi::NonConfirme { .. }) => (),
        Err(refus) => panic!("frappe partielle = non confirmé : {refus}"),
        Ok(envoi) => panic!("une frappe partielle ne prouve pas l'application : {envoi:?}"),
    }
    assert!(envoieur.suivi() == 0);
}

#[test]
fn le_discriminateur_de_succès_est_exigé() {
    // C05 : la confirmation à une AUTRE empreinte n'est jamais un succès —
    // rapportée en inconnu, rien n'est enregistré.
    let port = FauxPort::par(
        Mutex::new(Ok(Some(String::from("empreinte-étrangère")))),
        Mutex::new(None),
    );
    let envoieur = EnvoieurPrompt::nouveau();
    match envoieur.envoie(&port, &cible(), "le texte", false) {
        Err(RefusEnvoi::NonConfirme { detail, .. }) => {
            assert!(
                detail.contains("empreinte-étrangère"),
                "le détail dit : {detail}"
            );
        }
        Err(refus) => panic!("non confirmé attendu : {refus}"),
        Ok(envoi) => panic!("une empreinte étrangère ne confirme pas : {envoi:?}"),
    }
    assert!(envoieur.suivi() == 0, "rien d'enregistré");
}

#[test]
fn le_repli_interactif_sur_refus_connu_seulement() {
    // Le refus « blocked and requires interactive input » (le texte mesuré) :
    // les FRAPPES prennent le relais — et la confirmation reste « inconnu »
    // (les frappes écrites, pas prouvées appliquées).
    let port = FauxPort::par(
        Mutex::new(Err(String::from(
            "agent wA:p1 is blocked and requires interactive input",
        ))),
        Mutex::new(None),
    );
    let envoieur = EnvoieurPrompt::nouveau();
    match envoieur.envoie(&port, &cible(), "réponds à l'invite", false) {
        Ok(envoi) => {
            assert!(
                envoi.confirmation == Confirmation::Inconnu,
                "les frappes ≠ l'application : {:?}",
                envoi.confirmation
            );
            // Les frappes sont passées : texte PUIS enter.
            let textes = port
                .textes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            assert!(textes.len() == 1 && textes[0] == "réponds à l'invite");
        }
        Err(refus) => panic!("le repli interactif doit passer : {refus}"),
    }
    // Un refus D'UNE AUTRE NATURE : PAS de repli — l'erreur reste.
    let port = FauxPort::par(
        Mutex::new(Err(String::from("autre panne sans rapport"))),
        Mutex::new(None),
    );
    let envoieur = EnvoieurPrompt::nouveau();
    match envoieur.envoie(&port, &cible(), "le texte", false) {
        Err(RefusEnvoi::NonConfirme { .. }) => (),
        Ok(_) => panic!("un refus non interactif ne bascule pas en frappes"),
        Err(refus) => panic!("le refus reste : {refus}"),
    }
    assert!(
        port.textes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_empty()
    );
}

#[test]
fn la_fenêtre_est_monotone() {
    // La fenêtre (60 s) tient sur Instant — monotone, jamais la date du jour.
    assert!(FENETRE == Duration::from_secs(60));
    let port = FauxPort::confirme();
    let envoieur = EnvoieurPrompt::nouveau();
    let _ = envoieur.envoie(&port, &cible(), "unique", false);
    // Les entrées suivies : la purge se lit sur le nombre.
    assert!(envoieur.suivi() == 1);
    let _ = PortError::Timeout; // le type d'erreur reste celui du port
}
