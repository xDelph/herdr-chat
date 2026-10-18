//! T055 — les diagnostics : forme de ligne, borne du détail, rédaction,
//! anti-répétition à fenêtre glissante (S11–S13).

use application::diagnostics::{
    AntiRepetition, DETAIL_MAX, EntreeDiagnostic, FENETRE_REPETITION_MS, Niveau, SinkDiagnostic,
    SinkMuet, iso_8601, ligne_de, tronque,
};

#[test]
fn le_libelle_du_niveau_est_celui_du_fil() {
    assert_eq!(Niveau::Error.libelle(), "ERROR");
    assert_eq!(Niveau::Warn.libelle(), "WARN");
    assert_eq!(Niveau::Info.libelle(), "INFO");
    assert_eq!(Niveau::depuis_libelle("error"), Some(Niveau::Error));
    assert_eq!(
        Niveau::depuis_libelle("fatal"),
        None,
        "un niveau inconnu n'est pas deviné"
    );
}

#[test]
fn l_horodatage_est_l_iso_du_fil() {
    assert_eq!(iso_8601(0), "1970-01-01T00:00:00.000Z");
    // 2026-10-18T20:35:04.942Z — le repère de la flotte.
    assert_eq!(iso_8601(1_792_355_704_942), "2026-10-18T20:35:04.942Z");
    // Une année bissextile, et le passage de mois.
    assert_eq!(iso_8601(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
    assert_eq!(iso_8601(1_735_689_599_000), "2024-12-31T23:59:59.000Z");
}

#[test]
fn la_ligne_a_la_forme_du_fil() {
    let entree = EntreeDiagnostic::nouvelle(Niveau::Error, "server", "Herdr injoignable");
    assert_eq!(
        ligne_de(&entree, 1_792_355_704_942),
        "2026-10-18T20:35:04.942Z [ERROR] [server] Herdr injoignable\n"
    );
    let avec_detail = entree.clone().avec_detail("{\"code\":42}".to_string());
    assert_eq!(
        ligne_de(&avec_detail, 0),
        "1970-01-01T00:00:00.000Z [ERROR] [server] Herdr injoignable | {\"code\":42}\n"
    );
}

#[test]
fn les_identifiants_internes_sont_retires_de_la_ligne() {
    // S13 : le journal est lu par un humain — « le nouvel onglet » plutôt que
    // `w1:p2`.
    let entree = EntreeDiagnostic::nouvelle(Niveau::Warn, "server", "no Herdr agent in pane w1:p2");
    let ligne = ligne_de(&entree, 0);
    assert!(!ligne.contains("w1:p2"), "{ligne}");
    assert!(ligne.contains("le nouvel onglet"), "{ligne}");
}

#[test]
fn le_detail_est_borne_jamais_rejete() {
    let long = "x".repeat(DETAIL_MAX + 500);
    let entree =
        EntreeDiagnostic::nouvelle(Niveau::Error, "client", "panne").avec_detail(long.clone());
    let detail = entree
        .detail
        .unwrap_or_else(|| panic!("le détail est conservé"));
    assert_eq!(detail.chars().count(), DETAIL_MAX);
    // Un accent n'est jamais coupé en deux : la borne est en caractères.
    let accents = "é".repeat(DETAIL_MAX + 10);
    assert_eq!(tronque(&accents, DETAIL_MAX).chars().count(), DETAIL_MAX);
    assert!(tronque(&accents, DETAIL_MAX).chars().all(|c| c == 'é'));
}

#[test]
fn la_cle_de_deduplication_ignore_le_detail() {
    let avec = EntreeDiagnostic::nouvelle(Niveau::Error, "server", "session absente")
        .avec_detail("pile 1".to_string());
    let sans = EntreeDiagnostic::nouvelle(Niveau::Error, "server", "session absente");
    // Deux piles différentes du même message sont LA MÊME erreur qui se
    // répète — le détail n'entre pas dans la clé.
    assert_eq!(avec.cle("/tmp/j.log"), sans.cle("/tmp/j.log"));
    assert_ne!(
        avec.cle("/tmp/j.log"),
        avec.cle("/tmp/autre.log"),
        "deux journaux ne se masquent pas"
    );
    assert_ne!(
        avec.cle("/tmp/j.log"),
        EntreeDiagnostic::nouvelle(Niveau::Warn, "server", "session absente").cle("/tmp/j.log"),
        "un niveau différent est une autre entrée"
    );
}

#[test]
fn l_anti_repetition_supprime_dans_la_fenetre() {
    let mut anti = AntiRepetition::nouveau();
    // La première passe (et annonce zéro répétition supprimée avant elle).
    assert_eq!(anti.autorise("k", 1_000, FENETRE_REPETITION_MS), Some(0));
    // Les suivantes tombent dans la fenêtre : supprimées.
    assert_eq!(anti.autorise("k", 2_000, FENETRE_REPETITION_MS), None);
    assert_eq!(anti.autorise("k", 30_000, FENETRE_REPETITION_MS), None);
    assert_eq!(anti.supprimees("k"), 2);
    // La fenêtre est GLISSANTE : chaque répétition repousse l'échéance.
    assert_eq!(anti.autorise("k", 31_000, FENETRE_REPETITION_MS), None);
    assert_eq!(anti.supprimees("k"), 3);
    // Après 60 s sans répétition, la même erreur repasse — avec le compte
    // des répétitions supprimées.
    assert_eq!(
        anti.autorise("k", 31_000 + FENETRE_REPETITION_MS, FENETRE_REPETITION_MS),
        Some(3)
    );
    assert_eq!(
        anti.supprimees("k"),
        0,
        "le compte est remis à zéro après annonce"
    );
}

#[test]
fn une_autre_cle_n_est_pas_supprimee() {
    let mut anti = AntiRepetition::nouveau();
    assert_eq!(anti.autorise("a", 0, FENETRE_REPETITION_MS), Some(0));
    assert_eq!(anti.autorise("b", 10, FENETRE_REPETITION_MS), Some(0));
    assert_eq!(anti.supprimees("a"), 0);
}

#[test]
fn le_puits_muet_ne_fait_rien_et_ne_rend_rien() {
    // Le contrat qui garantit qu'un journal ne change pas l'issue d'une
    // commande : la methode ne rend rien du tout.
    let puits = SinkMuet;
    puits.ecrit(&EntreeDiagnostic::nouvelle(
        Niveau::Error,
        "server",
        "peu importe",
    ));
    let _: () = ();
}

#[test]
fn le_detail_vide_reste_un_detail() {
    let entree =
        EntreeDiagnostic::nouvelle(Niveau::Info, "server", "info").avec_detail(String::new());
    assert_eq!(entree.detail.as_deref(), Some(""));
    assert!(ligne_de(&entree, 0).ends_with(" | \n"));
}
