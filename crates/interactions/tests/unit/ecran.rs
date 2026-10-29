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

/// La question `AskUserQuestion` de Claude Code (2.1.312), reconstituée
/// d'après son rendu lu dans le binaire (`iZ`, `kk`, sélecteur `compact-
/// vertical`) : barre d'onglets, question repliée sur deux lignes, curseur
/// `❯`, description sous chaque choix, saisie libre « Type something. »,
/// séparateur, « Chat about this », pied d'aide.
pub(crate) const ECRAN_CLAUDE: &str = concat!(
    "────────────────────────────────────────────────────────────────────\n",
    " ←  ☐ Environment   ✔ Submit  →\n",
    "\n",
    "I can't get past the maintenance page. Locally, the backend rejects the\n",
    "publishable key. Which environment should I browse?\n",
    "\n",
    "❯ 1. Production (I'll give password)\n",
    "     Browse atcrea.fr with the maintenance password.\n",
    "  2. Local\n",
    "     Fix the publishable key first.\n",
    "  3. Type something.\n",
    "────────────────────────────────────────────────────────────────────\n",
    "  4. Chat about this\n",
    "\n",
    "Enter to select · ↑/↓ to navigate · Esc to cancel\n",
);

#[test]
fn la_question_de_claude_se_lit_avec_son_curseur() {
    let question = question_de_l_ecran(ECRAN_CLAUDE)
        .unwrap_or_else(|| panic!("la question de Claude doit se lire (curseur ❯)"));
    // La question repliée est lue EN ENTIER, pas sa dernière ligne.
    assert_eq!(
        question.texte,
        "I can't get past the maintenance page. Locally, the backend rejects the publishable key. Which environment should I browse?"
    );
    let libelles: Vec<&str> = question.choix.iter().map(|c| c.libelle.as_str()).collect();
    assert_eq!(
        libelles,
        vec![
            "Production (I'll give password)",
            "Local",
            "Type something.",
            "Chat about this"
        ]
    );
    assert!(question.choix[0].selectionne, "le ❯ est le curseur");
    assert_eq!(
        question.choix[0].detail.as_deref(),
        Some("Browse atcrea.fr with the maintenance password.")
    );
    assert!(est_option_saisie_libre("Type something."));
    assert!(
        question
            .invite
            .is_some_and(|invite| invite.starts_with("Enter to select"))
    );
}

/// Le sélecteur des extensions de pi (`extension-selector.js`) : cadre,
/// titre, description, options NON numérotées avec le curseur `→`, aide.
pub(crate) fn ecran_pi(curseur: usize) -> String {
    let options = ["Deploy to staging", "Deploy to production", "Cancel"];
    let mut lignes = vec![
        String::from("previous agent output"),
        String::from("────────────────────────────────────────"),
        String::new(),
        String::from(" Where should I deploy?"),
        String::new(),
        String::from(" The build passed on main."),
        String::new(),
    ];
    for (rang, option) in options.iter().enumerate() {
        lignes.push(if rang == curseur {
            format!(" → {option}")
        } else {
            format!("   {option}")
        });
    }
    lignes.extend([
        String::new(),
        String::from(" ↑↓ navigate  enter select  esc cancel"),
        String::new(),
        String::from("────────────────────────────────────────"),
    ]);
    lignes.join("\n")
}

#[test]
fn le_selecteur_de_pi_sans_numeros_se_lit() {
    use interactions::ecran::Navigation;
    let question = question_de_l_ecran(&ecran_pi(0))
        .unwrap_or_else(|| panic!("le sélecteur de pi doit se lire"));
    assert_eq!(
        question.texte,
        "Where should I deploy? — The build passed on main."
    );
    let libelles: Vec<&str> = question.choix.iter().map(|c| c.libelle.as_str()).collect();
    assert_eq!(
        libelles,
        vec!["Deploy to staging", "Deploy to production", "Cancel"]
    );
    assert_eq!(
        question.choix.iter().map(|c| c.numero).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert!(question.choix[0].selectionne);
    assert_eq!(question.navigation, Navigation::Fleches);
    // Rien au-dessus du cadre (la sortie précédente de l'agent) n'est lu.
    assert!(!question.texte.contains("previous agent output"));
}
