//! Faux port de contrôle Herdr : les actions ne partent nulle part.
//!
//! ⚠️ **Capture ordonnée au moment de l'appel.** Chaque opération est notée
//! (opération, cible, détail factuel) avant de répondre — l'ordre des
//! actions d'un scénario est la matière de la preuve (create_tab **avant**
//! start_agent, jamais l'inverse, T037).
//!
//! ⚠️ Absences honnêtes par défaut : sans réponse réglée, la lecture
//! d'écran rend un écran **absent** (`text`/`source` à `None`), le snapshot
//! un snapshot **vide** (une observation valable), et un prompt une
//! confirmation portant **l'empreinte de la demande** — c'est le contrat
//! documenté du faux, rien ne vient du réel.

use domain::errors::PortError;
use domain::ids::{PaneId, TabId};
use domain::observation::{AgentListObservation, ScreenObservation, Snapshot, UpstreamPing};
use domain::ports::{
    ControlPort, CreateTab, CreatedTab, FocusEvidence, PartialStep, PortFuture, PromptEvidence,
    ScreenRead, StartAgent, StartEvidence, StopEvidence, TargetedKeys, TargetedPrompt,
    TargetedText, TransportEvidence, TransportOutcome,
};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// Les opérations capturées, dans l'ordre du fil d'exécution.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub enum Op {
    Ping,
    Snapshot,
    ListeAgents,
    LectureEcran,
    Prompt,
    EnvoiTexte,
    EnvoiTouches,
    Focus,
    CreationTab,
    LancementAgent,
    Arret,
}

/// Une action capturée : quoi (opération), sur qui (cible), quel fait.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ActionCapturee {
    pub op: Op,
    /// L'identifiant visé, tel que l'appel l'a donné — « — » pour les
    /// opérations sans cible.
    pub cible: String,
    /// Un fait court (nombre de caractères, de touches, dossier demandé) —
    /// jamais un verdict.
    pub detail: String,
}

#[derive(Debug, Default)]
struct Reglages {
    panne: Option<PortError>,
    /// Les pannes réglées **par opération** : seule l'opération nommée
    /// échoue, exactement avec cette panne — la capture note quand même
    /// l'action tentée.
    pannes_par_operation: BTreeMap<Op, PortError>,
    ping: Option<UpstreamPing>,
    snapshot: Option<Snapshot>,
    ecrans: BTreeMap<PaneId, ScreenObservation>,
    prompt: Option<PromptEvidence>,
    texte: Option<TransportEvidence>,
    touches: Option<TransportEvidence>,
    focus: Option<FocusEvidence>,
    creation: Option<CreatedTab>,
    lancement: Option<StartEvidence>,
    arret: Option<StopEvidence>,
    actions: Vec<ActionCapturee>,
}

/// Le faux. Clone = le même appareil : même capture, mêmes réponses réglées.
#[derive(Clone, Debug, Default)]
pub struct HerdrFaux {
    interieur: Arc<Mutex<Reglages>>,
}

