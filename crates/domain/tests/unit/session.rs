//! Messages, réglages, raw : la forme commune et ses quatre conséquences.

use domain::session::{
    ChangePi, FilteredContext, LignePi, NormalizedEntry, ReglageKind, RetainedUnknown,
    SessionEntry, SessionMetadata, SessionPageOutcome,
};
use serde_json::json;

fn ligne_simple() -> LignePi {
    LignePi {
        kind: "message".to_string(),
        id: Some("n1".to_string()),
        timestamp: Some("2026-10-18T12:00:00Z".to_string()),
        message: domain::session::PiMessage {
            content: json!("Bonjour"),
            role: Some("user".to_string()),
            tool_name: None,
            phase: None,
            command: None,
            output: None,
            exit_code: None,
            cancelled: None,
            truncated: None,
            is_error: None,
            model: None,
            provider: None,
            thinking_level: None,
            custom_type: None,
            details: None,
        },
    }
}

#[test]
fn une_ligne_pi_tourne_en_cameland_sans_perdre_ses_champs() {
    let ligne = ligne_simple();
    match serde_json::to_string(&ligne) {
        Ok(encodé) => {
            // clef filaire de l'entrée type "type" ; les champs du message
            // sont en camelCase (toolName, thinkingLevel) — la compat pi.
            assert!(
                encodé.contains("\"type\":\"message\""),
                "clef `type` perdue : {encodé}"
            );
            assert!(
                encodé.contains("\"toolName\""),
                "camelCase perdu : {encodé}"
            );
            assert!(
                encodé.contains("\"content\":\"Bonjour\""),
                "contenu perdu : {encodé}"
            );
            if let Ok(retour) = serde_json::from_str::<LignePi>(&encodé) {
                assert_eq!(retour, ligne);
            } else {
                panic!("la ligne encodée n'a pas pu être relue");
            }
        }
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
}

#[test]
fn les_renseignements_portes_par_chaque_message_tourisent() {
    // Modèle, fournisseur et niveau portés PAR chaque message (cinq
    // sources mesurées) : blessés pour un model_change seul.
    let ligne = LignePi {
        kind: "message".to_string(),
        id: None,
        timestamp: None,
        message: domain::session::PiMessage {
            content: json!([]),
            role: Some("assistant".to_string()),
            tool_name: None,
            phase: None,
            command: None,
            output: None,
            exit_code: None,
            cancelled: None,
            truncated: None,
            is_error: None,
            model: Some("glm-5".to_string()),
            provider: Some("zai".to_string()),
            thinking_level: Some("high".to_string()),
            custom_type: None,
            details: None,
        },
    };
    match serde_json::to_string(&ligne) {
        Ok(encodé) => {
            assert!(encodé.contains("\"model\":\"glm-5\""));
            assert!(encodé.contains("\"provider\":\"zai\""));
            assert!(
                encodé.contains("\"thinkingLevel\":\"high\""),
                "camelCase du niveau perdu : {encodé}"
            );
        }
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
}

#[test]
fn un_changement_de_reglage_ne_passe_pas_pour_un_message() {
    let model = ChangePi {
        kind: ReglageKind::ModelChange,
        model_id: Some("glm-5".to_string()),
        provider: Some("zai".to_string()),
        thinking_level: None,
        timestamp: None,
    };
    let niveau = ChangePi {
        kind: ReglageKind::ThinkingLevelChange,
        model_id: None,
        provider: None,
        thinking_level: Some("high".to_string()),
        timestamp: Some("2026-10-18T12:00:00Z".to_string()),
    };
    match serde_json::to_string(&model) {
        Ok(encodé) => assert!(
            encodé.contains("\"type\":\"model_change\""),
            "libellé fil perdu : {encodé}"
        ),
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
    match serde_json::to_string(&niveau) {
        Ok(encodé) => assert!(
            encodé.contains("\"type\":\"thinking_level_change\"")
                && encodé.contains("\"thinkingLevel\":\"high\""),
            "forme filaire fausse : {encodé}"
        ),
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
}

#[test]
fn le_normalisateur_ne_rend_que_quatre_consequences_toutes_nommees() {
    // Preuve d'exhaustivité : match SANS joker — ajouter un cas casse la
    // compilation du test jusqu'à traitement.
    let lignes = vec![
        NormalizedEntry::Message(Box::new(ligne_simple())),
        NormalizedEntry::Settings(ChangePi {
            kind: ReglageKind::ModelChange,
            model_id: None,
            provider: None,
            thinking_level: None,
            timestamp: None,
        }),
        NormalizedEntry::Unknown(RetainedUnknown {
            raw: json!({"mystère": true}),
        }),
        NormalizedEntry::Filtered(FilteredContext),
    ];
    let mut vues = 0_u32;
    for ligne in lignes {
        match ligne {
            NormalizedEntry::Message(m) => {
                assert_eq!(m.kind, "message");
                vues += 1;
            }
            NormalizedEntry::Settings(r) => {
                assert_eq!(r.kind, ReglageKind::ModelChange);
                vues += 1;
            }
            NormalizedEntry::Unknown(_) => vues += 1,
            NormalizedEntry::Filtered(_) => vues += 1,
        }
    }
    assert_eq!(vues, 4_u32);
}

#[test]
fn une_entree_de_session_conserve_le_raw_et_les_clefs_du_fil() {
    let entree = SessionEntry {
        kind: "bash".to_string(),
        id: Some("n2".to_string()),
        parent_id: Some("n1".to_string()),
        raw: "{\"type\":\"bash\"}".to_string(),
        timestamp: None,
    };
    match serde_json::to_string(&entree) {
        Ok(encodé) => {
            assert!(
                encodé.contains("\"type\":\"bash\""),
                "clef filaire absente : {encodé}"
            );
            assert!(
                encodé.contains("\"parentId\":\"n1\""),
                "clef `parentId` absente : {encodé}"
            );
            assert!(encodé.contains("\"raw\":"));
        }
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
}

#[test]
fn une_page_de_session_ne_tient_que_cinq_conclusions() {
    // B03 : absente / vide / invalide / io / page — TOUTES nommées, pas un
    // 502 indifférencié. Match sans joker : exhaustive par compilation.
    let conclusions = vec![
        SessionPageOutcome::Absente(domain::session::SessionPage {
            session_path: "/sessions/pi/wx.jsonl".to_string(),
            entries: Vec::new(),
            incremental: false,
            cursor: None,
            previous_cursor: None,
            has_more: false,
            reset: false,
            rattrape: false,
        }),
        SessionPageOutcome::Vide(domain::session::SessionPage {
            session_path: "/sessions/pi/wx.jsonl".to_string(),
            entries: Vec::new(),
            incremental: false,
            cursor: None,
            previous_cursor: None,
            has_more: false,
            reset: false,
            rattrape: false,
        }),
        SessionPageOutcome::Invalide {
            detail: String::from("ligne tronquée"),
        },
        SessionPageOutcome::Io {
            detail: String::from("permission refusée"),
        },
        SessionPageOutcome::Page(domain::session::SessionPage {
            session_path: "/sessions/pi/wx.jsonl".to_string(),
            entries: Vec::new(),
            incremental: false,
            cursor: None,
            previous_cursor: None,
            has_more: false,
            reset: false,
            rattrape: true,
        }),
    ];
    let mut vues = 0_u32;
    for cause in conclusions {
        match cause {
            SessionPageOutcome::Absente(_)
            | SessionPageOutcome::Vide(_)
            | SessionPageOutcome::Invalide { .. }
            | SessionPageOutcome::Io { .. }
            | SessionPageOutcome::Page(_) => vues += 1,
        }
    }
    assert_eq!(vues, 5_u32);
}

#[test]
fn une_metadonnee_sans_declaration_est_toujours_absente() {
    // D18 : absent = absent. Ni modèle supposé, ni horodatage à 0.
    let vide = SessionMetadata::default();
    assert!(vide.model.is_none());
    assert!(vide.provider.is_none());
    assert!(vide.thinking.is_none());
    assert!(vide.last_prompt.is_none());
    assert!(vide.preview.is_none());
    assert!(vide.timestamp.is_none());
}
