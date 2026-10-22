//! Le port de contrôle **réel** (T056 suite) : `ClientHerdr` → `ControlPort`.
//!
//! ⚠️ **Deux couches, séparées exprès.**
//! 1. Des **mappages purs** : `wire::PhotoSession` → `domain::Snapshot`,
//!    `wire::InfoAgent` → `AgentObservation`, preuves → `PromptEvidence` /
//!    `TransportEvidence` / `FocusEvidence` / `StartEvidence`. Testables
//!    donnée en main, sans socket, sans Herdr.
//! 2. Le **port** : un `ClientHerdr` derrière un `Mutex`, dont chaque méthode
//!    rend un futur qui exécute l'appel **bloquant au premier poll** (la
//!    convention du socle : les ports sont bloquants déguisés, `Pending` est
//!    un branchement cassé).
//!
//! ⚠️ **Aucune donnée n'est inventée dans le mappage** : un champ omis chez
//! Herdr reste `None`, un `null` mesuré reste `None` **distinct d'un `false`
//! mesuré**, et une preuve non objectivable (`agent.start` sans verdict)
//! donne `Unknown`, jamais `Confirmed`.

use crate::client::{ClientHerdr, Resultat, SourceLecture};
use crate::transport::ErreurTransport;
use crate::wire::{GenreRefSession, InfoAgent, InfoWorkspace, PhotoSession, StatutAgent};
use domain::errors::PortError;
use domain::ids::{AgentKind, AgentName, PaneId, TabId, WorkspaceId};
use domain::observation::{
    AgentObservation, AgentSessionRef, ReadSource, ScreenObservation, Snapshot, SnapshotProvenance,
    WorkspaceObservation, WorkspaceWorktree,
};
use domain::ports::{
    ControlPort, CreateTab, CreatedTab, FocusEvidence, PartialStep, PortFuture, PromptEvidence,
    ScreenRead, StartAgent, StartEvidence, StopEvidence, TargetedKeys, TargetedPrompt,
    TargetedText, TransportEvidence, TransportOutcome,
};
use domain::status::AgentStatus;
use std::sync::{Mutex, PoisonError};

/// Le statut amont → le statut du domaine. **Union fermée des deux côtés** :
/// un ajout d'un côté casse la compilation ici, pas le comportement.
#[must_use]
pub fn statut_depuis(statut: StatutAgent) -> AgentStatus {
    match statut {
        StatutAgent::Idle => AgentStatus::Idle,
        StatutAgent::Working => AgentStatus::Working,
        StatutAgent::Blocked => AgentStatus::Blocked,
        StatutAgent::Done => AgentStatus::Done,
        StatutAgent::Unknown => AgentStatus::Unknown,
    }
}

/// Une référence de session : `id` ou `path`, **tel que Herdr l'expose**.
#[must_use]
pub fn session_depuis(info: &crate::wire::InfoSessionAgent) -> AgentSessionRef {
    AgentSessionRef {
        kind: match info.kind {
            GenreRefSession::Path => domain::observation::SessionRefKind::Path,
            GenreRefSession::Id => domain::observation::SessionRefKind::Id,
        },
        value: info.value.clone(),
    }
}

/// Un agent du fil → l'observation du domaine.
///
/// ⚠️ Les champs `Option<Option<T>>` du fil distinguent **absent** et **null** ;
/// le domaine ne porte qu'un `Option`. La traduction est volontairement
/// **lossless vers l'absence** : `absent` et `null` disent tous deux « Herdr
/// ne le donne pas », et l'affichage doit montrer une absence, jamais un
/// substitut.
#[must_use]
pub fn agent_depuis(info: &InfoAgent) -> AgentObservation {
    AgentObservation {
        pane_id: PaneId::from(info.pane_id.clone()),
        tab_id: TabId::from(info.tab_id.clone()),
        workspace_id: WorkspaceId::from(info.workspace_id.clone()),
        terminal_id: info.terminal_id.clone(),
        revision: info.revision,
        status: statut_depuis(info.agent_status),
        focused: info.focused,
        agent: info
            .agent
            .as_ref()
            .and_then(|valeur| valeur.clone())
            .filter(|nom| !nom.is_empty())
            .map(AgentKind::from),
        name: info
            .name
            .as_ref()
            .and_then(|valeur| valeur.clone())
            .filter(|nom| !nom.is_empty())
            .map(AgentName::from),
        terminal_title: info
            .terminal_title
            .as_ref()
            .and_then(|valeur| valeur.clone()),
        cwd: info.cwd.as_ref().and_then(|valeur| valeur.clone()),
        foreground_cwd: info
            .foreground_cwd
            .as_ref()
            .and_then(|valeur| valeur.clone()),
        completion_seq: info.completion_seq.as_ref().and_then(|valeur| *valeur),
        state_change_seq: info.state_change_seq,
        session: info
            .agent_session
            .as_ref()
            .and_then(|valeur| valeur.as_ref())
            .map(session_depuis),
    }
}

