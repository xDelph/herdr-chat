//! Causes nommées : quatre verbatimes, pas un 502 indifférencié.

use domain::errors::{
    PortError, ReadCause, ReadVerdict, invalid_session, verdict_of, verdict_of_io,
};
use std::io::ErrorKind;

#[test]
fn chaque_cause_de_lecture_produit_le_verdict_exact_du_fil() {
    // VERDICTS (ReadCause.ts) : messages distincts, benign marqué vraiment.
    let attendus: [(ReadCause, &str, bool); 4] = [
        (ReadCause::Absente, "session absente", true),
        (ReadCause::Vide, "session vide", true),
        (ReadCause::Invalide, "session illisible", false),
        (ReadCause::Io, "session inaccessible", false),
    ];
    for (cause, message, benign) in attendus {
        let verdict = verdict_of(cause);
        let attendu = ReadVerdict {
            cause,
            message: message.to_string(),
            benign,
        };
        assert_eq!(verdict, attendu, "verdict divergent pour {message}");
    }
}

#[test]
fn les_libelles_filoires_des_causes_sont_verrouilles() {
    // L'orthographe rejoint `cause: Literals(["absente"…])` du fil actuel :
    // tout autre libellé est un écart de contrat.
    let paires: [(ReadCause, &str); 4] = [
        (ReadCause::Absente, "absente"),
        (ReadCause::Vide, "vide"),
        (ReadCause::Invalide, "invalide"),
        (ReadCause::Io, "io"),
    ];
    for (cause, libelle) in paires {
        match serde_json::to_string(&cause) {
            Ok(encodé) => assert_eq!(encodé, format!("\"{libelle}\"")),
            Err(cause_erreur) => panic!("encodage impossible : {cause_erreur}"),
        }
        match serde_json::from_str::<ReadCause>(&format!("\"{libelle}\"")) {
            Ok(retour) => assert_eq!(retour, cause),
            Err(cause_erreur) => panic!("décodage impossible pour {libelle}: {cause_erreur}"),
        }
    }
}

#[test]
fn la_session_illisible_porte_son_detail_et_n_est_pas_une_panne_reseau() {
    let verdict = invalid_session("ligne 12 : JSON tronqué");
    assert_eq!(verdict.cause, ReadCause::Invalide);
    assert!(!verdict.benign);
    assert_eq!(
        verdict.message,
        "session illisible (ligne 12 : JSON tronqué)"
    );
}

#[test]
fn le_fichier_manquant_est_une_session_absente_pas_un_io() {
    // `NotFound` est LA nature « ce fichier n'existe pas encore » : bénin.
    let not_found = std::io::Error::from(ErrorKind::NotFound);
    let verdict = verdict_of_io(&not_found);
    assert_eq!(verdict.cause, ReadCause::Absente);
    assert!(verdict.benign, "l'absence n'est pas une panne");
    assert_eq!(verdict.message, "session absente");
}

#[test]
fn la_permission_refusee_garde_io_et_son_message() {
    // EACCES / EPERM / ELOOP : un fichier là, mais non lisible — jamais
    // requalifié en « absente » : une session requalifiée fait chercher
    // ailleurs pour rien.
    let refuse = std::io::Error::from(ErrorKind::PermissionDenied);
    let verdict = verdict_of_io(&refuse);
    assert_eq!(verdict.cause, ReadCause::Io);
    assert!(!verdict.benign);
    assert_eq!(verdict.message, "session inaccessible");
}

#[test]
fn les_cinq_natures_de_port_sont_lisibles_avec_les_mots_du_monde() {
    let pannes: [PortError; 5] = [
        PortError::Upstream {
            code: "unsupported_event_wait_match".to_string(),
            message: "unknown match".to_string(),
        },
        PortError::Transport {
            detail: "socket fermé".to_string(),
        },
        PortError::Timeout,
        PortError::Unsupported {
            feature: "agent.ask".to_string(),
        },
        PortError::PathRejected {
            detail: "hors-racine".to_string(),
        },
    ];
    let attendus: [&str; 5] = [
        "upstream unsupported_event_wait_match: unknown match",
        "transport: socket fermé",
        "deadline exceeded",
        "unsupported: agent.ask",
        "path rejected: hors-racine",
    ];
    for (panne, attendu) in pannes.into_iter().zip(attendus.iter()) {
        let texte = panne.description();
        assert_eq!(texte.as_str(), *attendu, "description : {texte}");
        // Display == description : deux façons de lire le même réel.
        assert_eq!(panne.to_string(), texte);
    }
}

#[test]
fn une_decision_de_chemin_refuse_n_est_pas_une_panne_du_transport() {
    // PathRejected vit dans sa variante propre (S03) : la politique parle,
    // le transport n'est pas accusé.
    let refuse = PortError::PathRejected {
        detail: "lien-sortant".to_string(),
    };
    match refuse {
        PortError::PathRejected { detail } => assert_eq!(detail, "lien-sortant"),
        autre => panic!("la décision s'est transfigurée : {autre:?}"),
    }
}
