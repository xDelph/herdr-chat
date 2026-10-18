//! États fermés : libellés exacts du fil, refus net de l'inconnu.

use domain::status::{AgentStatus, SessionState, etat_de_session, statut_d_agent};

#[test]
fn les_cinq_libelles_d_agent_sont_exactement_du_fil() {
    let paires: [(AgentStatus, &str); 5] = [
        (AgentStatus::Idle, "idle"),
        (AgentStatus::Working, "working"),
        (AgentStatus::Blocked, "blocked"),
        (AgentStatus::Done, "done"),
        (AgentStatus::Unknown, "unknown"),
    ];
    for (etat, libelle) in paires {
        match serde_json::to_string(&etat) {
            Ok(encodé) => assert_eq!(
                encodé,
                format!("\"{libelle}\""),
                "sérialisation de {libelle}"
            ),
            Err(cause) => panic!("encodage impossible pour {libelle}: {cause}"),
        }
        let brut = input_libelle(libelle);
        match serde_json::from_str::<AgentStatus>(&brut) {
            Ok(décodé) => assert_eq!(décodé, etat, "décodage de {libelle}"),
            Err(cause) => panic!("décodage impossible pour {libelle}: {cause}"),
        }
    }
}

fn input_libelle(libelle: &str) -> String {
    format!("\"{libelle}\"")
}

#[test]
fn un_etat_d_agent_inconnu_est_rejete_pas_devine() {
    let brut = input_libelle("gagné");
    if let Ok(deviné) = serde_json::from_str::<AgentStatus>(&brut) {
        panic!("l'état inconnu a été accepté : {deviné:?}");
    }
    // refus net : aucun état inventé
}

#[test]
fn les_etats_de_session_sont_une_union_fermée_exacte() {
    let paires: [(SessionState, &str); 3] = [
        (SessionState::Available, "available"),
        (SessionState::Absent, "absent"),
        (SessionState::Error, "error"),
    ];
    for (etat, libelle) in paires {
        match serde_json::to_string(&etat) {
            Ok(encodé) => assert_eq!(encodé, format!("\"{libelle}\"")),
            Err(cause) => panic!("encodage impossible pour {libelle}: {cause}"),
        }
        match etat_de_session(libelle) {
            Some(reconnu) => assert_eq!(reconnu, etat),
            None => panic!("libellé connu non reconnu : {libelle}"),
        }
    }
    if let Some(deviné) = etat_de_session("toujoursOccupé") {
        panic!("état inventé : {deviné:?}");
    }
    // correct : rien de supposé
}

#[test]
fn l_affichage_reproduit_le_libelle_du_fil() {
    assert_eq!(AgentStatus::Unknown.to_string(), "unknown");
    assert_eq!(AgentStatus::Blocked.to_string(), "blocked");
    assert_eq!(SessionState::Absent.to_string(), "absent");
}

#[test]
fn la_reconnaissance_totale_couvre_tous_les_etats() {
    for libelle in ["idle", "working", "blocked", "done", "unknown"] {
        match statut_d_agent(libelle) {
            Some(_) => (),
            None => panic!("'{libelle}' reconnu nulle part"),
        }
    }
    if let Some(deviné) = statut_d_agent("doneX") {
        panic!("libellé parasité accepté : {deviné:?}");
    }
}