/// Un workspace du fil → l'observation du domaine.
#[must_use]
pub fn workspace_depuis(info: &InfoWorkspace) -> WorkspaceObservation {
    WorkspaceObservation {
        workspace_id: WorkspaceId::from(info.workspace_id.clone()),
        label: info.label.as_ref().and_then(|valeur| valeur.clone()),
        agent_status: info
            .agent_status
            .as_ref()
            .and_then(|valeur| *valeur)
            .map(statut_depuis),
        // ⚠️ `None` reste `None` : ce n'est pas `false`. Un `false` mesuré
        // dirait « on sait qu'il n'est pas focalisé » ; l'absence dit qu'on
        // ne sait pas.
        focused: info.focused.as_ref().and_then(|valeur| *valeur),
        number: info.number.as_ref().and_then(|valeur| *valeur),
        pane_count: info.pane_count,
        tab_count: info.tab_count,
        active_tab_id: info
            .active_tab_id
            .as_ref()
            .and_then(|valeur| valeur.clone())
            .map(TabId::from),
        worktree: info
            .worktree
            .as_ref()
            .and_then(|valeur| valeur.as_ref())
            .map(|worktree| WorkspaceWorktree {
                checkout_path: worktree.checkout_path.clone(),
                is_linked_worktree: worktree.is_linked_worktree,
                repo_key: worktree.repo_key.clone(),
                repo_name: worktree.repo_name.clone(),
                repo_root: worktree.repo_root.clone(),
            }),
    }
}

/// La photo complète → le snapshot du domaine.
///
/// ⚠️ **`tabs` et `layouts` restent `None`** : `session.snapshot` ne les porte
/// pas (mesuré). Les inventer — même vides — ferait croire qu'on a regardé.
#[must_use]
pub fn observation_depuis_photo(photo: &PhotoSession) -> Snapshot {
    Snapshot {
        agents: photo.agents.iter().map(agent_depuis).collect(),
        workspaces: photo.workspaces.iter().map(workspace_depuis).collect(),
        focused_pane: photo.focused_pane_id.clone().map(PaneId::from),
        focused_tab: photo.focused_tab_id.clone().map(TabId::from),
        focused_workspace: photo.focused_workspace_id.clone().map(WorkspaceId::from),
        layouts: None,
        provenance: Some(SnapshotProvenance {
            protocol: photo.protocol,
            version: photo.version.clone(),
        }),
        tabs: None,
    }
}

/// Une lecture d'écran → l'observation, **dégradée proprement**.
///
/// ⚠️ Le client rend déjà `(texte, tronqué)`, une charge partielle devenant
/// du vide : ici on ne fait que nommer la source, jamais inventer un texte.
#[must_use]
pub fn ecran_depuis(
    pane: &PaneId,
    (texte, tronque): (String, bool),
    source: SourceLecture,
) -> ScreenObservation {
    ScreenObservation {
        pane_id: pane.clone(),
        text: if texte.is_empty() { None } else { Some(texte) },
        truncated: Some(tronque),
        source: Some(match source {
            SourceLecture::Recent => ReadSource::Recent,
            SourceLecture::Visible => ReadSource::Visible,
        }),
    }
}

