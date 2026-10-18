//! La composition de l'accueil (T039, D01–D04) : à partir d'UNE génération
//! d'observation (T038), les vues de workspace et d'agent — les homologues
//! `domain::observation::{AgentView, WorkspaceView}` que `contracts` traduit
//! vers le fil.
//!
//! ⚠️ **Une seule génération** : la vue entière (agents + workspaces +
//! compteurs) est assemblée depuis la même `ObservationBorne` — jamais deux
//! photos mêlées (TECH §4 : « Changes are committed by source/snapshot
//! generation »).
//!
//! ⚠️ **Deux sources, deux questions** : le nom vient de l'agent, le rang de
//! la **disposition** de son tab (« comment s'appelle-t-il ? », « où
//! est-il ? »). Un pane absent du contexte (snapshot partiel) n'a pas de
//! rang, et l'étiquette saura s'en passer (D04).
//!
//! ⚠️ **Le tri-état du cwd** (D03) : `sessionCwdMatches` vaut `null` quand
//! l'un des deux termes manque — distinct de `false`, jamais déduit.

use crate::state::ObservationBorne;
use crate::visibilite::repartir_agents;
use domain::ids::SessionId;
use domain::naming::{NamingContext, checkout_path_of, panes_situes, useful_label};
use domain::observation::{
    AgentObservation, AgentView, CwdMatch, SessionRefKind, Snapshot, WorkspaceView,
};

/// La source de session d'un pane, résolue : la décision UNIQUE partagée
/// par l'accueil, la liste et la lecture (U14) — fournie par `sessions`
/// (le graphe interdit à `application` d'importer `sessions` : la
/// résolution est INJECTÉE, composée par herdrchat au T056).
pub trait ResoutSessions: Send + Sync {
    /// Résout la source d'un agent — chemin de fichier ou base, identifiant
    /// de session et en-tête (cwd, parent) quand la source les porte.
    fn source_de(&self, agent: &AgentObservation) -> Option<SourceDeSession>;
}

/// Une source résolue et ses métadonnées d'en-tête.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SourceDeSession {
    /// Le genre annoncé par Herdr — ou `Path` quand le repli par titre a
    /// rendu un emplacement de fichier.
    pub kind: SessionRefKind,
    /// La base (fichier JSONL ou SQLite) — la porte de la lecture.
    pub base: Option<String>,
    /// L'identifiant de session chez le magasin.
    pub session_id: Option<SessionId>,
    /// Le dossier de travail déclaré par l'en-tête de la session.
    pub cwd: Option<String>,
    /// La session parente déclarée par l'en-tête.
    pub parent: Option<SessionId>,
}

/// La vue d'accueil sur une génération — ce que la page affiche.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct VueOverview {
    pub agents: Vec<AgentView>,
    pub workspaces: Vec<WorkspaceView>,
    /// Version/protocole amont portés par l'observation (jamais devinés).
    pub herdr_protocol: u64,
    pub herdr_version: String,
    /// Combien d'agents sont masqués par la règle de visibilité — D05 :
    /// le COMPTE, jamais chaque fichier manquant.
    pub without_session: usize,
}

/// L'utilitaire purement compositif de l'accueil — sans état.
#[derive(Default)]
pub struct ComposeurOverview;

impl ComposeurOverview {
    #[must_use]
    pub fn nouveau() -> Self {
        ComposeurOverview
    }

    /// Compose la vue complète depuis une observation horodatée (T038) et
    /// le résolveur injecté.
    pub fn compose(&self, borne: &ObservationBorne, resolveur: &dyn ResoutSessions) -> VueOverview {
        let nommage = NamingContext::from_snapshot(&borne.snapshot);
        let tous: Vec<AgentView> = borne
            .snapshot
            .agents
            .iter()
            .map(|agent| self.enrichit(agent, &nommage, resolveur))
            .collect();
        let (agents, masquees) = repartir_agents(&tous);
        VueOverview {
            herdr_protocol: borne.snapshot.protocol().unwrap_or(0),
            herdr_version: borne.snapshot.version().unwrap_or_default().to_string(),
            without_session: masquees,
            workspaces: self.vues_workspace(&borne.snapshot, &agents),
            agents,
        }
    }

