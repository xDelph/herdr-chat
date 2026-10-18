//! T054 — le fournisseur d'assets embarqué : sans build, il n'a **rien** (et
//! le démon répondra le 503 dit) ; avec un build, il sert la table générée.
//!
//! ⚠️ Ce test ne lit AUCUN fichier de l'utilisateur : il interroge le
//! fournisseur, qui ne rend que ce qui a été linké (ou rien).

use herdrchat::assets::AssetsEmbarques;
use http_api::assets::{FournisseurAssets, normalise, reponse_asset};

#[test]
fn sans_build_le_fournisseur_n_a_rien() {
    let assets = AssetsEmbarques;
    if cfg!(pwa_build) {
        // Un build est là : l'index existe forcément (le garde-fou du
        // build.rs l'exige).
        assert!(assets.index().is_some());
    } else {
        assert!(assets.index().is_none(), "aucun index sans build");
        assert!(assets.fichier("/index.html").is_none());
        assert!(assets.fichier("/assets/app.js").is_none());
    }
}

#[test]
fn aucun_chemin_hors_table_n_est_servi() {
    let assets = AssetsEmbarques;
    // La table ne contient que des chemins du build : un chemin système ou
    // une traversée ne peut pas y être.
    for hostile in ["/etc/passwd", "/../../etc/passwd", "/%2e%2e/secret"] {
        assert!(
            assets.fichier(hostile).is_none(),
            "{hostile} n'est pas un asset du build"
        );
    }
}

#[test]
fn la_reponse_ne_depend_jamais_du_repertoire_courant() {
    // O05 : le binaire sert son build quel que soit le cwd — ici il n'y a
    // simplement aucune lecture disque, donc rien à trouver.
    let avant = std::env::current_dir();
    std::env::set_current_dir(std::env::temp_dir()).unwrap_or_else(|cause| {
        panic!("changer de répertoire : {cause:?}");
    });
    let index = AssetsEmbarques.index();
    std::env::set_current_dir(avant.unwrap_or_else(|cause| panic!("revenir : {cause:?}")))
        .unwrap_or_else(|cause| panic!("revenir : {cause:?}"));
    if cfg!(pwa_build) {
        assert!(index.is_some(), "le build embarqué ne dépend pas du cwd");
    } else {
        assert!(index.is_none());
    }
}

#[test]
fn le_repli_spa_reste_l_index() {
    let reponse = reponse_asset(&AssetsEmbarques, "/une/route/spa");
    if cfg!(pwa_build) {
        assert_eq!(reponse.status(), 200);
    } else {
        assert_eq!(reponse.status(), 503);
    }
}

#[test]
fn la_normalisation_est_la_meme_pour_tous() {
    // Le fournisseur ne voit que des chemins normalisés : la politique est
    // celle de `http_api::assets`, pas une seconde copie ici.
    assert_eq!(
        normalise("/assets/./app.js").as_deref(),
        Some("/assets/app.js")
    );
    assert_eq!(normalise("/../x"), None);
}
