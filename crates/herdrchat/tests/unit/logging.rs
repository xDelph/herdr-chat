//! T055 — le journal réel : rotation à 4 MiB, anti-répétition annoncée,
//! échec d'écriture sur stderr, chemin injecté (jamais celui de l'utilisateur).

use application::diagnostics::{EntreeDiagnostic, FENETRE_REPETITION_MS, Niveau, SinkDiagnostic};
use herdrchat::logging::{Journal, MAX_OCTETS};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// Un dossier de test isolé — jamais le journal de l'utilisateur (A03).
fn dossier() -> std::path::PathBuf {
    let unique = format!(
        "herdr-journal-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let chemin = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&chemin).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    chemin
}

fn lit(chemin: &std::path::Path) -> String {
    std::fs::read_to_string(chemin).unwrap_or_else(|cause| panic!("lecture : {cause}"))
}

#[test]
fn une_entree_s_ecrit_au_format_du_fil() {
    let racine = dossier();
    let journal = Journal::nouveau(racine.join("herdr-remote.log"));
    journal.ecrit(&EntreeDiagnostic::nouvelle(
        Niveau::Error,
        "server",
        "Herdr injoignable",
    ));
    let contenu = lit(journal.chemin());
    assert!(
        contenu.ends_with(" [ERROR] [server] Herdr injoignable\n"),
        "{contenu}"
    );
    // L'horodatage est l'ISO du fil (secondes et millisecondes).
    assert!(contenu.contains('T') && contenu.contains('Z'), "{contenu}");
    assert!(contenu.contains(" [ERROR] "), "{contenu}");
    assert_eq!(journal.ecrites(), 1);
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn le_detail_est_ecrit_et_borne() {
    let racine = dossier();
    let journal = Journal::nouveau(racine.join("j.log"));
    let long = "y".repeat(5000);
    journal.ecrit(&EntreeDiagnostic::nouvelle(Niveau::Warn, "client", "panne").avec_detail(long));
    let contenu = lit(journal.chemin());
    assert!(contenu.contains(" | "), "{contenu}");
    // 2000 caractères au plus, plus la ligne elle-même.
    assert!(contenu.chars().count() < 2200, "détail borné");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn la_repetition_est_supprimee_puis_annoncee() {
    let racine = dossier();
    let horloge = Arc::new(AtomicU64::new(1_000));
    let compteur = Arc::clone(&horloge);
    let journal = Journal::avec_horloge(
        racine.join("j.log"),
        Box::new(move || compteur.load(Ordering::SeqCst)),
    );
    let entree = EntreeDiagnostic::nouvelle(Niveau::Error, "server", "session absente");
    journal.ecrit(&entree);
    // Trois répétitions dans la fenêtre : supprimées, pas écrites.
    for _ in 0..3 {
        horloge.fetch_add(5_000, Ordering::SeqCst);
        journal.ecrit(&entree);
    }
    assert_eq!(journal.ecrites(), 1);
    assert_eq!(journal.supprimees(), 3);
    assert_eq!(lit(journal.chemin()).lines().count(), 1);
    // Après la fenêtre, la même erreur réapparaît — avec le compte.
    horloge.fetch_add(FENETRE_REPETITION_MS, Ordering::SeqCst);
    journal.ecrit(&entree);
    let contenu = lit(journal.chemin());
    assert_eq!(contenu.lines().count(), 2);
    assert!(contenu.contains("3 repetitions supprimees"), "{contenu}");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn la_rotation_garde_une_generation() {
    let racine = dossier();
    let chemin = racine.join("j.log");
    std::fs::write(
        &chemin,
        vec![b'x'; usize::try_from(MAX_OCTETS).unwrap_or(4_000_000) + 10],
    )
    .unwrap_or_else(|cause| panic!("écriture : {cause}"));
    let journal = Journal::nouveau(&chemin);
    journal.ecrit(&EntreeDiagnostic::nouvelle(
        Niveau::Info,
        "server",
        "après rotation",
    ));
    // La génération précédente existe, et le courant est NEUF.
    let ancien = racine.join("j.log.1");
    assert!(ancien.exists(), "le fichier trop gros est renommé en .1");
    let contenu = lit(&chemin);
    assert!(contenu.contains("après rotation"), "{contenu}");
    assert!(contenu.len() < 1000, "le courant repart de zéro");
    // Le `.1` fait la taille d'origine — on ne perd pas la génération.
    let taille = std::fs::metadata(&ancien)
        .unwrap_or_else(|cause| panic!("taille : {cause}"))
        .len();
    assert!(taille > MAX_OCTETS);
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_chemin_impraticable_ne_panique_pas() {
    // Le dossier parent est un FICHIER : la création du dossier échoue. Le
    // journal doit l'avaler (et le dire sur stderr) — jamais casser le
    // service.
    let racine = dossier();
    let fichier = racine.join("pas-un-dossier");
    std::fs::write(&fichier, b"x").unwrap_or_else(|cause| panic!("écriture : {cause}"));
    let journal = Journal::nouveau(fichier.join("j.log"));
    journal.ecrit(&EntreeDiagnostic::nouvelle(
        Niveau::Error,
        "server",
        "panne",
    ));
    assert_eq!(
        journal.ecrites(),
        0,
        "rien n'a pu s'écrire, et rien n'a levé"
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn le_puits_est_le_journal() {
    // Le handler H13 appelle `SinkDiagnostic` : le journal réel s'y branche
    // sans adaptation.
    let racine = dossier();
    let journal = Journal::nouveau(racine.join("j.log"));
    let puits: &dyn SinkDiagnostic = &journal;
    puits.ecrit(&EntreeDiagnostic::nouvelle(
        Niveau::Error,
        "client",
        "depuis le navigateur",
    ));
    assert!(lit(journal.chemin()).contains("[client] depuis le navigateur"));
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn le_journal_par_defaut_vit_a_cote_des_donnees() {
    let chemin = herdrchat::logging::journal_par_defaut("/Users/moi");
    assert_eq!(
        chemin,
        std::path::PathBuf::from("/Users/moi/.herdr-remote/herdr-remote.log")
    );
}
