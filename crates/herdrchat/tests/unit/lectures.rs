//! H22 — le magasin fichier des lectures partagées : aller-retour, fichier
//! absent = table vide, fichier corrompu = panne NOMMÉE (jamais une table
//! vide silencieuse), et le chemin par défaut à côté du magasin push.

use application::lectures::{MagasinLectures, ServiceLectures};
use herdrchat::config::{LanceStatutServe, config_depuis_avec};
use herdrchat::lectures::FichierLectures;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

struct SansTailscale;

impl LanceStatutServe for SansTailscale {
    fn lance(&self, _argv: &[&str], _delai: Duration) -> Result<String, String> {
        Err(String::from("pas de tailscale dans les tests"))
    }
}

static COMPTEUR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Un dossier jetable : jamais le HOME, jamais le magasin réel.
fn dossier() -> PathBuf {
    let chemin = std::env::temp_dir().join(format!(
        "herdr-lectures-{}-{}",
        std::process::id(),
        COMPTEUR.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&chemin);
    std::fs::create_dir_all(&chemin).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    chemin
}

#[test]
fn les_lectures_survivent_au_redemarrage() {
    let racine = dossier();
    let chemin = racine.join("etat/reads.json");
    let magasin = Arc::new(FichierLectures::nouveau(chemin.clone()));
    assert_eq!(magasin.charge(), Ok(HashMap::new()), "absent = vide");
    let (service, panne) = ServiceLectures::charge(magasin);
    assert_eq!(panne, None);
    assert_eq!(service.note("w1:p1", 1_000).panne, None);

    let (relu, _) = ServiceLectures::charge(Arc::new(FichierLectures::nouveau(chemin)));
    assert_eq!(relu.lue_a("w1:p1"), Some(1_000));
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_fichier_corrompu_est_une_panne_nommee() {
    let racine = dossier();
    let chemin = racine.join("reads.json");
    std::fs::write(&chemin, b"{pas du json").unwrap_or_else(|cause| panic!("{cause}"));
    let (service, panne) = ServiceLectures::charge(Arc::new(FichierLectures::nouveau(chemin)));
    assert!(
        panne
            .as_deref()
            .is_some_and(|cause| cause.contains("reads.json")),
        "{panne:?}"
    );
    assert_eq!(service.lue_a("w1:p1"), None);
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn le_chemin_par_defaut_est_a_cote_du_magasin_push() {
    let mut env = HashMap::new();
    env.insert(
        String::from("HERDR_REMOTE_PUSH_STORE"),
        String::from("/etat/herdr/push.json"),
    );
    let config = config_depuis_avec(&env, Path::new("/foyer"), &SansTailscale)
        .unwrap_or_else(|cause| panic!("config : {cause:?}"));
    assert_eq!(
        config.lectures_store_path,
        PathBuf::from("/etat/herdr/reads.json")
    );
    env.insert(
        String::from("HERDR_REMOTE_READS_STORE"),
        String::from("/ailleurs/lu.json"),
    );
    let config = config_depuis_avec(&env, Path::new("/foyer"), &SansTailscale)
        .unwrap_or_else(|cause| panic!("config : {cause:?}"));
    assert_eq!(
        config.lectures_store_path,
        PathBuf::from("/ailleurs/lu.json")
    );
}
