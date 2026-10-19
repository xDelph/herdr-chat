//! Le store push (T044, E08, C14) : forme legacy exacte, écrivain
//! sérialisé, écriture atomique, fichier corrompu visible, migration
//! entière — clés et abonnements existants inchangés.
//! Prouve : E10.

use notifications::store::{
    AbonnementPush, ClefsAbonnement, ClefsVapid, ErreurStore, GardienDeStore, StorePush,
    ecrit_store, lit_store, rapatrie_store,
};
use notifications::vapid::genere_clefs_vapid;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static NONCE: AtomicU32 = AtomicU32::new(0);

fn temporaire(prefixe: &str) -> PathBuf {
    let base = std::env::temp_dir();
    let pid = std::process::id();
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let chemin = base.join(format!("{prefixe}-{pid}-{nonce}"));
    match fs::create_dir(&chemin) {
        Ok(()) => chemin,
        Err(cause) => panic!("racine temporaire refusée : {cause}"),
    }
}

fn abonnement(endpoint: &str) -> AbonnementPush {
    AbonnementPush {
        endpoint: String::from(endpoint),
        keys: ClefsAbonnement {
            p256dh: String::from("clé-p256dh"),
            auth: String::from("clé-auth"),
        },
    }
}

fn clefs_synthetiques() -> ClefsVapid {
    genere_clefs_vapid()
}