    /// La vue d'agent : identité Herdr + enrichissement (nom, rang, session).
    fn enrichit(
        &self,
        agent: &AgentObservation,
        nommage: &NamingContext,
        resolveur: &dyn ResoutSessions,
    ) -> AgentView {
        let annoncee = agent.session.as_ref();
        let source = resolveur.source_de(agent);
        let session = match &source {
            Some(source) => Some((source.kind, source.base.as_deref())),
            None => annoncee.map(|refs| (refs.kind, Some(refs.value.as_str()))),
        };
        // Le genre de la référence : ce que Herdr a annoncé fait foi ; le
        // repli par titre rend toujours un emplacement de FICHIER.
        let session_kind = match annoncee {
            Some(annoncee) => Some(annoncee.kind),
            None => session.as_ref().map(|_| SessionRefKind::Path),
        };
        let session_path = source.as_ref().and_then(|source| source.base.clone());
        let session_cwd = source.as_ref().and_then(|source| source.cwd.clone());
        let session_id = source.as_ref().and_then(|source| source.session_id.clone());
        let parent_session = source.as_ref().and_then(|source| source.parent.clone());
        let situation =
            nommage
                .panes
                .get(&agent.pane_id)
                .copied()
                .unwrap_or(domain::naming::PaneSituation {
                    rank: None,
                    tab_pane_count: 1,
                });
        // Le tri-état calculé AVANT le déplacement des champs : `null` quand
        // l'un des deux termes manque, distinct de `false` (D03).
        let session_cwd_matches =
            CwdMatch::from_parts(agent.cwd.as_deref(), session_cwd.as_deref());
        AgentView {
            pane_id: agent.pane_id.clone(),
            tab_id: agent.tab_id.clone(),
            workspace_id: agent.workspace_id.clone(),
            agent: agent.agent.clone(),
            status: agent.status,
            focused: agent.focused,
            name: agent.name.clone(),
            title: agent.terminal_title.clone(),
            cwd: agent.cwd.clone(),
            tab_label: nommage
                .tabs
                .get(&agent.tab_id)
                .and_then(|tab| useful_label(tab.label.as_deref()))
                .map(ToOwned::to_owned),
            tab_number: nommage.tabs.get(&agent.tab_id).map(|tab| tab.number),
            workspace_label: nommage
                .workspaces
                .get(&agent.workspace_id)
                .and_then(Clone::clone),
            pane_rank: situation.rank,
            tab_pane_count: situation.tab_pane_count,
            session_kind,
            session_path,
            session_id,
            session_cwd,
            parent_session,
            session_cwd_matches,
        }
    }

    /// Les vues de workspace : les compteurs viennent du SNAPSHOT (jamais
    /// reconstruits par regroupement — un regroupement divergerait), le
    /// dossier du worktree lié ou du premier cwd de pane (D02), et les
    /// panes des agents VISIBLES seulement.
    fn vues_workspace(
        &self,
        photo: &Snapshot,
        agents_visibles: &[AgentView],
    ) -> Vec<WorkspaceView> {
        let situes = panes_situes(photo);
        photo
            .workspaces
            .iter()
            .map(|workspace| WorkspaceView {
                workspace_id: workspace.workspace_id.clone(),
                label: workspace.label.clone(),
                agent_status: workspace.agent_status,
                pane_count: workspace.pane_count.unwrap_or(0),
                tab_count: workspace.tab_count.unwrap_or(0),
                focused: workspace.focused.unwrap_or(false),
                checkout_path: checkout_path_of(workspace, &situes),
                agent_panes: agents_visibles
                    .iter()
                    .filter(|agent| agent.workspace_id == workspace.workspace_id)
                    .map(|agent| agent.pane_id.clone())
                    .collect(),
            })
            .collect()
    }
}

/// Le raccourci d'enrichissement hors service — réexporté pour les tests :
/// la vue d'un agent en une passe.
pub fn enrichit_un_agent(
    agent: &AgentObservation,
    nommage: &NamingContext,
    resolveur: &dyn ResoutSessions,
) -> AgentView {
    ComposeurOverview::nouveau().enrichit(agent, nommage, resolveur)
}
