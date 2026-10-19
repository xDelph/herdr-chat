//! La composition de l'accueil (T039, D01–D04) : vues workspace/agent sur
//! UNE génération, worktree gagne sur cwd, workspace vide gardé, tri-état du
//! cwd, libellé numérique supprimé, rang depuis la disposition.
//! Prouve : D02.

use application::conversations::{EntreeLu, LitSessions};
use application::overview::{ComposeurOverview, ResoutSessions, SourceDeSession};
use application::state::ObservationBorne;
use domain::ids::{PaneId, TabId, WorkspaceId};
use domain::observation::{
    AgentObservation, CwdMatch, PaneLayoutObservation, Snapshot, TabObservation,
    WorkspaceObservation,
};
use domain::status::AgentStatus;
use std::collections::BTreeMap;
use std::time::Instant;

/// Le faux résolveur : une source par pane, rien de plus.
#[derive(Default)]
struct FauxSessions {
    sources: BTreeMap<PaneId, Option<SourceDeSession>>,
}

impl FauxSessions {
    fn avec_source(mut self, pane: &str, source: SourceDeSession) -> Self {
        self.sources
            .insert(PaneId::from(String::from(pane)), Some(source));
        self
    }
}

impl ResoutSessions for FauxSessions {
    fn source_de(&self, agent: &AgentObservation) -> Option<SourceDeSession> {
        self.sources.get(&agent.pane_id).cloned().flatten()
    }
}

impl LitSessions for FauxSessions {
    fn fenetre(
        &self,
        _pane: &PaneId,
        _source: &SourceDeSession,
    ) -> Result<Vec<EntreeLu>, application::conversations::ErreurDeLecture> {
        Ok(Vec::new())
    }
}

fn source_chemin(base: &str, cwd: &str) -> SourceDeSession {
    SourceDeSession {
        kind: domain::observation::SessionRefKind::Path,
        base: Some(String::from(base)),
        session_id: None,
        cwd: Some(String::from(cwd)),
        parent: None,
    }
}

fn agent(pane: &str, tab: &str, workspace: &str, kind: &str) -> AgentObservation {
    AgentObservation {
        pane_id: PaneId::from(String::from(pane)),
        tab_id: TabId::from(String::from(tab)),
        workspace_id: WorkspaceId::from(String::from(workspace)),
        terminal_id: String::from("term"),
        revision: 1,
        status: AgentStatus::Idle,
        focused: false,
        agent: Some(domain::ids::AgentKind::from(String::from(kind))),
        name: None,
        terminal_title: None,
        cwd: Some(String::from("/projets/atelier")),
        foreground_cwd: None,
        completion_seq: None,
        state_change_seq: None,
        session: None,
    }
}

fn workspace(ident: &str, libelle: &str) -> WorkspaceObservation {
    WorkspaceObservation {
        workspace_id: WorkspaceId::from(String::from(ident)),
        label: Some(String::from(libelle)),
        agent_status: None,
        focused: None,
        number: None,
        pane_count: Some(2),
        tab_count: Some(1),
        active_tab_id: None,
        worktree: None,
    }
}

fn borne(photo: Snapshot) -> ObservationBorne {
    ObservationBorne {
        generation: 1,
        observe_a: Instant::now(),
        snapshot: photo,
    }
}

/// Deux panes dans un même tab, ordonnés par la disposition (le second est
/// en dessous du premier : y plus grand).
fn disposition(tab: &str, panes: &[&str]) -> PaneLayoutObservation {
    PaneLayoutObservation {
        tab_id: TabId::from(String::from(tab)),
        workspace_id: WorkspaceId::from(String::from("w1")),
        focused_pane_id: PaneId::from(String::from(panes[0])),
        panes: panes
            .iter()
            .enumerate()
            .map(|(index, pane)| domain::observation::LayoutPane {
                pane_id: PaneId::from(String::from(*pane)),
                focused: index == 0,
                rect: domain::observation::RectCell {
                    x: 0,
                    y: index as i64 * 40,
                    width: 200,
                    height: 40,
                },
            })
            .collect(),
    }
}

