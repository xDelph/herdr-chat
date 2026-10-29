//! Le hub d'observation (STREAMING.md §3) : une écriture dans la source fait
//! bouger la révision sans attendre la veille, l'observation est partagée,
//! et rien ne survit au dernier client.

use domain::session::{ResolvedSource, SourceKind};
use sessions::hub::SessionHub;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

static NONCE: AtomicU32 = AtomicU32::new(0);

fn dossier() -> PathBuf {
    let chemin = std::env::temp_dir().join(format!(
        "soutien-hub-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::create_dir_all(&chemin).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    chemin
}

fn source(chemin: &Path) -> ResolvedSource {
    ResolvedSource {
        kind: SourceKind::File,
        base: chemin.display().to_string(),
        session_id: None,
        family: None,
    }
}

fn ajoute(chemin: &Path, ligne: &str) {
    let mut fichier = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(chemin)
        .unwrap_or_else(|cause| panic!("ouverture : {cause}"));
    fichier
        .write_all(ligne.as_bytes())
        .unwrap_or_else(|cause| panic!("écriture : {cause}"));
}

async fn attend_changement(
    revisions: &mut tokio::sync::watch::Receiver<u64>,
    delai: Duration,
) -> bool {
    tokio::time::timeout(delai, revisions.changed())
        .await
        .is_ok_and(|issue| issue.is_ok())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn une_ecriture_est_vue_par_le_watcher_sans_attendre_le_filet() {
    // Le filet est réglé à une minute : seul le watcher système peut
    // signaler l'écriture dans le délai.
    let racine = dossier();
    let chemin = racine.join("session.jsonl");
    ajoute(&chemin, "{\"n\":1}\n");
    let hub = SessionHub::avec_filet(Duration::from_secs(60));
    let mut observation = hub.observe(&source(&chemin));
    assert!(
        observation.degradation().is_none(),
        "{:?}",
        observation.degradation()
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    observation.revisions.mark_unchanged();
    ajoute(&chemin, "{\"n\":2}\n");
    assert!(
        attend_changement(&mut observation.revisions, Duration::from_secs(5)).await,
        "l'écriture doit faire bouger la révision"
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn un_fichier_voisin_ne_signale_rien_et_la_cible_si() {
    // Une écriture dans un AUTRE fichier du dossier ne doit rien signaler ;
    // le filet (50 ms) voit l'écriture de la cible.
    let racine = dossier();
    let chemin = racine.join("session.jsonl");
    ajoute(&chemin, "{\"n\":1}\n");
    let hub = SessionHub::avec_filet(Duration::from_millis(50));
    let mut observation = hub.observe(&source(&chemin));
    tokio::time::sleep(Duration::from_millis(200)).await;
    observation.revisions.mark_unchanged();
    ajoute(&racine.join("voisin.jsonl"), "{\"autre\":1}\n");
    assert!(
        !attend_changement(&mut observation.revisions, Duration::from_millis(400)).await,
        "un fichier voisin ne concerne pas la session"
    );
    ajoute(&chemin, "{\"n\":2}\n");
    assert!(attend_changement(&mut observation.revisions, Duration::from_secs(3)).await);
    let _ = std::fs::remove_dir_all(&racine);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn une_source_est_observee_une_fois_et_lachee_avec_son_dernier_client() {
    let racine = dossier();
    let chemin = racine.join("session.jsonl");
    ajoute(&chemin, "{\"n\":1}\n");
    let hub = SessionHub::avec_filet(Duration::from_millis(50));
    let premiere = hub.observe(&source(&chemin));
    let seconde = hub.observe(&source(&chemin));
    assert_eq!(
        hub.observations_actives(),
        1,
        "une seule observation partagée"
    );
    drop(premiere);
    assert_eq!(
        hub.observations_actives(),
        1,
        "le second client la tient encore"
    );
    drop(seconde);
    assert_eq!(
        hub.observations_actives(),
        0,
        "rien ne survit au dernier client"
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn un_fichier_cree_apres_coup_est_observe() {
    // Pi écrit son JSONL au premier message : la session peut être observée
    // avant d'exister.
    let racine = dossier();
    let chemin = racine.join("pas-encore.jsonl");
    let hub = SessionHub::avec_filet(Duration::from_millis(50));
    let mut observation = hub.observe(&source(&chemin));
    tokio::time::sleep(Duration::from_millis(200)).await;
    observation.revisions.mark_unchanged();
    ajoute(&chemin, "{\"n\":1}\n");
    assert!(attend_changement(&mut observation.revisions, Duration::from_secs(3)).await);
    let _ = std::fs::remove_dir_all(&racine);
}
