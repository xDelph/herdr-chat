//! H17 `GET /api/file?path=` et H18 `GET /api/images`.
//!
//! ⚠️ Ce qui n'est pas dans la liste blanche est **téléchargé**, jamais rendu
//! (S07) ; un refus est un **403 nommé** avec sa raison réelle.
//! ⚠️ Les racines autorisées sont celles du **snapshot de la requête** — un
//! projet disparu cesse d'être lisible.

use crate::unit::support::{FauxArtefacts, requete_get, services_retouches};
use axum::http::StatusCode;
use domain::errors::PortError;
use domain::ports::{ArtifactBody, RecentImageObservation};
use http_api::router::routeur;
use std::sync::Arc;
use test_support::fake_herdr::HerdrFaux;

/// Une requête GET brute (les en-têtes et le corps comptent pour H17).
async fn get_brut(
    services: Arc<http_api::services::Services>,
    uri: &str,
) -> axum::response::Response {
    crate::unit::support::get_brut(routeur(services, vec![]), uri).await
}

#[tokio::test(flavor = "multi_thread")]
async fn fichier_200_entetes_exacts() {
    let faux_artefacts = Arc::new(FauxArtefacts::avec_corps(ArtifactBody {
        content_type: String::from("text/plain; charset=utf-8"),
        filename: Some(String::from("notes.txt")),
        inline: true,
        bytes: b"bonjour".to_vec(),
    }));
    let partage = Arc::clone(&faux_artefacts);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.artefacts = partage;
    });
    let reponse = get_brut(services, "/api/file?path=/projets/atelier/notes.txt").await;
    assert_eq!(reponse.status(), StatusCode::OK);
    assert_eq!(
        reponse
            .headers()
            .get("content-type")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("text/plain; charset=utf-8")
    );
    assert_eq!(
        reponse
            .headers()
            .get("content-disposition")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("inline; filename=\"notes.txt\"")
    );
    assert_eq!(
        reponse
            .headers()
            .get("content-length")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("7")
    );
    assert_eq!(
        reponse
            .headers()
            .get("cache-control")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("no-store")
    );
    let corps = axum::body::to_bytes(reponse.into_body(), 4096)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause:?}"));
    assert_eq!(&corps[..], b"bonjour");
    // La demande a voyagé intacte jusqu'au port (le chemin, jamais découpé).
    let demandes = faux_artefacts.demandes();
    assert_eq!(demandes.len(), 1);
    assert_eq!(demandes[0].requested, "/projets/atelier/notes.txt");
}

#[tokio::test(flavor = "multi_thread")]
async fn fichier_200_non_inline_est_telecharge() {
    // Le SVG n'est jamais interprété : il peut porter du script (S07).
    let faux_artefacts = Arc::new(FauxArtefacts::avec_corps(ArtifactBody {
        content_type: String::from("image/svg+xml"),
        filename: Some(String::from("logo.svg")),
        inline: false,
        bytes: b"<svg/>".to_vec(),
    }));
    let partage = Arc::clone(&faux_artefacts);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.artefacts = partage;
    });
    let reponse = get_brut(services, "/api/file?path=/projets/atelier/logo.svg").await;
    assert_eq!(reponse.status(), StatusCode::OK);
    assert_eq!(
        reponse
            .headers()
            .get("content-disposition")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("attachment; filename=\"logo.svg\"")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn fichier_403_parametre_absent() {
    let services = services_retouches(HerdrFaux::nouveau(), |_| {});
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/file").await;
    assert_eq!(statut, StatusCode::FORBIDDEN);
    assert_eq!(corps["error"], "missing `path` parameter");
}

#[tokio::test(flavor = "multi_thread")]
async fn fichier_403_parametre_vide() {
    let services = services_retouches(HerdrFaux::nouveau(), |_| {});
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/file?path=").await;
    assert_eq!(statut, StatusCode::FORBIDDEN);
    assert_eq!(corps["error"], "missing `path` parameter");
}

#[tokio::test(flavor = "multi_thread")]
async fn fichier_403_raison_reelle_du_port() {
    // Le refus porte la raison EXACTE du port — jamais un message générique.
    let faux_artefacts = Arc::new(FauxArtefacts::refuse(PortError::PathRejected {
        detail: String::from("outside the project folders"),
    }));
    let partage = Arc::clone(&faux_artefacts);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.artefacts = partage;
    });
    let (statut, corps) =
        requete_get(routeur(services, vec![]), "/api/file?path=/etc/passwd").await;
    assert_eq!(statut, StatusCode::FORBIDDEN);
    let message = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(message.contains("outside the project folders"), "{message}");
}