/// La preuve d'un prompt : **l'empreinte confirmée doit être la nôtre** (C05).
///
/// ⚠️ Un `result` objet **vide** (`{}`) n'est pas une confirmation : Herdr
/// confirme en renvoyant l'empreinte demandée. Sans elle, l'état réel est
/// inconnu — et on ne prétend pas l'inverse.
#[must_use]
pub fn preuve_de_prompt(valeur: &serde_json::Value, demandee: &str) -> PromptEvidence {
    let confirmee = valeur
        .get("fingerprint")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    match confirmee {
        Some(empreinte) if empreinte == demandee => PromptEvidence::Confirmed {
            fingerprint: domain::ids::DeliveryFingerprint::from(empreinte),
        },
        Some(empreinte) => PromptEvidence::Unknown {
            partial: vec![
                PartialStep::LiteralTextWritten,
                PartialStep::EnterSequenceSent,
            ],
            detail: format!("confirmation étrangère : {empreinte}"),
        },
        None => PromptEvidence::Unknown {
            partial: vec![
                PartialStep::LiteralTextWritten,
                PartialStep::EnterSequenceSent,
            ],
            detail: String::from("réponse sans empreinte : envoi non prouvé"),
        },
    }
}

/// La preuve d'une écriture de texte ou de touches : un `result` objet est une
/// **livraison** ; son absence serait une panne (jamais un `Ok` vide).
#[must_use]
pub fn preuve_de_transport(detail: &str, etape: PartialStep) -> TransportEvidence {
    TransportEvidence {
        outcome: TransportOutcome::Delivered,
        partial: vec![etape],
        detail: String::from(detail),
    }
}

/// La preuve d'un focus : l'appel a répondu, donc le focus a été appliqué.
#[must_use]
pub fn preuve_de_focus() -> FocusEvidence {
    FocusEvidence::Focused
}

/// La preuve d'un lancement : `agent.start` qui répond sans erreur dit que
/// l'agent occupe son pane — c'est ce que le fil vérifie ensuite par le
/// snapshot.
#[must_use]
pub fn preuve_de_lancement(pane: &PaneId) -> StartEvidence {
    StartEvidence::Started { pane: pane.clone() }
}

/// La traduction d'une erreur de transport — chaque cause garde sa nature.
#[must_use]
pub fn erreur_de_port(cause: &ErreurTransport) -> PortError {
    match cause {
        ErreurTransport::AmontRefus { code, message } => PortError::Upstream {
            code: code.clone(),
            message: message.clone(),
        },
        ErreurTransport::DelaiDepasse => PortError::Timeout,
        ErreurTransport::Socket(detail)
        | ErreurTransport::JsonInvalide(detail)
        | ErreurTransport::EnveloppeInvalide(detail) => PortError::Transport {
            detail: detail.clone(),
        },
        ErreurTransport::Ferme => PortError::Transport {
            detail: String::from("socket fermé par l'amont"),
        },
        ErreurTransport::CadreTropGrand => PortError::Transport {
            detail: String::from("cadre au-delà de 16 MiB"),
        },
        ErreurTransport::MauvaiseCorrelation { attendu, recu } => PortError::Transport {
            detail: format!("corrélation rompue : attendu {attendu}, reçu {recu}"),
        },
    }
}

/// Le port réel : des clients Herdr interchangeables, prêtés le temps d'un appel.
///
/// ⚠️ **Un verrou unique sérialisait TOUT, et c'était le coût de la liste.**
/// `ClientHerdr` n'est qu'un chemin de socket et un compteur d'identifiants :
/// **chaque demande ouvre sa propre connexion** (Herdr sert une requête par
/// connexion, puis ferme). Le verrou n'était donc nécessaire à rien — il
/// transformait les lectures d'écran en file d'attente. Mesuré : 19 panes à
/// ~135 ms l'un, soit **2,6 s** pour `/api/conversations`, même avec des
/// workers parallèles, puisqu'ils se bloquaient tous sur le même verrou. Le
/// backend TS répond, lui, en 0,2 s sur les mêmes appels.
///
/// On prête donc un client : N appels concurrents, N connexions, et le client
/// revient dans la réserve. Aucune corrélation ne peut se mélanger, chaque
/// connexion ne portant qu'une seule demande.
pub struct PortHerdr {
    chemin: std::path::PathBuf,
    /// Les clients libres. Chacun est un chemin + un compteur : les créer coûte
    /// un `PathBuf`, les garder évite d'en fabriquer un par requête.
    disponibles: Mutex<Vec<ClientHerdr>>,
}