#[test]
fn le_worktree_lie_gagne_sur_le_cwd_du_pane() {
    // D02 : worktree lié OU cwd de pane — jamais deviné ; le worktree gagne.
    let mut atelier = workspace("w1", "atelier");
    atelier.worktree = Some(domain::observation::WorkspaceWorktree {
        checkout_path: String::from("/repos/atelier"),
        is_linked_worktree: true,
        repo_key: String::new(),
        repo_name: String::new(),
        repo_root: String::new(),
    });
    let photo = Snapshot {
        agents: vec![agent("p1", "t1", "w1", "pi")],
        workspaces: vec![atelier],
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &FauxSessions::default());
    assert_eq!(
        vue.workspaces[0].checkout_path.as_deref(),
        Some("/repos/atelier"),
        "le worktree lié gagne"
    );
}

#[test]
fn le_cwd_du_premier_pane_supplee_le_worktree_absent() {
    // Sans worktree lié, le premier cwd de pane du projet fait foi.
    let photo = Snapshot {
        agents: vec![agent("p1", "t1", "w1", "pi")],
        workspaces: vec![workspace("w1", "atelier")],
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &FauxSessions::default());
    assert_eq!(
        vue.workspaces[0].checkout_path.as_deref(),
        Some("/projets/atelier"),
        "le cwd du pane supplée le worktree"
    );
}

#[test]
fn un_workspace_sans_agent_reste_une_ligne() {
    // D02 : les compteurs sont conservés, même sans agents ni panes.
    let photo = Snapshot {
        agents: vec![],
        workspaces: vec![workspace("w1", "atelier"), workspace("w2", "archives")],
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &FauxSessions::default());
    assert!(
        vue.workspaces.len() == 2,
        "les projets vides restent des projets"
    );
    let atelier = &vue.workspaces[0];
    assert_eq!(atelier.label.as_deref(), Some("atelier"));
    assert_eq!(atelier.pane_count, 2);
    assert_eq!(atelier.tab_count, 1);
    assert!(atelier.agent_panes.is_empty(), "zéro agent visible");
    assert_eq!(
        atelier.checkout_path, None,
        "pas de dossier, pas de mensonge"
    );
}

#[test]
fn le_tri_etat_du_cwd_est_null_quand_un_terme_manque() {
    // D03 : quand le cwd Herdr manque, la correspondance n'est ni vraie ni
    // fausse — elle est non vérifiable.
    let mut photographe = agent("p1", "t1", "w1", "pi");
    let resolveur = FauxSessions::default().avec_source(
        "p1",
        source_chemin("/sessions/p1.jsonl", "/projets/atelier"),
    );
    let photo = Snapshot {
        agents: vec![photographe.clone()],
        workspaces: vec![workspace("w1", "atelier")],
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &resolveur);
    assert_eq!(
        vue.agents[0].session_cwd_matches,
        CwdMatch::Matched,
        "« /projets/atelier » dans les deux sources"
    );

    photographe.cwd = Some(String::from("/projets/autre"));
    let photo = Snapshot {
        agents: vec![photographe.clone()],
        workspaces: vec![workspace("w1", "atelier")],
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &resolveur);
    assert_eq!(vue.agents[0].session_cwd_matches, CwdMatch::Mismatched);

    photographe.cwd = None;
    let photo = Snapshot {
        agents: vec![photographe.clone()],
        workspaces: vec![workspace("w1", "atelier")],
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &resolveur);
    assert_eq!(
        vue.agents[0].session_cwd_matches,
        CwdMatch::Unverifiable,
        "manquant ≠ faux (D03)"
    );
}

