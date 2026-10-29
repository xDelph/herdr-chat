//! E08/E10 — le store push tel que le démon le compose
//! (`assemblage::store_push`, appelé par `main`) : clés VAPID de
//! l'environnement appliquées, paire partielle refusée, ancien store
//! rapatrié depuis `<cwd>/.herdr-remote/push.json`.

use herdrchat::assemblage::store_push;
use herdrchat::config::{Config, LanceStatutServe, config_depuis_avec};
use notifications::store::{AbonnementPush, ClefsAbonnement, StorePush, ecrit_store, lit_store};
use notifications::vapid::genere_clefs_vapid;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

struct SansTailscale;

impl LanceStatutServe for SansTailscale {
    fn lance(&self, _argv: &[&str], _delai: Duration) -> Result<String, String> {
        Err(String::from("pas de tailscale dans les tests"))
    }
}

static COMPTEUR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Un dossier jetable : jamais le HOME, jamais le store réel.
fn dossier(prefixe: &str) -> PathBuf {
    let chemin = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duree| duree.as_nanos())
            .unwrap_or(0),
        COMPTEUR.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    ));
    std::fs::create_dir_all(&chemin).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    chemin
}

fn config(store: &Path, env_vapid: Option<(String, String)>) -> Config {
    let mut env = HashMap::new();
    env.insert(
        String::from("HERDR_REMOTE_PUSH_STORE"),
        store.to_string_lossy().into_owned(),
    );
    if let Some((publique, privee)) = env_vapid {
        env.insert(String::from("HERDR_REMOTE_VAPID_PUBLIC_KEY"), publique);
        env.insert(String::from("HERDR_REMOTE_VAPID_PRIVATE_KEY"), privee);
    }
    config_depuis_avec(&env, Path::new("/foyer"), &SansTailscale)
        .unwrap_or_else(|cause| panic!("config : {cause:?}"))
}

#[test]
fn les_cles_vapid_de_l_environnement_sont_celles_servies() {
    let racine = dossier("herdr-store-env");
    let clefs = genere_clefs_vapid();
    let config = config(
        &racine.join("push.json"),
        Some((clefs.public_key.clone(), clefs.private_key.clone())),
    );
    let gardien = store_push(&config, None).unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(
        gardien
            .cle_publique()
            .unwrap_or_else(|erreur| panic!("{erreur:?}")),
        clefs.public_key,
        "la clé de l'environnement prime sur une clé générée"
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn une_paire_vapid_melangee_est_refusee_au_demarrage() {
    let racine = dossier("herdr-store-melange");
    let une = genere_clefs_vapid();
    let autre = genere_clefs_vapid();
    let config = config(
        &racine.join("push.json"),
        Some((une.public_key, autre.private_key)),
    );
    match store_push(&config, None) {
        Err(cause) => assert!(cause.contains("VAPID"), "{cause}"),
        Ok(_) => panic!("une paire mélangée ne doit jamais être complétée en silence"),
    }
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn l_ancien_store_du_dossier_courant_est_rapatrie() {
    let racine = dossier("herdr-store-rapatrie");
    let ancien_dossier = racine.join("ancien");
    let ancien = ancien_dossier.join(".herdr-remote").join("push.json");
    std::fs::create_dir_all(ancien.parent().unwrap_or(&ancien_dossier))
        .unwrap_or_else(|cause| panic!("{cause}"));
    let mut store = StorePush::vide();
    store.vapid_keys = Some(genere_clefs_vapid());
    store.subscriptions.push(AbonnementPush {
        endpoint: String::from("https://push.example/ancien-telephone"),
        keys: ClefsAbonnement {
            p256dh: String::from("p256dh"),
            auth: String::from("auth"),
        },
    });
    ecrit_store(&ancien, &store).unwrap_or_else(|erreur| panic!("{erreur:?}"));
    let nouveau = racine.join("nouveau").join("push.json");
    let config = config(&nouveau, None);
    let gardien =
        store_push(&config, Some(&ancien_dossier)).unwrap_or_else(|cause| panic!("{cause}"));
    let abonnements = gardien
        .abonnements()
        .unwrap_or_else(|erreur| panic!("{erreur:?}"));
    assert_eq!(
        abonnements.len(),
        1,
        "l'abonnement existant n'est pas orphelin"
    );
    assert_eq!(
        abonnements[0].endpoint,
        "https://push.example/ancien-telephone"
    );
    let relu = lit_store(&nouveau).unwrap_or_else(|erreur| panic!("{erreur:?}"));
    assert_eq!(
        relu.vapid_keys, store.vapid_keys,
        "les clés suivent leurs abonnements"
    );
    let _ = std::fs::remove_dir_all(&racine);
}