impl PortHerdr {
    /// Ouvre le socket. Un échec de connexion est rendu, jamais contourné : le
    /// démon dira « Herdr injoignable » au lieu de servir des données vides.
    pub fn connecte(chemin: &std::path::Path) -> Result<Self, PortError> {
        let client = ClientHerdr::connecte(chemin).map_err(|cause| erreur_de_port(&cause))?;
        Ok(Self {
            chemin: chemin.to_path_buf(),
            disponibles: Mutex::new(vec![client]),
        })
    }

    /// Un client libre — ou un nouveau, fabriqué depuis le chemin mesuré.
    fn emprunte(&self) -> Result<ClientHerdr, PortError> {
        if let Some(client) = self
            .disponibles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pop()
        {
            return Ok(client);
        }
        ClientHerdr::connecte(&self.chemin).map_err(|cause| erreur_de_port(&cause))
    }

    /// Rend le client à la réserve, qu'il ait servi ou non.
    fn rend(&self, client: ClientHerdr) {
        self.disponibles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(client);
    }

    /// Les intégrations installées, sur un client de la réserve (H07) — la
    /// charge brute, telle qu'Herdr la rend : le catalogue la décode lui-même.
    pub fn integrations(&self) -> Result<serde_json::Value, PortError> {
        let mut client = self.emprunte()?;
        let resultat = client
            .integrations()
            .map_err(|cause| erreur_de_port(&cause));
        self.rend(client);
        resultat
    }

    /// Exécute une demande **bloquante** et la rend comme un futur qui répond
    /// au premier poll — la convention du socle (un `Pending` serait un
    /// branchement cassé).
    fn bloquant<T, F>(&self, demande: F) -> PortFuture<'_, T>
    where
        T: Send,
        F: FnOnce(&mut ClientHerdr) -> Resultat<T> + Send + 'static,
    {
        Box::pin(async move {
            let mut client = self.emprunte()?;
            let resultat = demande(&mut client).map_err(|cause| erreur_de_port(&cause));
            self.rend(client);
            resultat
        })
    }
}