impl HerdrFaux {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    fn verrou(&self) -> MutexGuard<'_, Reglages> {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn repond_ping(&self, ping: UpstreamPing) {
        self.verrou().ping = Some(ping);
    }

    pub fn repond_snapshot(&self, snapshot: Snapshot) {
        self.verrou().snapshot = Some(snapshot);
    }

    /// Remplace l'écran simulé d'un pane (le dernier réglé gagne).
    pub fn remplace_ecran(&self, observation: ScreenObservation) {
        let pane = observation.pane_id.clone();
        self.verrou().ecrans.insert(pane, observation);
    }

    pub fn repond_prompt(&self, preuve: PromptEvidence) {
        self.verrou().prompt = Some(preuve);
    }

    pub fn repond_envoi_texte(&self, preuve: TransportEvidence) {
        self.verrou().texte = Some(preuve);
    }

    pub fn repond_envoi_touches(&self, preuve: TransportEvidence) {
        self.verrou().touches = Some(preuve);
    }

    pub fn repond_focus(&self, preuve: FocusEvidence) {
        self.verrou().focus = Some(preuve);
    }

    /// Règle ce que la prochaine création rendra (et les suivantes).
    pub fn repond_creation_tab(&self, tab: CreatedTab) {
        self.verrou().creation = Some(tab);
    }

    pub fn repond_lancement(&self, preuve: StartEvidence) {
        self.verrou().lancement = Some(preuve);
    }

    pub fn repond_arret(&self, preuve: StopEvidence) {
        self.verrou().arret = Some(preuve);
    }

    /// Panne **globale** : chaque opération renverra exactement cette panne,
    /// recopiée — la capture note quand même chaque action tentée.
    pub fn panne_globale(&self, panne: PortError) {
        self.verrou().panne = Some(panne);
    }

    /// Retire la panne globale.
    pub fn sans_panne_globale(&self) {
        self.verrou().panne = None;
    }

    /// Panne d'UNE opération : seule cette opération échoue, exactement
    /// avec cette panne — les autres répondent normalement. La capture
    /// note quand même l'action tentée.
    pub fn panne_sur(&self, op: Op, panne: PortError) {
        self.verrou().pannes_par_operation.insert(op, panne);
    }

    /// Les actions capturées, dans l'ordre d'appel.
    #[must_use]
    pub fn actions(&self) -> Vec<ActionCapturee> {
        self.verrou().actions.clone()
    }

    /// Vide la capture — un scénario repart d'un journal vierge.
    pub fn vider_actions(&self) {
        self.verrou().actions.clear();
    }

    fn note_panne(interieur: &Reglages, op: Op) -> Result<(), PortError> {
        // La panne réglée **pour cette opération** prime sur la panne globale.
        if let Some(panne) = interieur.pannes_par_operation.get(&op) {
            return Err(panne.clone());
        }
        match &interieur.panne {
            Some(panne) => Err(panne.clone()),
            None => Ok(()),
        }
    }
}

