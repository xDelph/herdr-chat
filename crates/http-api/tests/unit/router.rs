//! Tests du routeur (T049, C08) : politique de méthodes, garde partagée,
//! fallback JSON 404. Les handlers sont des stubs — la politique est le sujet.

use axum::body::Body;
use axum::extract::Request;
use axum::http::Method;
use axum::http::header::{ALLOW, CONTENT_TYPE, ORIGIN};
use axum::response::{IntoResponse, Response};
use http_api::router::{Handlers, fallback_json_404, methode_non_autorisee_post, routeur};
use tower::ServiceExt;

/// Répond 200 avec le nom du stub — prouve QUE le bon handler a été appelé.
fn repondre(nom: &'static str) -> Response {
    (axum::http::StatusCode::OK, nom).into_response()
}

macro_rules! stub {
    ($nom:ident) => {
        fn $nom(_: Request) -> Response {
            repondre(stringify!($nom))
        }
    };
}

stub!(sante);
stub!(overview);
stub!(conversations);
stub!(session_agent);
stub!(prompt);
stub!(arret);
stub!(lancement);
stub!(types_installes);
stub!(catalogue_modeles);
stub!(reponse_question);
stub!(focus);
stub!(confiance);
stub!(journal_client);
stub!(flux_sse);
stub!(cle_vapid);
stub!(abonnements);
stub!(fichier);
stub!(images);

fn stubs() -> Handlers {
    Handlers {
        sante,
        overview,
        conversations,
        session_agent,
        prompt,
        arret,
        lancement,
        types_installes,
        catalogue_modeles,
        reponse_question,
        focus,
        confiance,
        journal_client,
        flux_sse,
        cle_vapid,
        abonnements,
        fichier,
        images,
        fallback: fallback_json_404,
    }
}

fn origines() -> Vec<String> {
    vec![
        "http://127.0.0.1:8791".to_string(),
        "https://macbook.ts.net".to_string(),
    ]
}

/// Une requête POST mutante valide (origine + JSON + petit corps).
fn post_valide(chemin: &str) -> Request {
    Request::builder()
        .method(Method::POST)
        .uri(chemin)
        .header(ORIGIN, "http://127.0.0.1:8791")
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap_or_else(|cause| panic!("requête valide : {cause}"))
}

async fn corps_texte(reponse: Response) -> String {
    let corps = axum::body::to_bytes(reponse.into_body(), usize::MAX)
        .await
        .unwrap_or_else(|cause| panic!("corps lisible : {cause}"));
    String::from_utf8_lossy(&corps).into_owned()
}