#[test]
fn le_rang_vient_de_la_disposition_et_le_libelle_numerique_est_supprime() {
    // D04 : le rang = la place dans le tab (rect y, x, puis pane), jamais
    // déduit d'un identifiant ; « 1 » est le libellé par défaut, supprimé.
    let mut premier = agent("p1", "t1", "w1", "pi");
    let second = agent("p2", "t1", "w1", "cursor");
    premier.name = Some(domain::ids::AgentName::from(String::from("le-vérif")));
    let photo = Snapshot {
        agents: vec![premier.clone(), second],
        workspaces: vec![workspace("w1", "atelier")],
        tabs: Some(vec![TabObservation {
            tab_id: TabId::from(String::from("t1")),
            workspace_id: WorkspaceId::from(String::from("w1")),
            label: Some(String::from("1")),
            number: 1,
            agent_status: None,
            pane_count: Some(2),
        }]),
        layouts: Some(vec![disposition("t1", &["p1", "p2"])]),
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &FauxSessions::default());
    assert_eq!(
        vue.agents[0].pane_rank,
        Some(1),
        "p1 d'abord dans l'ordre de lecture"
    );
    assert_eq!(vue.agents[1].pane_rank, Some(2));
    assert_eq!(vue.agents[0].tab_pane_count, 2);
    assert_eq!(
        vue.agents[0].tab_label, None,
        "« 1 » est le libellé par défaut de Herdr — rien d'utile"
    );
    assert_eq!(vue.agents[1].tab_label, None);
}

#[test]
fn la_toast_sans_contexte_de_disposition_garde_l_agent_nomme() {
    // Sans dispositions (snapshot partiel), le nom choisi suffit : pas de
    // rang, un seul pane par défaut, l'agent reste étiquetté.
    let mut seul = agent("p1", "t1", "w1", "pi");
    seul.name = Some(domain::ids::AgentName::from(String::from("le-vérif")));
    let photo = Snapshot {
        agents: vec![seul.clone()],
        workspaces: vec![workspace("w1", "atelier")],
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &FauxSessions::default());
    assert_eq!(vue.agents[0].pane_rank, None);
    assert_eq!(vue.agents[0].tab_pane_count, 1);
    assert_eq!(
        vue.agents[0].name.as_ref().map(|n| n.as_str()),
        Some("le-vérif")
    );
}

#[test]
fn la_repartition_alimente_without_session_et_les_panes_d_agents() {
    // D05 : `withoutSession` = le NOMBRE des masqués ; les `agentPanes`
    // d'un projet ne lient que les agents VISIBLES.
    let mut muet = agent("p1", "t1", "w1", "cursor");
    muet.status = AgentStatus::Done;
    let actif = agent("p2", "t1", "w1", "pi");
    let faux_resolveur = FauxSessions::default().avec_source(
        "p2",
        source_chemin("/sessions/p2.jsonl", "/projets/atelier"),
    );
    let photo = Snapshot {
        agents: vec![muet.clone(), actif],
        workspaces: vec![workspace("w1", "atelier")],
        ..Snapshot::default()
    };
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &faux_resolveur);
    assert_eq!(
        vue.without_session, 1,
        "le cursor muet est compté, le pi visible non"
    );
    assert!(vue.agents.len() == 1 && vue.agents[0].pane_id.as_str() == "p2");
    assert!(
        vue.workspaces[0]
            .agent_panes
            .iter()
            .all(|pane| pane.as_str() == "p2"),
        "les agentPanes ne lient que les visibles"
    );
}

#[test]
fn la_version_et_le_protocole_amont_sont_ceux_de_l_observation() {
    let mut photo = Snapshot {
        agents: vec![],
        workspaces: vec![workspace("w1", "atelier")],
        ..Snapshot::default()
    };
    photo.provenance = Some(domain::observation::SnapshotProvenance {
        protocol: 22,
        version: String::from("0.9.3"),
    });
    let vue = ComposeurOverview::nouveau().compose(&borne(photo), &FauxSessions::default());
    assert_eq!(vue.herdr_protocol, 22);
    assert_eq!(vue.herdr_version, "0.9.3");
}