impl ControlPort for PortHerdr {
    fn ping(&self) -> PortFuture<'_, domain::observation::UpstreamPing> {
        self.bloquant(|client| {
            client.ping().map(|pong| domain::observation::UpstreamPing {
                protocol: pong.protocol,
                version: pong.version,
            })
        })
    }

    fn snapshot(&self) -> PortFuture<'_, Snapshot> {
        self.bloquant(|client| {
            client
                .photo_session()
                .map(|photo| observation_depuis_photo(&photo))
        })
    }

    fn list_agents(&self) -> PortFuture<'_, domain::observation::AgentListObservation> {
        self.bloquant(|client| {
            client
                .liste_agents()
                .map(|agents| domain::observation::AgentListObservation {
                    agents: agents.iter().map(agent_depuis).collect(),
                })
        })
    }

    fn read_screen(&self, request: ScreenRead) -> PortFuture<'_, ScreenObservation> {
        /*
          ⚠️ **`visible`, jamais `recent` — et c'est une mesure, pas un goût.**

          `recent` demande à Herdr de reconstruire l'historique du pane : mesuré
          sur le socket réel, `agent.read {source: "recent", lines: 200}` prend
          **de 80 ms à 1 075 ms** selon le pane, alors que `{source: "visible"}`
          prend **4 ms**. Sur les 19 panes de `/api/conversations`, cela faisait
          **1 à 2,6 s** par requête : la liste ne s'affichait pas au démarrage
          sur un téléphone.

          C'est aussi la lecture JUSTE pour ce qu'on en fait : une question, une
          invite de confiance ou une attente sont sur l'écran **courant**. Le
          backend TS lisait déjà `visible` pour ces trois usages, et c'est pour
          ça qu'il répondait en 0,2 s sur les mêmes appels.

          `visible` ne porte pas de nombre de lignes : Herdr rend l'écran tel
          qu'il est (le client n'envoie `lines` que pour `recent`).
        */
        let source = SourceLecture::Visible;
        let lignes = None;
        let pane = request.pane.clone();
        self.bloquant(move |client| {
            client
                // `as_str()` rend un emprunt : on clone une fois, pour la
                // durée de l'appel bloquant.
                .lecture_ecran(pane.as_str(), lignes, source)
                .map(|lecture| ecran_depuis(&pane, lecture, source))
        })
    }

    fn prompt(&self, request: TargetedPrompt) -> PortFuture<'_, PromptEvidence> {
        let cible = request.pane.as_str().to_string();
        let empreinte = request.fingerprint.as_str().to_string();
        let texte = request.literal_text.clone();
        self.bloquant(move |client| {
            client
                .prompt(&cible, &texte)
                .map(|valeur| preuve_de_prompt(&valeur, &empreinte))
        })
    }

    fn send_text(&self, request: TargetedText) -> PortFuture<'_, TransportEvidence> {
        let cible = request.pane.as_str().to_string();
        let texte = request.text.clone();
        self.bloquant(move |client| {
            client
                .texte_brut(&cible, &texte)
                .map(|_| preuve_de_transport("texte écrit", PartialStep::LiteralTextWritten))
        })
    }

    fn send_keys(&self, request: TargetedKeys) -> PortFuture<'_, TransportEvidence> {
        let cible = request.pane.as_str().to_string();
        let touches = request.keys.clone();
        self.bloquant(move |client| {
            client
                .touches(&cible, &touches)
                .map(|_| preuve_de_transport("touches envoyées", PartialStep::KeysSent))
        })
    }

    fn focus(&self, pane: PaneId) -> PortFuture<'_, FocusEvidence> {
        self.bloquant(move |client| client.focus(pane.as_str()).map(|_| preuve_de_focus()))
    }

    fn create_tab(&self, request: CreateTab) -> PortFuture<'_, CreatedTab> {
        let dossier = request.cwd.clone();
        let libelle = request.label.clone();
        let workspace = request.workspace.as_str().to_string();
        self.bloquant(move |client| {
            client
                .creation_onglet(Some(&dossier), false, libelle.as_deref(), Some(&workspace))
                .map(|cree| CreatedTab {
                    tab: TabId::from(cree.tab),
                    pane: PaneId::from(cree.root_pane),
                })
        })
    }

    fn start_agent(&self, request: StartAgent) -> PortFuture<'_, StartEvidence> {
        let pane = request.pane.clone();
        let genre = request.kind.as_str().to_string();
        let nom = request.name.as_ref().map(|nom| nom.as_str().to_string());
        let args = request.args.clone();
        self.bloquant(move |client| {
            client
                .lancement(&genre, nom.as_deref(), pane.as_str(), &args, DELAI_AGENT_MS)
                .map(|_| preuve_de_lancement(&pane))
        })
    }

    fn fermer_onglet(&self, tab: TabId) -> PortFuture<'_, ()> {
        let onglet = tab.to_string();
        self.bloquant(move |client| client.fermeture_onglet(&onglet).map(|_| ()))
    }

    fn stop(&self, pane: PaneId) -> PortFuture<'_, StopEvidence> {
        // Herdr 0.9.3 n'a pas d'`agent.stop` : la seule primitive est la
        // touche Ctrl+C, transmise comme une séquence de touches.
        let cible = pane.as_str().to_string();
        self.bloquant(move |client| {
            client
                .touches(&cible, &[String::from("ctrl-c")])
                .map(|_| StopEvidence::InterruptSent)
        })
    }
}

/// Le délai de `agent.start` — 125 s (le fil : 120 s côté Herdr + marge).
pub const DELAI_AGENT_MS: u64 = 125_000;
