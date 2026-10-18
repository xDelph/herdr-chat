//! Tests du corps borné (T049, C09) : la taille RÉELLE, même chunked.

use axum::body::Body;
use http_api::corps::{lire_corps_borne, verifie_prompt};
use http_api::router::methode_non_autorisee_post;

#[tokio::test]
async fn petit_corps_passe() {
    let octets = lire_corps_borne(Body::from("{\"ok\":true}"), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("un petit corps passe : {cause:?}"));
    assert_eq!(octets, b"{\"ok\":true}");
}

#[tokio::test]
async fn corps_a_la_limite_exacte_passe() {
    let corps = vec![b'x'; 64 * 1024];
    let octets = lire_corps_borne(Body::from(corps.clone()), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("64 KiB exacts passent : {cause:?}"));
    assert_eq!(octets, corps);
}

#[tokio::test]
async fn corps_au_dela_de_la_limite_413() {
    let reponse = lire_corps_borne(Body::from(vec![b'x'; 64 * 1024 + 1]), 64 * 1024)
        .await
        .err()
        .unwrap_or_else(|| panic!("un octet de trop est refusé"));
    assert_eq!(reponse.status(), 413);
}

#[tokio::test]
async fn corps_chunked_sans_longueur_declaree_413() {
    // C09 : pas de Content-Length — la lecture tranche quand même.
    let reponse = lire_corps_borne(Body::from(vec![b'x'; 70 * 1024]), 64 * 1024)
        .await
        .err()
        .unwrap_or_else(|| panic!("chunked, la taille réelle est tranchée à la lecture"));
    assert_eq!(reponse.status(), 413);
}

#[tokio::test]
async fn corps_vide_passe() {
    let octets = lire_corps_borne(Body::empty(), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("un corps vide passe : {cause:?}"));
    assert!(octets.is_empty());
}

#[tokio::test]
async fn verifie_prompt_dans_la_limite() {
    let texte = "réponds-moi".repeat(1000);
    assert!(texte.len() <= 32 * 1024);
    verifie_prompt(&texte)
        .unwrap_or_else(|cause| panic!("un prompt raisonnable passe : {cause:?}"));
}

#[tokio::test]
async fn verifie_prompt_au_dela_413() {
    let texte = "é".repeat(20 * 1024); // 40 KiB UTF-8 (2 octets par é)
    assert!(texte.len() > 32 * 1024);
    let reponse = verifie_prompt(&texte)
        .err()
        .unwrap_or_else(|| panic!("le prompt est borné en octets UTF-8"));
    assert_eq!(reponse.status(), 413);
}

#[tokio::test]
async fn verifie_prompt_compte_les_octets_pas_les_caracteres() {
    // 20 000 caractères mais 40 000 octets : c'est la taille UTF-8 qui compte.
    let texte = "é".repeat(20_000);
    assert_eq!(texte.chars().count(), 20_000);
    let reponse = verifie_prompt(&texte)
        .err()
        .unwrap_or_else(|| panic!("les octets UTF-8, pas les caractères"));
    assert_eq!(reponse.status(), 413);
}

#[tokio::test]
async fn methode_non_autorisee_post_405_allow() {
    let reponse = methode_non_autorisee_post(axum::http::Request::new(Body::empty()));
    assert_eq!(reponse.status(), 405);
    assert_eq!(
        reponse.headers().get("allow").and_then(|v| v.to_str().ok()),
        Some("POST")
    );
    assert_eq!(
        reponse
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
        Some("application/json")
    );
}

#[tokio::test]
async fn methode_non_autorisee_lecture_405_allow() {
    let reponse =
        http_api::router::methode_non_autorisee_lecture(axum::http::Request::new(Body::empty()));
    assert_eq!(reponse.status(), 405);
    assert_eq!(
        reponse.headers().get("allow").and_then(|v| v.to_str().ok()),
        Some("GET, HEAD")
    );
}
