//! Le cache/single-flight des catalogues (T031/C16) : deux requêtes
//! concurrentes = UN processus, l'échec réessayable, la même politique pour
//! liste et lancement.

use catalog::cache::CacheCatalogues;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread;

static NONCE: AtomicU32 = AtomicU32::new(0);

fn cli_factice(prefixe: &str, corps: &str) -> PathBuf {
    let racine = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match fs::create_dir(&racine) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    let chemin = racine.join("cli.sh");
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

/// Le CLI qui COMPTE ses invocations (une écriture par appel) — la preuve
/// du « exactement un processus ».
fn cli_compteur(prefixe: &str, lent: bool) -> (PathBuf, PathBuf) {
    let racine = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match fs::create_dir(&racine) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    let journal = racine.join("invocations");
    let attente = if lent { "sleep 0.2" } else { "" };
    let corps = format!(
        "echo appele >> '{}'\n{attente}\necho '{{\"models\": [{{\"slug\": \"m-1\"}}]}}'",
        journal.display()
    );
    let chemin = racine.join("cli.sh");
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
    (chemin, journal)
}

fn compte(journal: &PathBuf) -> usize {
    match fs::read_to_string(journal) {
        Ok(texte) => texte.lines().filter(|ligne| !ligne.is_empty()).count(),
        Err(_) => 0,
    }
}

#[test]
fn deux_requêtes_concurrentes_lancent_exactement_un_processus() {
    let cache = CacheCatalogues::nouveau();
    let (cli, journal) = cli_compteur("soutien-cache-concurrent", true);
    let commande = vec![cli.to_string_lossy().to_string()];
    // Huit requêtes CONCURRENTES du même kind : un seul processus.
    let cache_partage = std::sync::Arc::new(cache);
    let poignees: Vec<_> = (0..8)
        .map(|_| {
            let cache_fils = std::sync::Arc::clone(&cache_partage);
            let commande_fille = commande.clone();
            let genre = "codex";
            thread::spawn(move || cache_fils.catalogue(genre, &commande_fille))
        })
        .collect();
    let mut succes = 0_usize;
    for poignee in poignees {
        match poignee.join() {
            Ok(resultat) if resultat.erreur.is_none() => succes += 1,
            Ok(resultat) => panic!("une requête a échoué : {:?}", resultat.erreur),
            Err(_) => panic!("un fil a paniqué"),
        }
    }
    assert!(succes == 8, "les huit servies : {succes}");
    assert!(
        compte(&journal) == 1,
        "EXACTEMENT un processus lancé : {}",
        compte(&journal)
    );
}

#[test]
fn un_échec_n_est_jamais_figé() {
    let cache = CacheCatalogues::nouveau();
    // Le CLI échoue D'ABORD.
    let cli_echec = cli_factice("soutien-cache-echec", "echo 'raison du refus' >&2; exit 1");
    let commande_echec = vec![cli_echec.to_string_lossy().to_string()];
    let premier = cache.catalogue("codex", &commande_echec);
    assert!(
        premier.erreur.is_some(),
        "le premier échoue : {:?}",
        premier.erreur
    );
    // Le SUCCÈSSIF (un CLI qui marche, le même kind) est RÉESSAYABLE —
    // l'échec n'a rien figé.
    let cli_ok = cli_factice(
        "soutien-cache-succes",
        "echo '{\"models\": [{\"slug\": \"m-2\"}]}'",
    );
    let commande_ok = vec![cli_ok.to_string_lossy().to_string()];
    let deuxieme = cache.catalogue("codex", &commande_ok);
    assert!(
        deuxieme.erreur.is_none(),
        "l'échec n'est pas figé : {:?}",
        deuxieme.erreur
    );
    assert!(deuxieme.modeles.len() == 1 && deuxieme.modeles[0].id == "m-2");
    // Et le succès EST au cache maintenant (une seconde lecture : même
    // entrée, pas de nouveau processus).
    let troisieme = cache.catalogue("codex", &commande_ok);
    assert!(troisieme.modeles[0].id == "m-2");
}

#[test]
fn linvalidation_force_un_nouveau_processus() {
    let cache = CacheCatalogues::nouveau();
    let (cli, journal) = cli_compteur("soutien-cache-invalide", false);
    let commande = vec![cli.to_string_lossy().to_string()];
    let _ = cache.catalogue("codex", &commande);
    cache.invalide("codex");
    let _ = cache.catalogue("codex", &commande);
    assert!(
        compte(&journal) == 2,
        "l'invalidation force la relecture : {} invocations",
        compte(&journal)
    );
}

#[test]
fn liste_et_lancement_appliquent_la_même_politique() {
    // La même politique = la même fonction : liste ET validation de
    // lancement passent par `catalogue` — le compteur le prouve (les deux
    // appels successifs = UN processus, le succès de 60 s couvre les deux).
    let cache = CacheCatalogues::nouveau();
    let (cli, journal) = cli_compteur("soutien-cache-politique", false);
    let commande = vec![cli.to_string_lossy().to_string()];
    let par_liste = cache.catalogue("codex", &commande);
    let par_lancement = cache.catalogue("codex", &commande);
    assert!(par_liste.modeles.len() == par_lancement.modeles.len());
    assert!(
        compte(&journal) == 1,
        "UNE exécution pour liste ET lancement : {}",
        compte(&journal)
    );
    // L'absence de kind reste explicite par la même politique.
    let absent = cache.catalogue("agent-inconnu", &[]);
    assert!(
        absent
            .erreur
            .as_deref()
            .unwrap_or_default()
            .contains("inconnu")
    );
}
