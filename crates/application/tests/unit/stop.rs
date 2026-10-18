//! Le service d'arrêt (T036/A04) : observation fraîche à chaque appel,
//! Ctrl+C seulement `working`, absent ≠ no-op, transmis ≠ arrêt prouvé.

use application::commands::stop::{ArreteurAgent, ErreurArret, IssueArret};
use domain::errors::PortError;
use domain::ids::{PaneId, TabId, WorkspaceId};
use domain::observation::{AgentObservation, Snapshot};
use domain::status::AgentStatus;
use test_support::fake_herdr::{HerdrFaux, Op};

fn cible() -> PaneId {
    PaneId::from(String::from("wA:p1"))
}

fn agent(pane: &str, status: AgentStatus) -> AgentObservation {
    AgentObservation {
        pane_id: PaneId::from(String::from(pane)),
        tab_id: TabId::from(String::from("t-sim")),
        workspace_id: WorkspaceId::from(String::from("w-sim")),
        terminal_id: String::from("term-sim"),
        revision: 1,
        status,
        focused: false,
        agent: None,
        name: None,
        terminal_title: None,
        cwd: None,
        foreground_cwd: None,
        completion_seq: None,
        state_change_seq: None,
        session: None,
    }
}

fn photo(agents: Vec<AgentObservation>) -> Snapshot {
    Snapshot {
        agents,
        ..Snapshot::default()
    }
}

#[test]
fn l_agent_absent_est_une_erreur_pas_un_no_op() {
    // A04 : aucun agent dans le pane = 404 — jamais un « not-running ».
    let faux = HerdrFaux::nouveau(); // snapshot vide par défaut
    match ArreteurAgent::nouveau().arrete(&faux, &cible()) {
        Err(ErreurArret::AgentAbsent { cible: pane }) => {
            assert!(pane.as_str() == "wA:p1", "la cible est celle de l'appel");
        }
        Err(autre) => panic!("agent absent attendu, pas {autre:?}"),
        Ok(issue) => panic!("un pane vide ne no-op pas : {issue:?}"),
    }
    assert!(
        faux.actions().len() == 1,
        "seul le snapshot a été demandé, pas l'arrêt"
    );
}

#[test]
fn l_agent_d_un_autre_pane_n_est_pas_le_sien() {
    // Un agent voisin ne remplace jamais la cible (A01 : cible exacte).
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo(vec![agent("wA:p2", AgentStatus::Working)]));
    match ArreteurAgent::nouveau().arrete(&faux, &cible()) {
        Err(ErreurArret::AgentAbsent { cible }) => {
            assert!(cible.as_str() == "wA:p1", "la cible reste wA:p1");
        }
        Err(autre) => panic!("agent absent attendu, pas {autre:?}"),
        Ok(issue) => panic!("un voisin ne s'arrête pas : {issue:?}"),
    }
}

#[test]
fn le_non_working_est_un_no_op_sans_envoi() {
    // A04 : nonworking no-op — aucun Ctrl+C ne part pour un agent au repos.
    for statut in [
        AgentStatus::Idle,
        AgentStatus::Blocked,
        AgentStatus::Done,
        AgentStatus::Unknown,
    ] {
        let faux = HerdrFaux::nouveau();
        faux.repond_snapshot(photo(vec![agent("wA:p1", statut)]));
        match ArreteurAgent::nouveau().arrete(&faux, &cible()) {
            Ok(IssueArret::NonEnCours) => (),
            Ok(issue) => panic!("no-op attendu, pas {issue:?}"),
            Err(erreur) => panic!("un agent au repos n'échoue pas : {erreur:?}"),
        }
        assert!(
            faux.actions().iter().all(|action| action.op != Op::Arret),
            "aucun envoi pour un agent non working (statut {statut:?})"
        );
    }
}

#[test]
fn working_envoie_l_interruption_sans_prouver_l_arret() {
    // A04 : working → Ctrl+C transmis ; « interrupt-sent » ne prouve rien.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo(vec![agent("wA:p1", AgentStatus::Working)]));
    match ArreteurAgent::nouveau().arrete(&faux, &cible()) {
        Ok(IssueArret::InterruptEnvoye) => (),
        Ok(issue) => panic!("interrupt-sent attendu, pas {issue:?}"),
        Err(erreur) => panic!("working s'arrête : {erreur:?}"),
    }
    let actions = faux.actions();
    assert!(
        actions.len() == 2,
        "snapshot puis arrêt : {} actions",
        actions.len()
    );
    assert!(
        actions[0].op == Op::Snapshot && actions[1].op == Op::Arret,
        "l'ordre : snapshot PUIS interruption — {:?}",
        actions
    );
    assert!(
        actions[1].cible == "wA:p1",
        "l'interruption vise la cible de l'appel : {:?}",
        actions[1]
    );
    // Le détail du faux dit « interruption demandée » — une transmission,
    // jamais « arrêté ».
    assert!(actions[1].detail == "interruption demandée");
}

