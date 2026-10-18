//! La règle de visibilité (D05) — quatre critères, chacun suffisant, et le
//! comptage des masqués (le `withoutSession` de l'accueil, jamais « chaque
//! fichier manquant »).

use application::visibilite::{attire_le_regard, est_visible, repartir_agents, type_lisible};
use domain::ids::{AgentKind, PaneId, TabId, WorkspaceId};
use domain::observation::{AgentObservation, AgentView, CwdMatch};
use domain::status::AgentStatus;

fn kind(s: &str) -> AgentKind {
    AgentKind::from(String::from(s))
}

fn vue(
    pane: &str,
    kind: Option<&str>,
    session_path: Option<&str>,
    status: AgentStatus,
) -> AgentView {
    AgentView {
        pane_id: PaneId::from(String::from(pane)),
        tab_id: TabId::from(String::from("t-1")),
        workspace_id: WorkspaceId::from(String::from("w1")),
        agent: kind.map(|k| AgentKind::from(String::from(k))),
        status,
        focused: false,
        name: None,
        title: None,
        cwd: None,
        tab_label: None,
        tab_number: None,
        workspace_label: None,
        pane_rank: None,
        tab_pane_count: 1,
        session_kind: None,
        session_path: session_path.map(ToOwned::to_owned),
        session_id: None,
        session_cwd: None,
        parent_session: None,
        session_cwd_matches: CwdMatch::Unverifiable,
    }
}

fn est(v: &AgentView) -> bool {
    est_visible(
        v.agent.as_ref(),
        v.session_path.as_deref(),
        v.status,
        v.tab_pane_count,
    )
}

#[test]
fn une_source_lisible_rend_l_agent_visible() {
    // Sources fichier (pi) et base (opencode) vues de la même façon : la
    // question est « y a-t-il une source ? », pas « est-ce un fichier ? ».
    assert!(est(&vue(
        "p1",
        Some("pi"),
        Some("/sessions/p1.jsonl"),
        AgentStatus::Idle
    )));
    assert!(est(&vue(
        "p2",
        Some("opencode"),
        Some("~/.opencode.db"),
        AgentStatus::Idle
    )));
}

#[test]
fn l_etat_demande_l_attention_avec_ou_sans_session() {
    // Un `blocked` SANS session est exactement l'agent qu'on doit voir.
    assert!(est(&vue("p1", Some("claude"), None, AgentStatus::Blocked)));
    assert!(est(&vue("p2", Some("claude"), None, AgentStatus::Working)));
    assert!(attire_le_regard(AgentStatus::Blocked));
    assert!(attire_le_regard(AgentStatus::Working));
}

#[test]
fn un_tab_a_plusieurs_panes_montre_tous_ses_verificateurs() {
    // Deux vérificateurs au repos, sans session : le tab est l'unité de
    // travail — on voit le tab entier.
    let mut verificateur = vue("p1", Some("pi"), None, AgentStatus::Done);
    verificateur.tab_pane_count = 5;
    assert!(est(&verificateur));
}

#[test]
fn un_type_a_lecture_verifiee_reste_visible_sans_session() {
    // Le plus faible des critères : codex a réellement travaillé mais Herdr
    // n'a pas publié sa session — on refuse qu'il disparaisse.
    assert!(est(&vue("p1", Some("codex"), None, AgentStatus::Done)));
    assert!(est(&vue("p2", Some("devin"), None, AgentStatus::Done)));
    assert!(type_lisible(Some(&kind("pi"))));
    assert!(type_lisible(Some(&kind("claude"))));
}

#[test]
fn un_type_illisible_et_silencieux_est_masque() {
    // Rien à montrer, rien à lire, aucun regard : masqué.
    assert!(!est(&vue("p1", Some("cursor"), None, AgentStatus::Done)));
    assert!(!est(&vue("p2", Some("cursor"), None, AgentStatus::Idle)));
    // Un type inconnu n'est pas un type lisible.
    assert!(!est(&vue("p3", Some("inconnu"), None, AgentStatus::Done)));
    assert!(!type_lisible(Some(&kind("cursor"))));
}

#[test]
fn une_chaine_de_source_vide_ne_compte_pas() {
    // Herdr peut exposer une chaîne vide pour « pas encore de fichier ».
    assert!(!est(&vue("p1", None, None, AgentStatus::Done)));
    assert!(!est(&vue("p2", None, Some(""), AgentStatus::Done)));
    let mut bloque = vue("p3", None, Some(""), AgentStatus::Blocked);
    assert!(est(&bloque), "blocked l'emporte");
    bloque.status = AgentStatus::Done;
    assert!(!est(&bloque));
}

#[test]
fn la_repartition_compte_les_masques_et_garde_les_visibles() {
    let avec = vue(
        "p1",
        Some("pi"),
        Some("/sessions/p1.jsonl"),
        AgentStatus::Idle,
    );
    let bloque = vue("p2", Some("claude"), None, AgentStatus::Blocked);
    let muet = vue("p3", Some("cursor"), None, AgentStatus::Done);
    let (visibles, masquees) = repartir_agents(&[avec.clone(), bloque.clone(), muet.clone()]);
    assert!(
        visibles.len() == 2 && masquees == 1,
        "{} visibles, {} masqués",
        visibles.len(),
        masquees
    );
    assert!(visibles[0].pane_id == avec.pane_id && visibles[1].pane_id == bloque.pane_id);
}

#[test]
fn l_agent_sans_champs_est_bien_un_agent() {
    // Borne de la construction : chaque champ garde sa place.
    let agent = AgentObservation {
        pane_id: PaneId::from(String::from("p1")),
        tab_id: TabId::from(String::from("t-1")),
        workspace_id: WorkspaceId::from(String::from("w1")),
        terminal_id: String::from("term"),
        revision: 1,
        status: AgentStatus::Unknown,
        focused: false,
        agent: Some(AgentKind::from(String::from("pi"))),
        name: None,
        terminal_title: None,
        cwd: Some(String::from("/projets/atelier")),
        foreground_cwd: None,
        completion_seq: None,
        state_change_seq: None,
        session: None,
    };
    assert!(type_lisible(agent.agent.as_ref()));
    assert!(agent.cwd.as_deref() == Some("/projets/atelier"));
}
