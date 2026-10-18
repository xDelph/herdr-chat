//! Ports étroits : preuves partielles, unions d'états, disponibilité dyn.

use domain::errors::PortError;
use domain::ids::{DeliveryFingerprint, PaneId, SessionId};
use domain::observation::UpstreamPing;
use domain::ports::{
    ControlPort, FocusEvidence, PartialStep, PortFuture, PromptEvidence, SessionPort,
    StartEvidence, StopEvidence, TransportOutcome,
};
use domain::session::{
    ResolvedSource, SessionHint, SessionMetadata, SessionPageOutcome, SessionPageRequest,
    SourceKind,
};
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll, Waker};

#[test]
fn les_etapes_partielles_passent_par_le_filière_entrant() {
    match serde_json::to_string(&PartialStep::LiteralTextWritten) {
        Ok(encodé) => assert_eq!(encodé, "\"literalTextWritten\""),
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
    match serde_json::to_string(&PartialStep::EnterSequenceSent) {
        Ok(encodé) => assert_eq!(encodé, "\"enterSequenceSent\""),
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
}

#[test]
fn un_prompt_ne_dit_confirme_qu_avec_la_preuve_du_serveur() {
    let empreinte = DeliveryFingerprint::from("fp-1".to_string());
    let écoulement: [PromptEvidence; 4] = [
        PromptEvidence::Confirmed {
            fingerprint: empreinte.clone(),
        },
        PromptEvidence::Unknown {
            partial: vec![PartialStep::LiteralTextWritten],
            detail: "l'écriture est pure, pas l'amour".to_string(),
        },
        PromptEvidence::Suppressed {
            reason: "déjà envoyé sous fp-1".to_string(),
        },
        PromptEvidence::Failed {
            detail: "Herdr a refusé le wait".to_string(),
        },
    ];
    let mut vues = 0_u32;
    for evidence in écoulement {
        match evidence {
            PromptEvidence::Confirmed { fingerprint } => {
                assert_eq!(fingerprint, empreinte);
                vues += 1;
            }
            PromptEvidence::Unknown { partial, detail } => {
                // B05 : texte écrit puis confirmation manquée — l'étape
                // réellement accomplie reste visible.
                assert_eq!(partial, vec![PartialStep::LiteralTextWritten]);
                assert!(!detail.is_empty());
                vues += 1;
            }
            PromptEvidence::Suppressed { reason } => {
                assert!(!reason.is_empty());
                vues += 1;
            }
            PromptEvidence::Failed { detail } => {
                assert!(!detail.is_empty());
                vues += 1;
            }
        }
    }
    assert_eq!(vues, 4_u32);
}

#[test]
fn un_transport_dit_delivered_unknown_ou_refuse_rien_entre() {
    let effeuts: [TransportOutcome; 3] = [
        TransportOutcome::Delivered,
        TransportOutcome::Unknown,
        TransportOutcome::Refused,
    ];
    for effeuillé in effeuts {
        match effeuillé {
            TransportOutcome::Delivered => (),
            TransportOutcome::Unknown => (),
            TransportOutcome::Refused => (),
        }
    }
}

#[test]
fn un_stop_un_focus_et_un_start_sont_unions_exhaustives() {
    let stop = StopEvidence::InterruptSent;
    match stop {
        StopEvidence::InterruptSent => (),
        autre => panic!("l'interruption s'est transfigurée : {autre:?}"),
    }

    let focus = FocusEvidence::Refused {
        detail: "pane absent".to_string(),
    };
    match focus {
        FocusEvidence::Refused { detail } => assert_eq!(detail, "pane absent"),
        FocusEvidence::Focused => panic!("un refus s'affiche succès"),
    }

    let démarrages: [StartEvidence; 3] = [
        StartEvidence::Started {
            pane: PaneId::from("wA:p9".to_string()),
        },
        StartEvidence::ShellNotReady {
            detail: "90 s".to_string(),
        },
        StartEvidence::Failed {
            detail: "refus".to_string(),
        },
    ];
    for démarrage in démarrages {
        match démarrage {
            StartEvidence::Started { .. }
            | StartEvidence::ShellNotReady { .. }
            | StartEvidence::Failed { .. } => (),
        }
    }
}

/// Un port de session simulé : tout se prononce immédiatement.
struct ResolveurSimulé;

impl SessionPort for ResolveurSimulé {
    fn resolve(&self, _hint: SessionHint) -> PortFuture<'_, Option<ResolvedSource>> {
        Box::pin(async { Ok(None) })
    }
    fn page(&self, _request: SessionPageRequest) -> PortFuture<'_, SessionPageOutcome> {
        Box::pin(async { Ok(SessionPageOutcome::Vide) })
    }
    fn metadata(&self, _source: ResolvedSource) -> PortFuture<'_, SessionMetadata> {
        Box::pin(async { Ok(SessionMetadata::default()) })
    }
}

/// Un port de contrôle simulé, utilisé comme `dyn` — la compat objet est une
/// exigence réelle : l'application tient ces ports par trait object.
struct ContrôleSimulé;

