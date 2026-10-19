//! T054 — les assets de la PWA : confinement par construction, repli SPA,
//! cache des fichiers volatils, MIME par extension, et le 503 dit quand le
//! build manque.
//!
//! ⚠️ Le confinement est **structurel** ici (les assets sont embarqués) : les
//! tests le prouvent quand même, parce qu'un chemin d'URL reste une entrée
//! hostile (`..`, encodages, segments vides).
//! Prouve : O06, O07.

use crate::unit::support::{FauxAssets, services_retouches};
use axum::http::StatusCode;
use http_api::assets::{
    FichierAsset, FournisseurAssets, content_type_asset, est_immuable, est_volatil, normalise,
    reponse_asset,
};
use http_api::router::routeur;
use std::sync::Arc;
use test_support::fake_herdr::HerdrFaux;
use tower::ServiceExt;

/// Un GET brut (les assets ne sont pas du JSON).
async fn get(
    services: Arc<http_api::services::Services>,
    chemin: &str,
) -> axum::response::Response {
    routeur(services, vec![])
        .oneshot(
            axum::http::Request::builder()
                .method("GET")
                .uri(chemin)
                .body(axum::body::Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause:?}"))
}

async fn corps(reponse: axum::response::Response) -> (StatusCode, Vec<u8>, String, String) {
    let statut = reponse.status();
    let type_mime = reponse
        .headers()
        .get("content-type")
        .and_then(|valeur| valeur.to_str().ok())
        .unwrap_or("")
        .to_string();
    let cache = reponse
        .headers()
        .get("cache-control")
        .and_then(|valeur| valeur.to_str().ok())
        .unwrap_or("")
        .to_string();
    let octets = axum::body::to_bytes(reponse.into_body(), 1024 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause:?}"))
        .to_vec();
    (statut, octets, type_mime, cache)
}

#[test]
fn normalise_refuse_tout_ce_qui_sort() {
    assert_eq!(normalise("/").as_deref(), Some("/"));
    assert_eq!(
        normalise("/assets/app.js").as_deref(),
        Some("/assets/app.js")
    );
    assert_eq!(
        normalise("//assets//app.js").as_deref(),
        Some("/assets/app.js")
    );
    assert_eq!(
        normalise("/assets/./app.js").as_deref(),
        Some("/assets/app.js")
    );
    assert_eq!(
        normalise("/assets/../app.js").as_deref(),
        Some("/app.js"),
        "un `..` interne remonte, mais reste dans la racine"
    );
    // Sortir de la racine est refusé — jamais « clampé » sur un autre fichier.
    assert_eq!(normalise("/../secret"), None);
    assert_eq!(normalise("/assets/../../secret"), None);
    // Un encodage qui cache une traversée est décodé AVANT la normalisation.
    assert_eq!(normalise("/%2e%2e/secret"), None);
    assert_eq!(
        normalise("/assets/%2E%2E/secrets").as_deref(),
        Some("/secrets")
    );
    assert_eq!(normalise("/assets/%2e%2e%2f%2e%2e%2fsecret"), None);
    // Un encodage invalide n'est pas un asset — et ne fait pas tomber.
    assert_eq!(normalise("/%"), None);
    assert_eq!(normalise("/%zz"), None);
    assert_eq!(normalise("/%2"), None);
}

#[test]
fn le_type_suit_l_extension() {
    assert_eq!(
        content_type_asset("/index.html"),
        "text/html; charset=utf-8"
    );
    assert_eq!(
        content_type_asset("/assets/index-abc123.js"),
        "text/javascript; charset=utf-8"
    );
    assert_eq!(
        content_type_asset("/assets/index-abc123.css"),
        "text/css; charset=utf-8"
    );
    assert_eq!(
        content_type_asset("/manifest.webmanifest"),
        "application/manifest+json"
    );
    assert_eq!(content_type_asset("/icon.svg"), "image/svg+xml");
    assert_eq!(content_type_asset("/font.woff2"), "font/woff2");
    // Un type inconnu est téléchargé, jamais interprété.
    assert_eq!(
        content_type_asset("/notes.inconnu"),
        "application/octet-stream"
    );
    assert_eq!(
        content_type_asset("/sans-extension"),
        "application/octet-stream"
    );
}

#[test]
fn les_fichiers_volatils_sont_connus() {
    for volatil in [
        "/index.html",
        "/sw.js",
        "/push-sw.js",
        "/manifest.webmanifest",
    ] {
        assert!(
            est_volatil(volatil),
            "{volatil} change à chaque déploiement"
        );
    }
    for stable in ["/assets/app.js", "/assets/app.css", "/icon.svg"] {
        assert!(!est_volatil(stable), "{stable} est fingerprinté");
    }
}

#[test]
fn le_fournisseur_de_test_ne_sert_que_ce_qu_il_porte() {
    let faux = FauxAssets::defaut();
    assert!(faux.fichier("/assets/app.js").is_some());
    assert!(faux.fichier("/assets/inconnu.js").is_none());
    assert!(faux.index().is_some());
    // Un fournisseur sans build n'a rien — et le dit.
    let vide = FauxAssets::sans_index();
    assert!(vide.index().is_none());
}

#[test]
fn un_chemin_hors_racine_tombe_sur_l_index() {
    // Le repli SPA ne sert JAMAIS autre chose que l'index : une tentative de
    // traversée reçoit l'index, pas un fichier deviné.
    let reponse = reponse_asset(&FauxAssets::defaut(), "/../secret");
    assert_eq!(reponse.status(), StatusCode::OK);
}

#[tokio::test(flavor = "multi_thread")]
async fn index_et_assets_servis_avec_les_bons_entetes() {
    let services = services_retouches(HerdrFaux::nouveau(), |_| {});
    let (statut, octets, type_mime, cache) = corps(get(services, "/").await).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(type_mime, "text/html; charset=utf-8");
    assert_eq!(cache, "no-cache, no-store, must-revalidate");
    assert_eq!(octets, b"<html>PWA</html>");

    let services = services_retouches(HerdrFaux::nouveau(), |_| {});
    let (statut, octets, type_mime, cache) = corps(get(services, "/assets/app.js").await).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(type_mime, "text/javascript; charset=utf-8");
    // Un asset fingerprinté se met en cache : aucun `no-store` imposé.
    assert_eq!(cache, "", "un asset stable n'est pas marqué volatil");
    assert_eq!(octets, b"console.log(1)");
}

#[tokio::test(flavor = "multi_thread")]
async fn le_manifest_et_le_worker_ne_sont_jamais_mis_en_cache() {
    for volatil in ["/manifest.webmanifest", "/sw.js"] {
        let services = services_retouches(HerdrFaux::nouveau(), |_| {});
        let (statut, _octets, _type, cache) = corps(get(services, volatil).await).await;
        assert_eq!(statut, StatusCode::OK, "{volatil}");
        assert_eq!(cache, "no-cache, no-store, must-revalidate", "{volatil}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn une_route_spa_sert_l_index() {
    // Un rechargement sur une route du client (`#/agent/...` côté navigateur,
    // mais le serveur voit `/agent/w1:p1` si l'URL est réécrite) doit rendre
    // l'index, sinon la PWA serait inaccessible au rechargement.
    let services = services_retouches(HerdrFaux::nouveau(), |_| {});
    let (statut, octets, type_mime, cache) = corps(get(services, "/agent/w1:p1").await).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(type_mime, "text/html; charset=utf-8");
    assert_eq!(cache, "no-cache, no-store, must-revalidate");
    assert_eq!(octets, b"<html>PWA</html>");
}

#[tokio::test(flavor = "multi_thread")]
async fn api_inconnu_ne_retombe_pas_sur_le_html() {
    // C08 : `/api/*` inconnu reste un JSON 404, même quand les assets sont là.
    let services = services_retouches(HerdrFaux::nouveau(), |_| {});
    let reponse = get(services, "/api/nimporte/quoi").await;
    assert_eq!(reponse.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        reponse
            .headers()
            .get("content-type")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("application/json")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn sans_build_503_dit() {
    let sans = Arc::new(FauxAssets::sans_index());
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.assets = sans;
    });
    let reponse = get(services, "/").await;
    assert_eq!(reponse.status(), StatusCode::SERVICE_UNAVAILABLE);
    let octets = axum::body::to_bytes(reponse.into_body(), 8192)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause:?}"));
    let corps: serde_json::Value =
        serde_json::from_slice(&octets).unwrap_or_else(|cause| panic!("JSON : {cause:?}"));
    assert_eq!(corps["error"], "PWA not built");
    let indice = corps["hint"].as_str().unwrap_or_else(|| panic!("hint"));
    assert!(indice.contains("bun run"), "{indice}");
}

#[test]
fn le_faux_n_expose_aucun_chemin_disque() {
    // Le trait ne prend qu'un chemin d'URL et rend des OCTETS : il n'y a pas
    // de surface pour demander un fichier arbitraire du disque.
    let faux: &dyn FournisseurAssets = &FauxAssets::defaut();
    assert!(faux.fichier("/etc/passwd").is_none());
    assert!(faux.fichier("/../../etc/passwd").is_none());
}

#[test]
fn un_fichier_asset_porte_ses_octets() {
    let fichier = FichierAsset::nouveau(vec![1u8, 2, 3]);
    assert_eq!(fichier.octets, vec![1, 2, 3]);
}

#[test]
fn les_assets_haches_sont_immuables_et_les_volatils_non() {
    // ⚠️ Le nom haché de Vite est la PREUVE d'immuabilité : `index-BDwQxbtC.js`
    // peut être gardé un an, `index.html` jamais. Se tromper ici figerait la
    // version de l'application, ou revaliderait 459 Ko à chaque chargement.
    assert!(est_immuable("/assets/index-BDwQxbtC.js"));
    assert!(est_immuable("assets/vendor-a1b2c3d4.js"));
    assert!(
        !est_immuable("/index.html"),
        "l'index est volatil, même sans empreinte"
    );
    assert!(!est_immuable("/sw.js"));
    assert!(
        !est_immuable("/assets/app.js"),
        "sans empreinte, on ne promet rien"
    );
    assert!(
        !est_immuable("/assets/mon-fichier.js"),
        "un suffixe de 8 caractères seulement compte"
    );
    assert!(
        !est_immuable("/assets/icone.png"),
        "une icône sans empreinte n'est pas immuable"
    );
}

#[test]
fn la_reponse_d_un_asset_hache_porte_le_cache_immuable() {
    // ⚠️ Le fournisseur par défaut ne contient PAS de fichier haché : sans
    // celui-ci, la requête retombait sur l'index (no-store) et le test
    // comparait deux fois l'index.
    let fournisseur = FauxAssets::avec_fichier_hache();
    let reponse = reponse_asset(&fournisseur, "/assets/index-BDwQxbtC.js");
    let cache = reponse
        .headers()
        .get("cache-control")
        .and_then(|valeur| valeur.to_str().ok())
        .unwrap_or_default()
        .to_string();
    assert!(cache.contains("immutable"), "{cache}");
    // L'index garde son no-store : c'est lui qui porte la version.
    let index = reponse_asset(&fournisseur, "/");
    let cache_index = index
        .headers()
        .get("cache-control")
        .and_then(|valeur| valeur.to_str().ok())
        .unwrap_or_default()
        .to_string();
    assert!(cache_index.contains("no-store"), "{cache_index}");
}