#[test]
fn la_course_entre_photo_et_envoi_est_un_no_op() {
    // L'agent a fini entre la photo (working) et l'envoi : le port répond
    // `NotRunning` — rien à interrompre, dit tel quel (pas un faux envoi).
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo(vec![agent("wA:p1", AgentStatus::Working)]));
    faux.repond_arret(domain::ports::StopEvidence::NotRunning);
    match ArreteurAgent::nouveau().arrete(&faux, &cible()) {
        Ok(IssueArret::NonEnCours) => (),
        Ok(issue) => panic!("la course = rien à interrompre, pas {issue:?}"),
        Err(erreur) => panic!("la course est une valeur, pas une panne : {erreur:?}"),
    }
}

#[test]
fn la_transmission_echouee_est_portee_avec_sa_cause() {
    // Le snapshot a réussi (working), la transmission échoue : la cause
    // réelle est portée, jamais masquée (502 au fil).
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo(vec![agent("wA:p1", AgentStatus::Working)]));
    faux.panne_sur(
        Op::Arret,
        PortError::Transport {
            detail: String::from("prise interrupteur débranchée"),
        },
    );
    match ArreteurAgent::nouveau().arrete(&faux, &cible()) {
        Err(ErreurArret::Transmission { cible, detail }) => {
            assert!(cible.as_str() == "wA:p1");
            assert!(
                detail.contains("prise interrupteur débranchée"),
                "la cause passe telle quelle : {detail}"
            );
        }
        Err(autre) => panic!("transmission attendue, pas {autre:?}"),
        Ok(issue) => panic!("une panne d'envoi n'est pas un succès : {issue:?}"),
    }
}

#[test]
fn le_snapshot_indisponible_est_distinct_de_l_illisible() {
    // Les deux causes restent nommées (le fil a deux messages distincts) :
    // l'amont indisponible n'est pas une enveloppe illisible.
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Upstream {
        code: String::from("snapshot_failed"),
        message: String::from("amont injoignable"),
    });
    match ArreteurAgent::nouveau().arrete(&faux, &cible()) {
        Err(ErreurArret::SnapshotIndisponible { detail }) => {
            assert!(
                detail.contains("amont injoignable"),
                "la cause amont passe : {detail}"
            );
        }
        Err(autre) => panic!("indisponible attendu, pas {autre:?}"),
        Ok(issue) => panic!("une panne amont n'est pas un succès : {issue:?}"),
    }
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Transport {
        detail: String::from("enveloppe tronquée"),
    });
    match ArreteurAgent::nouveau().arrete(&faux, &cible()) {
        Err(ErreurArret::SnapshotIllisible { detail }) => {
            assert!(
                detail == "enveloppe tronquée",
                "la cause d'enveloppe passe : {detail}"
            );
        }
        Err(autre) => panic!("illisible attendu, pas {autre:?}"),
        Ok(issue) => panic!("une enveloppe illisible n'est pas un succès : {issue:?}"),
    }
}

#[test]
fn l_observation_est_fraiche_a_chaque_appel() {
    // A04 : aucune photo mise en cache — le second appel relit le snapshot.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo(vec![agent("wA:p1", AgentStatus::Working)]));
    let service = ArreteurAgent::nouveau();
    match service.arrete(&faux, &cible()) {
        Ok(IssueArret::InterruptEnvoye) => (),
        issue => panic!("premier appel : working, {issue:?}"),
    }
    // L'agent a fini entre les deux appels : le snapshot suivant le dit.
    faux.repond_snapshot(photo(vec![agent("wA:p1", AgentStatus::Done)]));
    match service.arrete(&faux, &cible()) {
        Ok(IssueArret::NonEnCours) => (),
        issue => panic!("second appel : relit l'état frais, {issue:?}"),
    }
    let actions = faux.actions();
    assert!(
        actions.len() == 3,
        "deux snapshots et un seul envoi : {:?}",
        actions
    );
    assert!(
        actions[0].op == Op::Snapshot
            && actions[1].op == Op::Arret
            && actions[2].op == Op::Snapshot,
        "l'ordre prouve la relecture : {:?}",
        actions
    );
}