#[tokio::test(flavor = "multi_thread")]
async fn fichier_403_snapshot_illisible() {
    // Sans snapshot, on ne sait pas quelles racines sont autorisées : donc
    // aucune ne l'est — 403 nommé, pas une lecture au hasard.
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Transport {
        detail: String::from("socket fermé"),
    });
    let services = services_retouches(faux, |_| {});
    let (statut, corps) = requete_get(
        routeur(services, vec![]),
        "/api/file?path=/projets/atelier/notes.txt",
    )
    .await;
    assert_eq!(statut, StatusCode::FORBIDDEN);
    assert_eq!(corps["error"], "Herdr illisible");
}

#[tokio::test(flavor = "multi_thread")]
async fn images_200_liste() {
    let faux_artefacts = Arc::new(FauxArtefacts::avec_images(vec![RecentImageObservation {
        modified_at: 1_792_000_000_000,
        path: String::from("/projets/atelier/capture.png"),
        size: 2048,
    }]));
    let partage = Arc::clone(&faux_artefacts);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.artefacts = partage;
    });
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/images").await;
    assert_eq!(statut, StatusCode::OK);
    let images = corps["images"]
        .as_array()
        .unwrap_or_else(|| panic!("images"));
    assert_eq!(images.len(), 1);
    assert_eq!(images[0]["path"], "/projets/atelier/capture.png");
    assert_eq!(images[0]["size"], 2048);
    assert_eq!(images[0]["modifiedAt"], 1_792_000_000_000_u64);
}

#[tokio::test(flavor = "multi_thread")]
async fn images_502_balayage_en_panne() {
    let faux_artefacts = Arc::new(FauxArtefacts::refuse(PortError::Transport {
        detail: String::from("disque lent"),
    }));
    let partage = Arc::clone(&faux_artefacts);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.artefacts = partage;
    });
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/images").await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert_eq!(corps["error"], "balayage impossible");
}

#[tokio::test(flavor = "multi_thread")]
async fn images_502_snapshot_illisible() {
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Transport {
        detail: String::from("socket fermé"),
    });
    let services = services_retouches(faux, |_| {});
    let (statut, corps) = requete_get(routeur(services, vec![]), "/api/images").await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert_eq!(corps["error"], "Herdr illisible");
}

#[tokio::test(flavor = "multi_thread")]
async fn fichier_les_racines_viennent_du_snapshot_plus_la_config() {
    // Les racines de la requête : le dossier du projet (snapshot) ET les
    // racines médias de la configuration — réévaluées à CHAQUE requête.
    let faux = HerdrFaux::nouveau();
    let mut observation = crate::unit::support::agent("w1:p1", "pi", None);
    observation.cwd = Some(String::from("/projets/atelier"));
    let mut photo = crate::unit::support::borne(vec![observation]).snapshot;
    photo.workspaces[0].label = Some(String::from("atelier"));
    faux.repond_snapshot(photo);
    let faux_artefacts = Arc::new(FauxArtefacts::defaut());
    let partage = Arc::clone(&faux_artefacts);
    let services = services_retouches(faux, move |services| {
        services.artefacts = partage;
        services.racines_extra = vec![String::from("/Users/moi/Desktop")];
    });
    // Le corps servi est du TEXTE (pas du JSON) : lecture brute.
    let reponse = get_brut(services, "/api/file?path=/projets/atelier/notes.txt").await;
    assert_eq!(reponse.status(), StatusCode::OK);
    let demandes = faux_artefacts.demandes();
    let racines = &demandes[0].roots.entries;
    assert_eq!(
        racines,
        &vec![
            String::from("/projets/atelier"),
            String::from("/Users/moi/Desktop")
        ],
        "dossiers des projets puis racines médias"
    );
}
