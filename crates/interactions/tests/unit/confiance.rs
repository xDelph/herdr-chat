//! L'invite de confiance (T037) : la phrase mesurée se reconnaît, un autre
//! dialogue non — et la détection ne répond jamais.
//! Prouve : A09, A10.

use interactions::confiance::est_invite_confiance;

#[test]
fn la_phrase_mesuree_se_reconnait() {
    // La forme exacte relevée sur un pane réel (codex, dossier non approuvé).
    let ecran = "Trust this folder?\n\nFolder settings can run code automatically, even without a model request.\n1. Yes, I trust this folder\n2. No, exit\n";
    assert!(est_invite_confiance(ecran), "l'invite est à l'écran");
}

#[test]
fn la_phrase_est_insensible_a_la_casse() {
    assert!(
        est_invite_confiance("Please TRUST THIS FOLDER before continuing."),
        "la casse ne change pas le sens"
    );
    assert!(
        est_invite_confiance("trust this directory"),
        "le second marqueur mesuré passe"
    );
}

#[test]
fn un_autre_dialogue_n_est_pas_une_invite_de_confiance() {
    // Un agent bloqué sur n'importe quelle AUTRE question : pas de confiance.
    for ecran in [
        "Do you want to execute this code?\n1. Allow once\n2. Deny\n",
        "blocked and requires interactive input",
        "",
        "Trust this terminal?",
        "folder",
    ] {
        assert!(
            !est_invite_confiance(ecran),
            "«{ecran}» ne nomme pas l'invite de confiance"
        );
    }
}

#[test]
fn la_detection_ne_repond_jamais() {
    // Le contrat de ce module : il ne produit que la décision — aucune
    // touche, aucune réponse ne peut sortir d'ici (pas de fonction d'envoi).
    assert!(
        est_invite_confiance("Trust this folder?"),
        "la détection rend une valeur, rien d'autre"
    );
}

// ---------------------------------------------------------------------------
// Le répondeur (T051) : les touches par famille MESURÉE, la relecture, et la
// preuve en deux temps (invite disparue ET agent vivant).
// ---------------------------------------------------------------------------

use domain::ids::{PaneId, TabId};
use domain::observation::{AgentListObservation, ScreenObservation, Snapshot, UpstreamPing};
use domain::ports::{
    ControlPort, CreateTab, CreatedTab, FocusEvidence, PortFuture, PromptEvidence, ScreenRead,
    StartAgent, StartEvidence, StopEvidence, TargetedKeys, TargetedPrompt, TargetedText,
    TransportEvidence,
};
use interactions::confiance::{EtatConfiance, repondre_confiance, touches_de_confiance};
use std::sync::Mutex;

/// Un faux port local : écrans scriptés, capture des touches, et un agent
/// qui peut disparaître entre la frappe et la preuve.
struct FauxPort {
    ecrans: Mutex<Vec<String>>,
    touches: Mutex<Vec<Vec<String>>>,
    vivant: Mutex<bool>,
}

impl FauxPort {
    fn nouveau(ecrans: Vec<&str>) -> Self {
        Self {
            ecrans: Mutex::new(ecrans.into_iter().map(String::from).collect()),
            touches: Mutex::new(Vec::new()),
            vivant: Mutex::new(true),
        }
    }

    fn sans_agent(self) -> Self {
        *self
            .vivant
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = false;
        self
    }

    fn touches(&self) -> Vec<Vec<String>> {
        self.touches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
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
        Box::pin(async {
            let vivant = *self
                .vivant
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            // La liste ne porte qu'un fait : l'agent du pane est-il encore
            // là ? Un agent minimal suffit — le répondeur ne lit que l'id.
            let agents = if vivant {
                vec![domain::observation::AgentObservation {
                    pane_id: PaneId::from(String::from("wA:p1")),
                    tab_id: TabId::from(String::from("wA:t1")),
                    workspace_id: domain::ids::WorkspaceId::from(String::from("wA")),
                    terminal_id: String::from("term"),
                    revision: 1,
                    status: domain::status::AgentStatus::Blocked,
                    focused: false,
                    agent: Some(domain::ids::AgentKind::from(String::from("claude"))),
                    name: None,
                    terminal_title: None,
                    cwd: None,
                    foreground_cwd: None,
                    completion_seq: None,
                    state_change_seq: None,
                    session: None,
                }]
            } else {
                Vec::new()
            };
            Ok(AgentListObservation { agents })
        })
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
    fn send_text(&self, _request: TargetedText) -> PortFuture<'_, TransportEvidence> {
        Box::pin(async {
            Ok(TransportEvidence {
                outcome: domain::ports::TransportOutcome::Delivered,
                partial: Vec::new(),
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
                tab: TabId::from(String::from("t")),
                pane: PaneId::from(String::from("p")),
            })
        })
    }
    fn start_agent(&self, _request: StartAgent) -> PortFuture<'_, StartEvidence> {
        Box::pin(async {
            Ok(StartEvidence::Started {
                pane: PaneId::from(String::from("p")),
            })
        })
    }
    fn stop(&self, _pane: PaneId) -> PortFuture<'_, StopEvidence> {
        Box::pin(async { Ok(StopEvidence::InterruptSent) })
    }
    fn fermer_onglet(&self, _tab: TabId) -> PortFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
}