#[test]
fn les_cles_et_abonnements_existants_sont_inchanges() {
    // E08 : la forme legacy est le contrat — un store écrit puis relu porte
    // exactement les mêmes clés et abonnements (synthétiques ici).
    let atelier = temporaire("herdr-store");
    let chemin = atelier.join("push.json");
    let clefs = clefs_synthetiques();
    let store = StorePush {
        subscriptions: vec![abonnement("https://push.example/1")],
        vapid_keys: Some(clefs.clone()),
    };
    ecrit_store(&chemin, &store).unwrap_or_else(|_| panic!("première écriture"));
    let relu = lit_store(&chemin).unwrap_or_else(|_| panic!("relecture"));
    assert_eq!(relu, store, "forme identique à l'aller");
    // La forme filaire est celle du fil : camelCase, indenté.
    let brut = fs::read_to_string(&chemin).unwrap_or_else(|_| panic!("brut lisible"));
    assert!(brut.contains("\"vapidKeys\""), "camelCase {brut}");
    assert!(brut.contains("\"publicKey\""), "camelCase {brut}");
    assert!(brut.contains("\"p256dh\""), "clés d'abonnement {brut}");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn un_fichier_absent_est_un_store_vide() {
    let atelier = temporaire("herdr-store");
    let chemin = atelier.join("absent.json");
    let store = lit_store(&chemin).unwrap_or_else(|_| panic!("store vide attendu"));
    assert!(store.subscriptions.is_empty());
    assert!(store.vapid_keys.is_none());
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn un_fichier_corrompu_est_visible_jamais_regenere() {
    // T044 : un store malformé est une ERREUR visible — jamais une
    // régénération silencieuse des clés.
    let atelier = temporaire("herdr-store");
    let chemin = atelier.join("push.json");
    fs::write(&chemin, b"{pas du json").unwrap_or_else(|_| panic!("fichier corrompu"));
    let erreur = match lit_store(&chemin) {
        Ok(_) => panic!("le store corrompu doit échouer"),
        Err(erreur) => erreur,
    };
    assert!(
        matches!(erreur, ErreurStore::Illisible { .. }),
        "la cause est réelle : {erreur:?}"
    );
    // Un abonnement sur un store corrompu échoue aussi (aucune écriture
    // qui écraserait la preuve).
    let gardien = GardienDeStore::nouveau(chemin.clone(), None);
    assert!(
        gardien
            .abonne(&abonnement("https://push.example/1"))
            .is_err()
    );
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn la_paire_env_partielle_est_refusee() {
    // T044 : une seule clé env ne peut pas signer — refus, jamais secours.
    let resultat = ClefsVapid::depuis_env(Some(String::from("publique")), None);
    assert!(
        matches!(resultat, Err(ErreurStore::PaireEnvPartielle)),
        "paire partielle refusée"
    );
    let resultat = ClefsVapid::depuis_env(None, Some(String::from("privée")));
    assert!(matches!(resultat, Err(ErreurStore::PaireEnvPartielle)));
    // Aucune clé : pas une erreur, pas de clés.
    assert_eq!(
        ClefsVapid::depuis_env(None, None).unwrap_or_else(|_| panic!("rien à refuser")),
        None
    );
}

#[test]
fn une_paire_env_melangee_est_refusee() {
    // TECH §7 : la privée doit dériver la publique — deux paires mélangées
    // sont refusées avant toute utilisation.
    let premiere = clefs_synthetiques();
    let seconde = clefs_synthetiques();
    let melangee = ClefsVapid {
        public_key: premiere.public_key,
        private_key: seconde.private_key,
    };
    let resultat = ClefsVapid::depuis_env(
        Some(melangee.public_key.clone()),
        Some(melangee.private_key.clone()),
    );
    assert!(
        matches!(resultat, Err(ErreurStore::ClefsInvalides { .. })),
        "paire mélangée refusée"
    );
}

#[test]
fn une_paire_env_valide_est_acceptee_et_prioritaire() {
    // E08 : l'environnement prime sur le store — une paire complète et
    // cohérente est utilisée telle quelle.
    let atelier = temporaire("herdr-store");
    let chemin = atelier.join("push.json");
    let env = clefs_synthetiques();
    // Un store avec D'AUTRES clés : l'env gagne.
    let store = StorePush {
        subscriptions: vec![],
        vapid_keys: Some(clefs_synthetiques()),
    };
    ecrit_store(&chemin, &store).unwrap_or_else(|_| panic!("store initial"));
    let gardien = GardienDeStore::nouveau(chemin.clone(), Some(env.clone()));
    assert_eq!(
        gardien
            .cle_publique()
            .unwrap_or_else(|_| panic!("clé publique")),
        env.public_key,
        "l'env prime sur le store"
    );
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn les_cles_du_store_sont_preservees_sans_env() {
    // E08 : sans env, les clés persistées sont conservées — jamais de
    // régénération qui invaliderait les abonnements.
    let atelier = temporaire("herdr-store");
    let chemin = atelier.join("push.json");
    let clefs = clefs_synthetiques();
    let store = StorePush {
        subscriptions: vec![abonnement("https://push.example/1")],
        vapid_keys: Some(clefs.clone()),
    };
    ecrit_store(&chemin, &store).unwrap_or_else(|_| panic!("store initial"));
    let gardien = GardienDeStore::nouveau(chemin.clone(), None);
    assert_eq!(
        gardien.clefs().unwrap_or_else(|_| panic!("clés")),
        clefs,
        "les clés du store sont la vérité"
    );
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn la_generation_sans_cles_est_persistee() {
    // E08 : sans env ni clés, une paire est générée ET persistée — la
    // suivante la retrouve.
    let atelier = temporaire("herdr-store");
    let chemin = atelier.join("push.json");
    let gardien = GardienDeStore::nouveau(chemin.clone(), None);
    let premiere = gardien.clefs().unwrap_or_else(|_| panic!("génération"));
    let seconde = gardien.clefs().unwrap_or_else(|_| panic!("relecture"));
    assert_eq!(premiere, seconde, "persistée, pas régénérée");
    let relu = lit_store(&chemin).unwrap_or_else(|_| panic!("store relu"));
    assert_eq!(relu.vapid_keys.as_ref(), Some(&premiere));
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn l_abonnement_est_un_upsert_par_endpoint() {
    // E08 : endpoint-keyed upsert — un même endpoint remplace, jamais un
    // doublon.
    let atelier = temporaire("herdr-store");
    let chemin = atelier.join("push.json");
    let gardien = GardienDeStore::nouveau(chemin.clone(), None);
    gardien
        .abonne(&abonnement("https://push.example/1"))
        .unwrap_or_else(|_| panic!("premier abonnement"));
    let mut remplace = abonnement("https://push.example/1");
    remplace.keys.auth = String::from("nouvelle-clé");
    gardien
        .abonne(&remplace)
        .unwrap_or_else(|_| panic!("réabonnement"));
    let abonnements = gardien.abonnements().unwrap_or_else(|_| panic!("liste"));
    assert_eq!(abonnements.len(), 1, "un seul abonnement par endpoint");
    assert_eq!(abonnements[0].keys.auth, "nouvelle-clé");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn le_desabonnement_retire_par_endpoint() {
    let atelier = temporaire("herdr-store");
    let chemin = atelier.join("push.json");
    let gardien = GardienDeStore::nouveau(chemin.clone(), None);
    gardien
        .abonne(&abonnement("https://push.example/1"))
        .unwrap_or_else(|_| panic!("abonnement"));
    gardien
        .abonne(&abonnement("https://push.example/2"))
        .unwrap_or_else(|_| panic!("second abonnement"));
    gardien
        .desabonne("https://push.example/1")
        .unwrap_or_else(|_| panic!("désabonnement"));
    let abonnements = gardien.abonnements().unwrap_or_else(|_| panic!("liste"));
    assert_eq!(abonnements.len(), 1);
    assert_eq!(abonnements[0].endpoint, "https://push.example/2");
    // Désabonner un inconnu ne fait rien.
    gardien
        .desabonne("https://push.example/inconnu")
        .unwrap_or_else(|_| panic!("désabonnement inconnu"));
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn la_migration_rapatrie_le_store_entier_sur_un_nouveau_vide() {
    // T044 : abonnements ET clés VAPID ensemble — les abonnements sont liés
    // à la clé publique qui les a créés.
    let atelier = temporaire("herdr-store");
    let ancien = atelier.join("ancien").join("push.json");
    let nouveau = atelier.join("nouveau").join("push.json");
    let clefs = clefs_synthetiques();
    let ancien_store = StorePush {
        subscriptions: vec![abonnement("https://push.example/1")],
        vapid_keys: Some(clefs.clone()),
    };
    ecrit_store(&ancien, &ancien_store).unwrap_or_else(|_| panic!("ancien store"));
    let rapatrie = rapatrie_store(&nouveau, &ancien)
        .unwrap_or_else(|_| panic!("rapatriement"))
        .unwrap_or_else(|| panic!("le rapatriement a eu lieu"));
    assert_eq!(rapatrie, ancien);
    let relu = lit_store(&nouveau).unwrap_or_else(|_| panic!("nouveau store"));
    assert_eq!(relu, ancien_store, "store ENTIER rapatrié, VAPID compris");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn la_migration_ne_touche_pas_un_nouveau_store_peuple() {
    // T044 : un store déjà peuplé est la vérité, on n'y touche pas.
    let atelier = temporaire("herdr-store");
    let ancien = atelier.join("ancien.json");
    let nouveau = atelier.join("nouveau.json");
    let ancien_store = StorePush {
        subscriptions: vec![abonnement("https://push.example/ancien")],
        vapid_keys: Some(clefs_synthetiques()),
    };
    let nouveau_store = StorePush {
        subscriptions: vec![abonnement("https://push.example/nouveau")],
        vapid_keys: Some(clefs_synthetiques()),
    };
    ecrit_store(&ancien, &ancien_store).unwrap_or_else(|_| panic!("ancien store"));
    ecrit_store(&nouveau, &nouveau_store).unwrap_or_else(|_| panic!("nouveau store"));
    let rapatrie = rapatrie_store(&nouveau, &ancien).unwrap_or_else(|_| panic!("rapatriement"));
    assert!(rapatrie.is_none(), "rien à faire");
    let relu = lit_store(&nouveau).unwrap_or_else(|_| panic!("nouveau store"));
    assert_eq!(relu, nouveau_store, "le nouveau store est intact");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn la_migration_sans_ancien_store_est_une_installation_neuve() {
    let atelier = temporaire("herdr-store");
    let ancien = atelier.join("absent.json");
    let nouveau = atelier.join("nouveau.json");
    let rapatrie = rapatrie_store(&nouveau, &ancien).unwrap_or_else(|_| panic!("pas une panne"));
    assert!(rapatrie.is_none(), "rien à rapatrier");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn la_migration_sur_un_nouveau_corrompu_est_visible() {
    // Divergence volontaire : le fil traitait un nouveau store corrompu
    // comme « non peuplé » et l'écrasait en silence — ici c'est une erreur
    // visible, jamais une régénération silencieuse.
    let atelier = temporaire("herdr-store");
    let ancien = atelier.join("ancien.json");
    let nouveau = atelier.join("nouveau.json");
    let ancien_store = StorePush {
        subscriptions: vec![abonnement("https://push.example/1")],
        vapid_keys: None,
    };
    ecrit_store(&ancien, &ancien_store).unwrap_or_else(|_| panic!("ancien store"));
    fs::write(&nouveau, b"{corrompu").unwrap_or_else(|_| panic!("nouveau corrompu"));
    let erreur = match rapatrie_store(&nouveau, &ancien) {
        Ok(_) => panic!("le nouveau corrompu doit échouer"),
        Err(erreur) => erreur,
    };
    assert!(
        matches!(erreur, ErreurStore::Illisible { .. }),
        "le nouveau corrompu est visible : {erreur:?}"
    );
    fs::remove_dir_all(&atelier).ok();
}
