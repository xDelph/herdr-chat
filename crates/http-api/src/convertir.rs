//! Les conversions domaine/application → DTO de fil (T050) — chaque champ
//! omissible l'est **mesuré** (`Field`/`Nullable`), jamais aplati.

use application::conversations::Question as QuestionEcran;
use application::conversations::{ConfianceRequise, LigneConversation};
use application::overview::VueOverview;
use contracts::http::conversations::{ConversationSummary, ConversationsResponse};
use contracts::http::interactive::{Choice, Question, TrustRequiredResponse, TrustRequiredStatus};
use contracts::http::overview::{AgentView, OverviewResponse, WorkspaceView};
use contracts::presence::{Field, Nullable};
use domain::observation::{AgentView as AgentDomaine, WorkspaceView as WorkspaceDomaine};

/// L'overview complet — la vue du domaine est la décision, le DTO la forme.
#[must_use]
pub fn vue_overview(vue: &VueOverview) -> OverviewResponse {
    OverviewResponse {
        agents: vue.agents.iter().map(agent).collect(),
        herdr_protocol: vue.herdr_protocol,
        herdr_version: vue.herdr_version.clone(),
        without_session: vue.without_session as u64,
        workspaces: vue.workspaces.iter().map(workspace).collect(),
    }
}

fn agent(agent: &AgentDomaine) -> AgentView {
    AgentView {
        agent: Nullable::de_option(agent.agent.as_ref().map(ToString::to_string)),
        cwd: Nullable::de_option(agent.cwd.clone()),
        focused: agent.focused,
        pane_id: agent.pane_id.to_string(),
        parent_session: Nullable::de_option(agent.parent_session.as_ref().map(ToString::to_string)),
        session_cwd: Nullable::de_option(agent.session_cwd.clone()),
        session_cwd_matches: Nullable::de_option(agent.session_cwd_matches.as_bool()),
        session_id: Nullable::de_option(agent.session_id.as_ref().map(ToString::to_string)),
        session_kind: Nullable::de_option(agent.session_kind),
        session_path: Nullable::de_option(agent.session_path.clone()),
        status: agent.status,
        tab_label: Nullable::de_option(agent.tab_label.clone()),
        tab_id: agent.tab_id.to_string(),
        tab_number: Nullable::de_option(agent.tab_number),
        name: Nullable::de_option(agent.name.as_ref().map(ToString::to_string)),
        pane_rank: Nullable::de_option(agent.pane_rank),
        tab_pane_count: agent.tab_pane_count,
        title: Nullable::de_option(agent.title.clone()),
        workspace_label: Nullable::de_option(agent.workspace_label.clone()),
        workspace_id: agent.workspace_id.to_string(),
    }
}

fn workspace(workspace: &WorkspaceDomaine) -> WorkspaceView {
    WorkspaceView {
        agent_panes: workspace
            .agent_panes
            .iter()
            .map(ToString::to_string)
            .collect(),
        agent_status: Nullable::de_option(workspace.agent_status),
        checkout_path: Nullable::de_option(workspace.checkout_path.clone()),
        focused: workspace.focused,
        label: Nullable::de_option(workspace.label.clone()),
        pane_count: workspace.pane_count,
        tab_count: workspace.tab_count,
        workspace_id: workspace.workspace_id.to_string(),
    }
}

/// La liste des conversations — une ligne par pane visible.
#[must_use]
pub fn liste_conversations(lignes: &[LigneConversation]) -> ConversationsResponse {
    ConversationsResponse {
        conversations: lignes.iter().map(ligne_conversation).collect(),
    }
}

fn ligne_conversation(ligne: &LigneConversation) -> ConversationSummary {
    ConversationSummary {
        agent: Nullable::de_option(ligne.agent.as_ref().map(ToString::to_string)),
        branch: Field::de_option(ligne.branche.clone()),
        last_prompt: Field::de_option(ligne.dernier_texte.clone()),
        model: Field::de_option(ligne.modele.clone()),
        name: Nullable::de_option(ligne.name.as_ref().map(ToString::to_string)),
        pane_rank: Nullable::de_option(ligne.pane_rank),
        tab_pane_count: ligne.tab_pane_count,
        provider: Field::de_option(ligne.fournisseur.clone()),
        preview: Field::de_option(ligne.apercu.clone()),
        question: Field::de_option(ligne.question.as_ref().map(question)),
        waiting: Field::de_option(ligne.attente.clone()),
        trust: Field::de_option(ligne.confiance.as_ref().map(confiance)),
        thinking: Field::de_option(ligne.pensee.clone()),
        session_state: ligne.session_state,
        timestamp: Field::de_option(ligne.horodatage),
        tour_debut: Field::de_option(ligne.tour_debut),
        taches_de_fond: Field::de_option(ligne.taches_de_fond.map(|compte| {
            contracts::http::taches::BackgroundTaskCount {
                en_cours: compte.en_cours,
                total: compte.total,
            }
        })),
        title: ligne.title.clone(),
        status: ligne.status,
        workspace_id: ligne.workspace_id.to_string(),
        tab_id: ligne.tab_id.to_string(),
        pane_id: ligne.pane_id.to_string(),
    }
}

fn question(question: &QuestionEcran) -> Question {
    Question {
        choix: question.choix.iter().map(choix).collect(),
        contexte: question.contexte.clone(),
        invite: Field::de_option(question.invite.clone()),
        texte: question.texte.clone(),
    }
}

fn choix(choix: &application::conversations::Choix) -> Choice {
    Choice {
        detail: Field::de_option(choix.detail.clone()),
        libelle: choix.libelle.clone(),
        numero: choix.numero,
        selectionne: choix.selectionne,
    }
}

fn confiance(confiance: &ConfianceRequise) -> TrustRequiredResponse {
    TrustRequiredResponse {
        folder: confiance.dossier.clone(),
        kind: confiance.type_agent.clone(),
        message: confiance.message.clone(),
        pane_id: confiance.pane.to_string(),
        status: TrustRequiredStatus::TrustRequired,
    }
}
