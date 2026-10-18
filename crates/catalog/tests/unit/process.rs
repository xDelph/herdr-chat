//! L'exécuteur borné (T028) : exécutables factices — sortie/erreur/délai/
//! surtaille/annulation ; pas de shell, pas de zombie, pas de CLI d'agent.

use catalog::process::{Annulation, ErreurProcess, execute};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

static NONCE: AtomicU32 = AtomicU32::new(0);

/// Un exécutable FACTICE : un script à shebang — le NOYAU interprète,
/// l'exécuteur n'enveloppe dans aucun shell.
fn script(prefixe: &str, corps: &str) -> PathBuf {
    let racine = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match fs::create_dir(&racine) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    let chemin = racine.join("factice.sh");
    match fs::write(&chemin, format!("#!/bin/sh\n{corps}")) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let mut permissions = match fs::metadata(&chemin) {
        Ok(meta) => meta.permissions(),
        Err(cause) => panic!("metadata refusée : {cause}"),
    };
    permissions.set_mode(0o755);
    match fs::set_permissions(&chemin, permissions) {
        Ok(()) => (),
        Err(cause) => panic!("chmod refusé : {cause}"),
    }
    chemin
}

#[test]
fn une_sortie_et_une_erreur_se_capturent() {
    let factice = script(
        "soutien-process-sortie",
        "echo 'la sortie standard'; echo 'la sortie erreur' >&2; exit 0",
    );
    let chemin = factice.to_string_lossy().to_string();
    let resultat = execute(&[&chemin], Duration::from_secs(10), &Annulation::nouveau())
        .unwrap_or_else(|cause| panic!("exécution refusée : {cause}"));
    assert!(
        resultat.sortie == b"la sortie standard\n",
        "la sortie capturée : {:?}",
        resultat.sortie
    );
    assert!(
        resultat.erreur == b"la sortie erreur\n",
        "l'erreur capturée : {:?}",
        resultat.erreur
    );
    assert!(resultat.code == Some(0), "code 0 : {:?}", resultat.code);
    // Le délai PAR DÉFAUT est celui du manifeste (20 s).
}

#[test]
fn un_code_de_sortie_non_nul_se_porte_tel_quel() {
    let factice = script("soutien-process-code", "exit 3");
    let chemin = factice.to_string_lossy().to_string();
    let resultat = execute(&[&chemin], Duration::from_secs(10), &Annulation::nouveau())
        .unwrap_or_else(|cause| panic!("exécution refusée : {cause}"));
    assert!(
        resultat.code == Some(3),
        "le code 3 passe : {:?}",
        resultat.code
    );
}

#[test]
fn le_delai_tue_et_ramasse_lenfant() {
    let factice = script("soutien-process-delai", "echo parti; sleep 30; echo jamais");
    let chemin = factice.to_string_lossy().to_string();
    let debut = std::time::Instant::now();
    match execute(
        &[&chemin],
        Duration::from_millis(120),
        &Annulation::nouveau(),
    ) {
        Err(ErreurProcess::Delai) => (),
        autre => panic!("délai attendu : {autre:?}"),
    }
    assert!(
        debut.elapsed() < Duration::from_secs(5),
        "le délai imposé tient : {debut:?}"
    );
    // La sortie partiellement lue avant le kill est perdue avec l'ERREUR —
    // correct : un délai dépassé n'est pas un succès partiel à servir.
    // Pas de zombie : 200 enfants tués consécutifs, le 201e spawn marche.
    for _ in 0..200 {
        let _ = execute(
            &[&chemin],
            Duration::from_millis(50),
            &Annulation::nouveau(),
        );
    }
    let dernier = script("soutien-process-apres-kill", "echo encore vivant");
    let chemin_dernier = dernier.to_string_lossy().to_string();
    match execute(
        &[&chemin_dernier],
        Duration::from_secs(10),
        &Annulation::nouveau(),
    ) {
        Ok(resultat) => assert!(
            resultat.sortie == b"encore vivant\n",
            "le spawn marche encore"
        ),
        Err(cause) => panic!("après 200 kills, le spawn doit marcher : {cause}"),
    }
}

#[test]
fn la_surtaille_est_refusee_pas_tronquee() {
    // Un stdout de ~3 MiB : au-delà de la borne de 2 MiB — refus nommé.
    let factice = script(
        "soutien-process-surtaille",
        "head -c 3145728 /dev/zero | tr '\\0' 'x'",
    );
    let chemin = factice.to_string_lossy().to_string();
    match execute(&[&chemin], Duration::from_secs(30), &Annulation::nouveau()) {
        Err(ErreurProcess::SortieTropGrande) => (),
        Ok(resultat) => panic!(
            "une sortie de {} octets ne se sert PAS",
            resultat.sortie.len()
        ),
        autre => panic!("surtaille attendue : {autre:?}"),
    }
    // Sous la borne : passe entière.
}

#[test]
fn l_annulation_tue_lenfant_et_rend_le_contrôle() {
    let factice = script("soutien-process-annule", "sleep 30; echo jamais");
    let chemin = factice.to_string_lossy().to_string();
    // Le détenteur d'un CLONE pose le drapeau après 80 ms : l'enfant est
    // tué, l'exécution rend Annule — et lui seul est touché.
    let annulation = Annulation::nouveau();
    let annulation_fils = annulation.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(80));
        annulation_fils.annule();
    });
    match execute(&[&chemin], Duration::from_secs(30), &annulation) {
        Err(ErreurProcess::Annule) => (),
        autre => panic!("annulation attendue : {autre:?}"),
    }
    // Un exécutable SAIN (autre script, fin propre) marche après
    // l'annulation — rien n'a été « sali ».
    let sain = script("soutien-process-sain", "echo propre");
    let chemin_sain = sain.to_string_lossy().to_string();
    match execute(
        &[&chemin_sain],
        Duration::from_secs(10),
        &Annulation::nouveau(),
    ) {
        Ok(resultat) => assert!(resultat.sortie == b"propre\n"),
        Err(cause) => panic!("après annulation, un exécutable sain marche : {cause}"),
    }
}

#[test]
fn un_lancement_impossible_se_nomme() {
    // Pas de shell : un exécutable absent = un échec de LANCEMENT.
    match execute(
        &["/ce/chemin/nexiste/pas"],
        Duration::from_secs(1),
        &Annulation::nouveau(),
    ) {
        Err(ErreurProcess::Lancement(_)) => (),
        autre => panic!("lancement impossible attendu : {autre:?}"),
    }
    // Un argv vide : pareil.
    match execute(&[], Duration::from_secs(1), &Annulation::nouveau()) {
        Err(ErreurProcess::Lancement(_)) => (),
        autre => panic!("argv vide attendu : {autre:?}"),
    }
}
