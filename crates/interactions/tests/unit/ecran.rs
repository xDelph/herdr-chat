//! La lecture d'une question à l'écran (T032) : le filet d'opencode, les
//! détails sur la même ligne ou la suivante, la numérotation contiguë, les
//! lignes de contexte/invite, la saisie libre.
//! Prouve : A11.

use interactions::ecran::{Choix, est_option_saisie_libre, question_de_l_ecran};

/// L'écran opencode MESURÉ (2026-10-16, agent réellement bloqué) — la
/// citation du fil était abrégée : les choix intermédiaires 2–4 existent
/// (le 5 l'exige, la contiguïté est la règle).
const ECRAN_OPENCODE: &str = "  ┃  Questions\n\
                               ┃\n\
                               ┃  I don't see a report in your message… — how would you like to share it?\n\
                               ┃\n\
                               ┃  1. It's a file on disk\n\
                               ┃     Tell me the file path…\n\
                               ┃  2. Paste it as text\n\
                               ┃  3. Share via a link\n\
                               ┃  4. Not now\n\
                               ┃  5. Type your own answer\n\
                               ┃\n\
                               ┃  ↑↓ select  enter submit  esc dismiss\n";

#[test]
fn l_ecran_opencode_avec_son_filet_se_lit() {
    let question = question_de_l_ecran(ECRAN_OPENCODE)
        .unwrap_or_else(|| panic!("l'écran opencode du corpus doit se lire"));
    assert!(
        question.texte.contains("how would you like to share it?"),
        "la question porte : {}",
        question.texte
    );
    assert!(
        question.choix.len() == 5,
        "cinq choix numérotés contigus : {}",
        question.choix.len()
    );
    // Le détail du PREMIER choix est sur la LIGNE SUIVANTE (indentée).
    match &question.choix[0].detail {
        Some(detail) => assert!(
            detail.contains("Tell me the file path"),
            "le détail suivant : {detail}"
        ),
        None => panic!("le détail sur la ligne suivante doit être lu"),
    }
    // Le choix de saisie libre est reconnu — et NE SE FAIT PAS répondeur.
    let libre = &question.choix[4];
    assert!(
        libre.numero == 5,
        "le numéro opencode est 5 : {}",
        libre.numero
    );
    assert!(
        est_option_saisie_libre(&libre.libelle),
        "« Type your own answer » reconnu"
    );
    // L'invite de validation porte (la forme ↑↓ sans barre, mesurée).
    match &question.invite {
        Some(invite) => assert!(invite.contains("enter submit"), "l'invite : {invite}"),
        None => panic!("l'invite ↑↓ select… doit se lire"),
    }
}

#[test]
fn le_detail_sur_la_même_ligne_se_lit_deux_fois_facon() {
    // La forme pi/codex : le détail APRÈS un trou de 2+ espaces sur la
    // même ligne — le DERNIER trou qui laisse un texte des deux côtés.
    let ecran =
        "Veux-tu continuer maintenant ?\n1. Oui  va sans dire\n2. Non  attends\nenter to submit\n";
    let question =
        question_de_l_ecran(ecran).unwrap_or_else(|| panic!("l'écran pi/codex doit se lire"));
    assert!(question.choix.len() == 2);
    match &question.choix[0] {
        Choix {
            libelle,
            detail: Some(detail),
            ..
        } => {
            assert!(
                libelle == "Oui" && detail == "va sans dire",
                "libellé/détail : {libelle}/{detail}"
            );
        }
        autre => panic!("le détail de même ligne : {autre:?}"),
    }
}

#[test]
fn la_numérotation_incohérente_n_est_pas_une_invite() {
    // Une sortie d'outil qui contient des « 1. » « 2. » non contigus n'est
    // PAS une question — aucune action n'en émane.
    let ecran = "1. fichier un\n2. fichier deux\n9. fichier neuf\n";
    assert!(
        question_de_l_ecran(ecran).is_none(),
        "la numérotation doit être 1..n"
    );
    // UN seul choix : pas une invite.
    assert!(question_de_l_ecran("1. seul\nenter\n").is_none());
    // Pas de choix du tout : rien.
    assert!(question_de_l_ecran("aucune question ici").is_none());
}

#[test]
fn les_lignes_de_contexte_et_de_champ_se_classent() {
    // `App: Zen` = contexte ; `Field 1/1` = position — en retrait dans la
    // réponse, jamais pris pour la question.
    let ecran = "Veux-tu l'exécuter ?\nApp: Zen\nField 1/2\n1. Allow once\n2. Deny\nenter submit\n";
    let question = question_de_l_ecran(ecran)
        .unwrap_or_else(|| panic!("l'écran codex avec contexte doit se lire"));
    assert!(
        question.texte.contains("Veux-tu l'exécuter"),
        "la question : {}",
        question.texte
    );
    assert!(
        question.contexte.contains(&String::from("App: Zen"))
            && question.contexte.contains(&String::from("Field 1/2")),
        "le contexte en retrait : {:?}",
        question.contexte
    );
}

#[test]
fn la_garde_numero_offert_protège_du_hasard() {
    let choix = vec![
        Choix {
            libelle: String::from("Oui"),
            detail: None,
            numero: 1,
            selectionne: false,
        },
        Choix {
            libelle: String::from("Non"),
            detail: None,
            numero: 2,
            selectionne: true,
        },
    ];
    assert!(interactions::repondre::numero_offert(&choix, 1));
    assert!(
        !interactions::repondre::numero_offert(&choix, 3),
        "le 3 n'a jamais été proposé"
    );
    assert!(
        !interactions::repondre::numero_offert(&choix, 0),
        "pas de touche devinée"
    );
    assert!(
        !interactions::repondre::numero_offert(&choix, -1),
        "pas de négatif"
    );
}