const INVITE: &str = "Trust this folder?\n1. Yes, I trust this folder\n2. No, exit\n";
const APRES: &str = "$ pret\n";

#[test]
fn les_touches_viennent_de_la_famille_mesuree() {
    // claude : une SÉLECTION (descendre puis valider) ; refuser = valider
    // l'option déjà surlignée.
    assert_eq!(
        touches_de_confiance(Some("claude"), true),
        Some(vec![String::from("down"), String::from("enter")])
    );
    assert_eq!(
        touches_de_confiance(Some("claude"), false),
        Some(vec![String::from("enter")])
    );
    // codex : des options NUMÉROTÉES.
    assert_eq!(
        touches_de_confiance(Some("codex"), true),
        Some(vec![String::from("1"), String::from("enter")])
    );
    assert_eq!(
        touches_de_confiance(Some("codex"), false),
        Some(vec![String::from("2")])
    );
    // Aucune famille mesurée = AUCUNE touche : jamais un repli codex.
    for famille in [
        None,
        Some("devin"),
        Some("opencode"),
        Some("cursor"),
        Some(""),
    ] {
        assert_eq!(
            touches_de_confiance(famille, true),
            None,
            "famille {famille:?} : aucune touche devinée"
        );
    }
}

#[test]
fn acceptee_seulement_si_invite_disparue_et_agent_vivant() {
    let port = FauxPort::nouveau(vec![INVITE, APRES]);
    let reponse = repondre_confiance(
        &port,
        &PaneId::from(String::from("wA:p1")),
        true,
        Some("claude"),
    )
    .unwrap_or_else(|cause| panic!("une réponse est une valeur : {cause}"));
    assert_eq!(reponse.etat, EtatConfiance::Acceptee);
    assert!(reponse.accepted);
    assert_eq!(
        port.touches(),
        vec![vec![String::from("down"), String::from("enter")]]
    );
}

#[test]
fn un_agent_mort_ne_prouve_rien() {
    // L'invite a disparu, mais l'agent est parti : un agent mort n'affiche
    // plus d'invite non plus — « transmise », jamais « accordée ».
    let port = FauxPort::nouveau(vec![INVITE, APRES]).sans_agent();
    let reponse = repondre_confiance(
        &port,
        &PaneId::from(String::from("wA:p1")),
        true,
        Some("claude"),
    )
    .unwrap_or_else(|cause| panic!("une réponse est une valeur : {cause}"));
    assert_eq!(reponse.etat, EtatConfiance::Transmise);
    assert!(!reponse.accepted);
    assert!(reponse.detail.contains("gone"), "{}", reponse.detail);
}

#[test]
fn l_invite_encore_la_n_applique_rien() {
    let port = FauxPort::nouveau(vec![INVITE]);
    let reponse = repondre_confiance(
        &port,
        &PaneId::from(String::from("wA:p1")),
        false,
        Some("codex"),
    )
    .unwrap_or_else(|cause| panic!("une réponse est une valeur : {cause}"));
    assert_eq!(reponse.etat, EtatConfiance::Transmise);
    assert_eq!(port.touches(), vec![vec![String::from("2")]]);
}

#[test]
fn sans_invite_rien_ne_part() {
    let port = FauxPort::nouveau(vec![APRES]);
    let reponse = repondre_confiance(
        &port,
        &PaneId::from(String::from("wA:p1")),
        true,
        Some("claude"),
    )
    .unwrap_or_else(|cause| panic!("une réponse est une valeur : {cause}"));
    assert_eq!(reponse.etat, EtatConfiance::NonApplicable);
    assert!(
        port.touches().is_empty(),
        "on ne touche pas à une invite absente"
    );
}

#[test]
fn une_famille_inconnue_ne_recoit_aucune_touche() {
    let port = FauxPort::nouveau(vec![INVITE]);
    let reponse = repondre_confiance(&port, &PaneId::from(String::from("wA:p1")), true, None)
        .unwrap_or_else(|cause| panic!("une réponse est une valeur : {cause}"));
    assert_eq!(reponse.etat, EtatConfiance::NonApplicable);
    assert!(
        reponse.detail.contains("no known key sequence"),
        "{}",
        reponse.detail
    );
    assert!(port.touches().is_empty());
}

#[test]
fn le_refus_nomme_sa_consequence() {
    let port = FauxPort::nouveau(vec![INVITE, APRES]);
    let reponse = repondre_confiance(
        &port,
        &PaneId::from(String::from("wA:p1")),
        false,
        Some("codex"),
    )
    .unwrap_or_else(|cause| panic!("une réponse est une valeur : {cause}"));
    assert_eq!(reponse.etat, EtatConfiance::Refusee);
    assert!(!reponse.accepted);
    // Le refus ARRÊTE l'agent (codex : « 2. Quit ») : la conséquence est
    // nommée, jamais masquée.
    assert!(
        reponse.detail.contains("quits the agent"),
        "{}",
        reponse.detail
    );
}