impl ControlPort for HerdrFaux {
    fn ping(&self) -> PortFuture<'_, UpstreamPing> {
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::Ping,
                cible: String::from("—"),
                detail: String::from("santé demandée"),
            });
            Self::note_panne(&interieur, Op::Ping)?;
            match &interieur.ping {
                Some(reponse) => Ok(reponse.clone()),
                // Provenance simulée par défaut : protocole et version du
                // corpus canonique — jamais une lecture du réel.
                None => Ok(UpstreamPing {
                    protocol: 22,
                    version: String::from("0.9.3"),
                }),
            }
        })
    }

    fn snapshot(&self) -> PortFuture<'_, Snapshot> {
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::Snapshot,
                cible: String::from("—"),
                detail: String::from("photo complète"),
            });
            Self::note_panne(&interieur, Op::Snapshot)?;
            match &interieur.snapshot {
                Some(reponse) => Ok(reponse.clone()),
                // Un snapshot simulé sans réglage est **vide** : observation
                // valable, rien de plus.
                None => Ok(Snapshot::default()),
            }
        })
    }

    fn list_agents(&self) -> PortFuture<'_, AgentListObservation> {
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::ListeAgents,
                cible: String::from("—"),
                detail: String::from("liste des agents"),
            });
            Self::note_panne(&interieur, Op::ListeAgents)?;
            match &interieur.snapshot {
                Some(reponse) => Ok(AgentListObservation {
                    agents: reponse.agents.clone(),
                }),
                None => Ok(AgentListObservation { agents: Vec::new() }),
            }
        })
    }

    fn read_screen(&self, request: ScreenRead) -> PortFuture<'_, ScreenObservation> {
        let cible = request.pane.as_str().to_string();
        let detail = format!("{} lignes au plus", request.max_lines);
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::LectureEcran,
                cible,
                detail,
            });
            Self::note_panne(&interieur, Op::LectureEcran)?;
            match interieur.ecrans.get(&request.pane) {
                Some(ecran) => Ok(ecran.clone()),
                // Pas de règle = pas d'écran : absence constatée, aucun
                // texte inventé.
                None => Ok(ScreenObservation {
                    pane_id: request.pane,
                    text: None,
                    truncated: None,
                    source: None,
                }),
            }
        })
    }

    fn prompt(&self, request: TargetedPrompt) -> PortFuture<'_, PromptEvidence> {
        let cible = request.pane.as_str().to_string();
        let detail = format!("{} caractères", request.literal_text.chars().count());
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::Prompt,
                cible,
                detail,
            });
            Self::note_panne(&interieur, Op::Prompt)?;
            match &interieur.prompt {
                Some(preuve) => Ok(preuve.clone()),
                // Défaut documenté du faux : l'amont simulé confirme avec
                // l'empreinte **portée par la demande** — pas un calcul du
                // réel. Un scénario qui veut l'incertitude règle sa réponse.
                None => Ok(PromptEvidence::Confirmed {
                    fingerprint: request.fingerprint,
                }),
            }
        })
    }

    fn send_text(&self, request: TargetedText) -> PortFuture<'_, TransportEvidence> {
        let cible = request.pane.as_str().to_string();
        let detail = format!("{} caractères", request.text.chars().count());
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::EnvoiTexte,
                cible,
                detail,
            });
            Self::note_panne(&interieur, Op::EnvoiTexte)?;
            match &interieur.texte {
                Some(preuve) => Ok(preuve.clone()),
                None => Ok(TransportEvidence {
                    outcome: TransportOutcome::Delivered,
                    partial: vec![PartialStep::LiteralTextWritten],
                    detail: String::from("écriture simulée, livraison annoncée"),
                }),
            }
        })
    }

    fn send_keys(&self, request: TargetedKeys) -> PortFuture<'_, TransportEvidence> {
        let cible = request.pane.as_str().to_string();
        let detail = format!("{} touches", request.keys.len());
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::EnvoiTouches,
                cible,
                detail,
            });
            Self::note_panne(&interieur, Op::EnvoiTouches)?;
            match &interieur.touches {
                Some(preuve) => Ok(preuve.clone()),
                None => Ok(TransportEvidence {
                    outcome: TransportOutcome::Delivered,
                    partial: vec![PartialStep::KeysSent],
                    detail: String::from("touches simulées, livraison annoncée"),
                }),
            }
        })
    }

    fn focus(&self, pane: PaneId) -> PortFuture<'_, FocusEvidence> {
        let cible = pane.as_str().to_string();
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::Focus,
                cible,
                detail: String::from("focus demandé"),
            });
            Self::note_panne(&interieur, Op::Focus)?;
            match &interieur.focus {
                Some(preuve) => Ok(preuve.clone()),
                None => Ok(FocusEvidence::Focused),
            }
        })
    }

    fn create_tab(&self, request: CreateTab) -> PortFuture<'_, CreatedTab> {
        let cible = request.workspace.as_str().to_string();
        let detail = request.cwd.clone();
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::CreationTab,
                cible,
                detail,
            });
            Self::note_panne(&interieur, Op::CreationTab)?;
            match &interieur.creation {
                Some(tab) => Ok(tab.clone()),
                // Identités simulées reconnaissables au suffixe `-sim` dans
                // toute capture.
                None => Ok(CreatedTab {
                    tab: TabId::from(String::from("t-sim")),
                    pane: PaneId::from(String::from("p-sim")),
                }),
            }
        })
    }

    fn start_agent(&self, request: StartAgent) -> PortFuture<'_, StartEvidence> {
        let cible = request.pane.as_str().to_string();
        let nom = request
            .name
            .as_ref()
            .map_or_else(String::new, |n| format!(" «{}»", n));
        let detail = format!("{}{}", request.kind.as_str(), nom);
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::LancementAgent,
                cible,
                detail,
            });
            Self::note_panne(&interieur, Op::LancementAgent)?;
            match &interieur.lancement {
                Some(preuve) => Ok(preuve.clone()),
                None => Ok(StartEvidence::Started { pane: request.pane }),
            }
        })
    }

    fn stop(&self, pane: PaneId) -> PortFuture<'_, StopEvidence> {
        let cible = pane.as_str().to_string();
        Box::pin(async move {
            let mut interieur = self.verrou();
            interieur.actions.push(ActionCapturee {
                op: Op::Arret,
                cible,
                detail: String::from("interruption demandée"),
            });
            Self::note_panne(&interieur, Op::Arret)?;
            match &interieur.arret {
                Some(preuve) => Ok(preuve.clone()),
                // Défaut du faux : l'interruption est annoncée envoyée ; un
                // test sérieux d'arrêt règle sa réponse — le réel n'est
                // jamais ici.
                None => Ok(StopEvidence::InterruptSent),
            }
        })
    }
}