async fn attend(chemin: &str, methode: Method) -> Response {
    routeur(&stubs(), origines())
        .oneshot(
            Request::builder()
                .method(methode)
                .uri(chemin)
                .body(Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("le routeur répond : {cause}"))
}

#[tokio::test]
async fn lecture_get_200() {
    let reponse = attend("/api/health", Method::GET).await;
    assert_eq!(reponse.status(), 200);
    assert_eq!(corps_texte(reponse).await, "sante");
}

#[tokio::test]
async fn lecture_head_200_sans_corps() {
    let reponse = attend("/api/overview", Method::HEAD).await;
    assert_eq!(reponse.status(), 200);
}

#[tokio::test]
async fn lecture_post_405_allow() {
    let reponse = attend("/api/health", Method::POST).await;
    assert_eq!(reponse.status(), 405);
    assert_eq!(
        reponse.headers().get(ALLOW).and_then(|v| v.to_str().ok()),
        Some("GET, HEAD")
    );
    // Le corps du 405 est bien JSON {error} (C08).
    let corps = corps_texte(reponse).await;
    assert!(corps.contains("method not allowed"));
}

#[tokio::test]
async fn toutes_les_lectures_acceptent_get() {
    for chemin in [
        "/api/health",
        "/api/overview",
        "/api/conversations",
        "/api/agents/w1:p1/session",
        "/api/agents/kinds",
        "/api/agents/pi/models",
        "/api/events",
        "/api/notifications/vapid-key",
        "/api/file?path=/x.png",
        "/api/images",
    ] {
        let reponse = attend(chemin, Method::GET).await;
        assert_eq!(reponse.status(), 200, "{chemin} doit répondre 200 en GET");
    }
}

#[tokio::test]
async fn toutes_les_lectures_refusent_post_405() {
    for chemin in [
        "/api/health",
        "/api/overview",
        "/api/conversations",
        "/api/agents/w1:p1/session",
        "/api/agents/kinds",
        "/api/agents/pi/models",
        "/api/events",
        "/api/notifications/vapid-key",
        "/api/file?path=/x.png",
        "/api/images",
    ] {
        let reponse = attend(chemin, Method::POST).await;
        assert_eq!(reponse.status(), 405, "{chemin} doit refuser POST en 405");
    }
}

#[tokio::test]
async fn mutation_post_valide_200() {
    let reponse = routeur(&stubs(), origines())
        .oneshot(post_valide("/api/agents/w1:p1/prompt"))
        .await
        .unwrap_or_else(|cause| panic!("le routeur répond : {cause}"));
    assert_eq!(reponse.status(), 200);
    assert_eq!(corps_texte(reponse).await, "prompt");
}

#[tokio::test]
async fn toutes_les_mutations_acceptent_post_valide() {
    for chemin in [
        "/api/agents/w1:p1/prompt",
        "/api/agents/w1:p1/stop",
        "/api/workspaces/w1/agents",
        "/api/agents/w1:p1/answer",
        "/api/agents/w1:p1/focus",
        "/api/agents/w1:p1/trust",
        "/api/log",
        "/api/notifications/subscriptions",
    ] {
        let reponse = routeur(&stubs(), origines())
            .oneshot(post_valide(chemin))
            .await
            .unwrap_or_else(|cause| panic!("le routeur répond : {cause}"));
        assert_eq!(
            reponse.status(),
            200,
            "{chemin} doit accepter un POST valide"
        );
    }
}

#[tokio::test]
async fn mutation_get_405_avant_la_garde() {
    // L'ordre du fil : MÉTHODE d'abord — un GET sans origine ne doit pas
    // être un 403 mais un 405.
    let reponse = attend("/api/agents/w1:p1/prompt", Method::GET).await;
    assert_eq!(reponse.status(), 405);
    assert_eq!(
        reponse.headers().get(ALLOW).and_then(|v| v.to_str().ok()),
        Some("POST")
    );
}

#[tokio::test]
async fn mutation_origine_absente_403() {
    let reponse = routeur(&stubs(), origines())
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/agents/w1:p1/prompt")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("le routeur répond : {cause}"));
    assert_eq!(reponse.status(), 403);
    // Aucune action avant validation : le stub n'a pas été appelé.
    let corps = corps_texte(reponse).await;
    assert!(corps.contains("missing origin"), "{corps}");
}

#[tokio::test]
async fn mutation_origine_etrangere_403_avec_les_deux() {
    let reponse = routeur(&stubs(), origines())
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/agents/w1:p1/prompt")
                .header(ORIGIN, "http://evil.com")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("le routeur répond : {cause}"));
    assert_eq!(reponse.status(), 403);
    let corps = corps_texte(reponse).await;
    assert!(corps.contains("unauthorized origin"), "{corps}");
    assert!(corps.contains("http://evil.com"), "{corps}");
}

#[tokio::test]
async fn mutation_content_type_non_json_415() {
    let reponse = routeur(&stubs(), origines())
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/agents/w1:p1/prompt")
                .header(ORIGIN, "http://localhost")
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(Body::from("a=b"))
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("le routeur répond : {cause}"));
    assert_eq!(reponse.status(), 415);
}

#[tokio::test]
async fn mutation_taille_declaree_au_dela_413() {
    let reponse = routeur(&stubs(), origines())
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/agents/w1:p1/prompt")
                .header(ORIGIN, "http://localhost")
                .header(CONTENT_TYPE, "application/json")
                .header("content-length", "70000")
                .body(Body::from("{}"))
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("le routeur répond : {cause}"));
    assert_eq!(reponse.status(), 413);
}

#[tokio::test]
async fn mutation_loopback_passe_sans_config() {
    // Une origine de la machine (localhost) passe même hors liste.
    let reponse = routeur(&stubs(), vec![])
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/agents/w1:p1/prompt")
                .header(ORIGIN, "http://localhost:5173")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("le routeur répond : {cause}"));
    assert_eq!(reponse.status(), 200);
}

#[tokio::test]
async fn api_inconnu_json_404() {
    let reponse = attend("/api/rien-du-tout", Method::GET).await;
    assert_eq!(reponse.status(), 404);
    assert_eq!(
        reponse
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/json")
    );
    let corps = corps_texte(reponse).await;
    assert!(corps.contains("route inconnue"), "{corps}");
}

#[tokio::test]
async fn api_inconnu_post_404_pas_405() {
    // Une route ABSENTE n'est pas une mauvaise méthode : 404, pas 405.
    let reponse = attend("/api/rien-du-tout", Method::POST).await;
    assert_eq!(reponse.status(), 404);
}

#[tokio::test]
async fn hors_api_pwa_non_construite_503() {
    // La PWA n'est pas encore montée (T054) : le 503 honnête du fil.
    let reponse = attend("/", Method::GET).await;
    assert_eq!(reponse.status(), 503);
    let corps = corps_texte(reponse).await;
    assert!(corps.contains("PWA not built"), "{corps}");
}

#[tokio::test]
async fn methode_non_autorisee_post_est_le_fallback_des_mutations() {
    let reponse = methode_non_autorisee_post(Request::new(Body::empty()));
    assert_eq!(reponse.status(), 405);
    assert_eq!(
        reponse.headers().get(ALLOW).and_then(|v| v.to_str().ok()),
        Some("POST")
    );
}