impl ControlPort for ContrôleSimulé {
    fn ping(&self) -> PortFuture<'_, UpstreamPing> {
        Box::pin(async {
            Ok(UpstreamPing {
                protocol: 22,
                version: "0.9.3".to_string(),
            })
        })
    }
    fn snapshot(&self) -> PortFuture<'_, domain::observation::Snapshot> {
        Box::pin(async { Ok(domain::observation::Snapshot::default()) })
    }
    fn list_agents(&self) -> PortFuture<'_, domain::observation::AgentListObservation> {
        Box::pin(async { Ok(domain::observation::AgentListObservation { agents: Vec::new() }) })
    }
    fn read_screen(
        &self,
        _request: domain::ports::ScreenRead,
    ) -> PortFuture<'_, domain::observation::ScreenObservation> {
        Box::pin(async {
            Ok(domain::observation::ScreenObservation {
                pane_id: PaneId::from("wA:p7".to_string()),
                text: None,
                truncated: None,
                source: None,
            })
        })
    }
    fn prompt(&self, _request: domain::ports::TargetedPrompt) -> PortFuture<'_, PromptEvidence> {
        Box::pin(async {
            Ok(PromptEvidence::Failed {
                detail: "simulé".to_string(),
            })
        })
    }
    fn send_text(
        &self,
        _request: domain::ports::TargetedText,
    ) -> PortFuture<'_, domain::ports::TransportEvidence> {
        Box::pin(async {
            Ok(domain::ports::TransportEvidence {
                outcome: TransportOutcome::Unknown,
                partial: Vec::new(),
                detail: "sans preuve".to_string(),
            })
        })
    }
    fn send_keys(
        &self,
        _request: domain::ports::TargetedKeys,
    ) -> PortFuture<'_, domain::ports::TransportEvidence> {
        Box::pin(async {
            Ok(domain::ports::TransportEvidence {
                outcome: TransportOutcome::Refused,
                partial: Vec::new(),
                detail: "refusé".to_string(),
            })
        })
    }
    fn focus(&self, _pane: PaneId) -> PortFuture<'_, FocusEvidence> {
        Box::pin(async { Ok(FocusEvidence::Focused) })
    }
    fn create_tab(
        &self,
        _request: domain::ports::CreateTab,
    ) -> PortFuture<'_, domain::ports::CreatedTab> {
        Box::pin(async {
            Ok(domain::ports::CreatedTab {
                tab: domain::ids::TabId::from("t2".to_string()),
                pane: PaneId::from("wA:p2".to_string()),
            })
        })
    }
    fn start_agent(&self, _request: domain::ports::StartAgent) -> PortFuture<'_, StartEvidence> {
        Box::pin(async {
            Ok(StartEvidence::Started {
                pane: PaneId::from("wA:p2".to_string()),
            })
        })
    }
    fn stop(&self, _pane: PaneId) -> PortFuture<'_, StopEvidence> {
        Box::pin(async { Ok(StopEvidence::NotRunning) })
    }

    fn fermer_onglet(&self, _tab: domain::ids::TabId) -> PortFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

fn task_context() -> Context<'static> {
    Context::from_waker(Waker::noop())
}

fn écoule<'a, T>(fut: &mut Pin<Box<dyn Future<Output = T> + Send + 'a>>) -> Poll<T> {
    // Les ports rendent des futures en Pin<Box> ; la lecture native du std
    // suffit : aucune dépendance d'exécution pour T005. La durée de vie du
    // fut dans la boîte est celle de son port — vérifiée au premier poll.
    fut.as_mut().poll(&mut task_context())
}

#[test]
fn une_page_simulee_est_lue_à_la_poll_sans_exécuteur() {
    let simulation = ResolveurSimulé;
    let requête = SessionPageRequest {
        source: ResolvedSource {
            kind: SourceKind::File,
            base: "/sessions/pi/wx.jsonl".to_string(),
            session_id: Some(SessionId::from("01a".to_string())),
            family: None,
        },
        cursor: None,
        previous_cursor: None,
        limit: 12,
    };
    let mut fut = simulation.page(requête);
    match écoule(&mut fut) {
        Poll::Ready(Ok(SessionPageOutcome::Vide)) => (),
        Poll::Ready(Ok(autre)) => panic!("clausule tenue autre chose : {autre:?}"),
        Poll::Ready(Err(panne)) => panic!("une page simulée a échoué : {panne}"),
        Poll::Pending => panic!("un port simulé n'a rien grand-chose à attendre"),
    }
}

#[test]
fn le_port_de_contrat_tient_comme_trait_object_et_se_prononce() {
    let port: Box<dyn ControlPort> = Box::new(ContrôleSimulé);
    let mut ping = port.ping();
    // Pin<Box<dyn Future>> est Future + Unpin : une lecture directe sans
    // exécuteur ni runtime (la barre est le std, T005 n'en a aucun autre).
    match Pin::new(&mut ping).poll(&mut task_context()) {
        Poll::Ready(Ok(santé)) => {
            assert_eq!(santé.protocol, 22_u64);
            assert_eq!(santé.version, "0.9.3");
        }
        Poll::Ready(Err(panne)) => panic!("une santé simulée a échoué : {panne}"),
        Poll::Pending => panic!("rien à attendre ici"),
    }
}

#[test]
fn un_port_negatif_repond_a_l_erreur_pas_a_une_valeur_devinee() {
    let mut échec = Box::pin(async {
        let panne_déclarée = PortError::Unsupported {
            feature: "attend".to_string(),
        };
        Result::<UpstreamPing, PortError>::Err(panne_déclarée)
    });
    match échec.as_mut().poll(&mut task_context()) {
        Poll::Ready(Ok(valeur)) => panic!("deviné, pas refusé : {valeur:?}"),
        Poll::Ready(Err(PortError::Unsupported { feature })) => {
            assert_eq!(feature, "attend")
        }
        Poll::Ready(Err(autre)) => panic!("nature perdue : {autre:?}"),
        Poll::Pending => panic!("rien à attendre"),
    }
}
