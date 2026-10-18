//! Les profils de payload (T045, E07) : trois étiquettes distinctes, le
//! lien profond encodé, le nom composé hors de l'écran — rien d'inventé.

use notifications::payload::{
    IdentiteNotification, PayloadNotification, StatutDeFin, nom_de_notification,
    payload_de_notification,
};

fn identite() -> IdentiteNotification {
    IdentiteNotification {
        agent: Some(String::from("pi")),
        name: Some(String::from("atelier-2")),
        pane_rank: Some(2),
        tab_label: Some(String::from("onglet")),
        tab_number: Some(3),
        tab_pane_count: 2,
        title: Some(String::from("Projet atelier")),
        workspace_label: Some(String::from("atelier")),
    }
}

#[test]
fn le_payload_distingue_waiting_done_et_gone() {
    // E07 : « Agent needs you » / « Agent finished » / « Agent stopped » —
    // trois titres, trois corps, trois étiquettes distinctes.
    let en_attente = payload_de_notification("π", Some("wB:p16"), StatutDeFin::EnAttente);
    assert_eq!(en_attente.title, "Agent needs you");
    assert_eq!(en_attente.body, "π is waiting for your answer.");
    assert_eq!(en_attente.tag, "waiting-wB:p16");

    let fini = payload_de_notification("π", Some("wB:p16"), StatutDeFin::Fini);
    assert_eq!(fini.title, "Agent finished");
    assert_eq!(fini.body, "π has finished working.");
    assert_eq!(fini.tag, "done-wB:p16", "distinct de waiting");

    let disparu = payload_de_notification("π", Some("wB:p16"), StatutDeFin::Disparu);
    assert_eq!(disparu.title, "Agent stopped");
    assert_eq!(disparu.body, "π is no longer running.", "pas « fini »");
    assert_eq!(disparu.tag, "gone-wB:p16", "distinct de done");
}

#[test]
fn le_payload_sans_titre_reprend_la_phrase_generique() {
    let generique = payload_de_notification("", Some("wB:p16"), StatutDeFin::Fini);
    assert_eq!(generique.body, "Your agent has finished working.");
    let generique = payload_de_notification("", Some("wB:p16"), StatutDeFin::EnAttente);
    assert_eq!(generique.body, "An agent is waiting for your answer.");
    let generique = payload_de_notification("", Some("wB:p16"), StatutDeFin::Disparu);
    assert_eq!(generique.body, "An agent is no longer running.");
}

#[test]
fn le_lien_me_ne_a_l_agent_et_le_fragment_est_encode() {
    // E07 : le fragment est encodé — un paneId contient `:`.
    let lien = payload_de_notification("π", Some("wB:p16"), StatutDeFin::Fini);
    assert_eq!(lien.url, "/#/agent/wB%3Ap16");
    // Sans pane, l'accueil.
    let accueil = payload_de_notification("π", None, StatutDeFin::Fini);
    assert_eq!(accueil.url, "/");
    assert_eq!(accueil.tag, "herdr-agent");
}

#[test]
fn le_nom_se_compose_projet_onglet_pane_type() {
    let nom = nom_de_notification(Some(&identite()));
    assert_eq!(nom, "Projet atelier · onglet · atelier-2 · pi");
}

#[test]
fn le_nom_omet_ce_qui_manque_et_rien_d_invente() {
    let mut agent = identite();
    agent.title = None;
    agent.workspace_label = None;
    agent.tab_label = None;
    agent.tab_number = None;
    agent.name = None;
    agent.pane_rank = None;
    agent.tab_pane_count = 1;
    let nom = nom_de_notification(Some(&agent));
    assert_eq!(nom, "pi", "seul le type reste");
    // Sans agent du tout : vide, et le payload reprend le générique.
    assert_eq!(nom_de_notification(None), "");
}

#[test]
fn le_libelle_d_onglet_numerique_retombe_sur_le_numero() {
    let mut agent = identite();
    agent.tab_label = Some(String::from("2"));
    let nom = nom_de_notification(Some(&agent));
    assert!(
        nom.contains("tab 3"),
        "libellé numérique → numéro d'onglet : {nom}"
    );
}

#[test]
fn le_libelle_qui_repete_le_projet_est_ecarte() {
    let mut agent = identite();
    agent.tab_label = Some(String::from("atelier"));
    let nom = nom_de_notification(Some(&agent));
    assert!(
        !nom.contains("atelier · atelier"),
        "pas de répétition : {nom}"
    );
    assert!(nom.contains("tab 3"), "le numéro distingue : {nom}");
}

#[test]
fn le_pane_seul_dans_son_tab_n_a_pas_d_etiquette() {
    let mut agent = identite();
    agent.tab_pane_count = 1;
    let nom = nom_de_notification(Some(&agent));
    assert!(
        !nom.contains("atelier-2"),
        "un pane seul n'a pas besoin d'étiquette : {nom}"
    );
}

#[test]
fn la_vue_d_agent_se_reduit_sans_perte() {
    // IdentiteNotification::depuis_vue : le sous-ensemble structurel.
    let vue = domain::observation::AgentView {
        pane_id: domain::ids::PaneId::from(String::from("wB:p16")),
        tab_id: domain::ids::TabId::from(String::from("t1")),
        workspace_id: domain::ids::WorkspaceId::from(String::from("w1")),
        agent: Some(domain::ids::AgentKind::from(String::from("pi"))),
        status: domain::status::AgentStatus::Blocked,
        focused: false,
        name: Some(domain::ids::AgentName::from(String::from("atelier-2"))),
        title: Some(String::from("Projet atelier")),
        cwd: Some(String::from("/p")),
        tab_label: Some(String::from("onglet")),
        tab_number: Some(3),
        workspace_label: Some(String::from("atelier")),
        pane_rank: Some(2),
        tab_pane_count: 2,
        session_kind: None,
        session_path: Some(String::from("/s.jsonl")),
        session_id: None,
        session_cwd: None,
        parent_session: None,
        session_cwd_matches: domain::observation::CwdMatch::Unverifiable,
    };
    let identite = IdentiteNotification::depuis_vue(&vue);
    let nom = nom_de_notification(Some(&identite));
    assert_eq!(nom, "Projet atelier · onglet · atelier-2 · pi");
    let payload: PayloadNotification =
        payload_de_notification(&nom, Some("wB:p16"), StatutDeFin::EnAttente);
    assert_eq!(payload.title, "Agent needs you");
    assert_eq!(payload.url, "/#/agent/wB%3Ap16");
}
