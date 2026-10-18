//! Le routeur (T049) : la politique de méthodes du manifeste, la garde
//! partagée des mutations (l'ordre du fil : méthode → origine → Content-Type
//! → taille), le repli JSON 404, et la preuve que la garde ne laisse JAMAIS
//! une mutation ratée toucher son handler — T051+ installe les vrais.

use crate::unit::support::services;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_api::router::methode_non_autorisee_lecture;
use http_api::router::routeur;
use test_support::fake_herdr::HerdrFaux;
use tower::ServiceExt;

/// Une requête sur le routeur (méthode/chemin/entêtes/corps libres).
async fn envoie(
    methode: &str,
    chemin: &str,
    entetes: &[(&str, &str)],
    corps: Vec<u8>,
) -> axum::response::Response {
    let mut demande = Request::builder().method(methode).uri(chemin);
    for (nom, valeur) in entetes {
        demande = demande.header(*nom, *valeur);
    }
    routeur(
        services(HerdrFaux::nouveau(), Default::default(), Default::default()).0,
        vec!["http://macbook.tailnet.ts.net:8791".to_string()],
    )
    .oneshot(
        demande
            .body(Body::from(corps))
            .unwrap_or_else(|cause| panic!("requête construite : {cause:?}")),
    )
    .await
    .unwrap_or_else(|cause| panic!("reponse recue : {cause:?}"))
}

/// H01–H04 sont branchés (200 avec un HerdrFaux vide) ; les routes encore en
/// attente de handler répondent 501 NOMÉ — jamais un 200 inventé.
#[tokio::test(flavor = "multi_thread")]
async fn routes_read_branchees_200() {
    for chemin in ["/api/health", "/api/overview", "/api/conversations"] {
        let reponse = envoie("GET", chemin, &[], Vec::new()).await;
        assert_eq!(reponse.status(), StatusCode::OK, "{chemin}");
    }
    // La route de session est branchée : le 404 vient du handler (agent
    // absent du snapshot), jamais du repli « route inconnue ».
    let reponse = envoie("GET", "/api/agents/w1:p1/session", &[], Vec::new()).await;
    assert_eq!(reponse.status(), StatusCode::NOT_FOUND);
    let octets = axum::body::to_bytes(reponse.into_body(), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps lu : {cause:?}"));
    let corps: serde_json::Value = serde_json::from_slice(&octets)
        .unwrap_or_else(|cause| panic!("JSON illisible : {cause:?}"));
    assert_eq!(corps["error"], "no usable session path for this agent");
}

#[tokio::test(flavor = "multi_thread")]
async fn routes_read_en_attente_501() {
    for chemin in [
        "/api/agents/kinds",
        "/api/events",
        "/api/notifications/vapid-key",
        "/api/file",
        "/api/images",
    ] {
        let reponse = envoie("GET", chemin, &[], Vec::new()).await;
        assert_eq!(
            reponse.status(),
            StatusCode::NOT_IMPLEMENTED,
            "{chemin} — pas encore de handler : 501, jamais un faux 200"
        );
    }
}

/// Les mutations H05–H07/H10–H12 sont branchées (T051) : la garde passe et
/// le handler répond — plus jamais 501 pour elles.
#[tokio::test(flavor = "multi_thread")]
async fn routes_mutation_branchees_repondent() {
    for chemin in [
        "/api/agents/w1:p1/prompt",
        "/api/agents/w1:p1/stop",
        "/api/workspaces/w1/agents",
        "/api/agents/w1:p1/answer",
        "/api/agents/w1:p1/focus",
        "/api/agents/w1:p1/trust",
    ] {
        let reponse = envoie(
            "POST",
            chemin,
            &[
                ("origin", "http://localhost"),
                ("content-type", "application/json"),
            ],
            br#"{"text":"bonjour","numero":1,"accept":true,"kind":"pi"}"#.to_vec(),
        )
        .await;
        assert_ne!(
            reponse.status(),
            StatusCode::NOT_IMPLEMENTED,
            "{chemin} — un handler est branché"
        );
    }
}

/// Les mutations qui restent en attente de handler (T052) répondent 501
/// NOMÉ — jamais un 200 inventé.
#[tokio::test(flavor = "multi_thread")]
async fn routes_mutation_en_attente_501_avec_origine() {
    for chemin in ["/api/log", "/api/notifications/subscriptions"] {
        let reponse = envoie(
            "POST",
            chemin,
            &[
                ("origin", "http://localhost"),
                ("content-type", "application/json"),
            ],
            br#"{}"#.to_vec(),
        )
        .await;
        assert_eq!(
            reponse.status(),
            StatusCode::NOT_IMPLEMENTED,
            "{chemin} — la garde passe, le handler manque : 501"
        );
    }
}

/// La lecture sur une route de lecture : GET et HEAD, pas le reste.
#[tokio::test(flavor = "multi_thread")]
async fn lecture_post_405_allow() {
    let reponse = envoie("POST", "/api/overview", &[], Vec::new()).await;
    assert_eq!(reponse.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(
        reponse
            .headers()
            .get("allow")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("GET, HEAD")
    );
    assert_eq!(
        reponse
            .headers()
            .get("content-type")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("application/json")
    );
}

/// La mutation sur une route de mutation : **méthode d'abord** — un GET sans
/// origine est 405 (Allow: POST), pas 403 : la politique court avant la garde.
#[tokio::test(flavor = "multi_thread")]
async fn mutation_get_405_allow_post_sans_origine() {
    let reponse = envoie("GET", "/api/agents/w1:p1/prompt", &[], Vec::new()).await;
    assert_eq!(reponse.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(
        reponse
            .headers()
            .get("allow")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("POST")
    );
}

/// La garde : origine absente → 403, corps nommé, sans action.
#[tokio::test(flavor = "multi_thread")]
async fn garde_origine_absente_403() {
    let reponse = envoie(
        "POST",
        "/api/agents/w1:p1/prompt",
        &[("content-type", "application/json")],
        br#"{"prompt":"bonjour"}"#.to_vec(),
    )
    .await;
    assert_eq!(reponse.status(), StatusCode::FORBIDDEN);
    let octets = axum::body::to_bytes(reponse.into_body(), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps lu : {cause:?}"));
    let corps: serde_json::Value = serde_json::from_slice(&octets)
        .unwrap_or_else(|cause| panic!("JSON illisible : {cause:?}"));
    assert!(corps["error"].is_string());
}

/// La garde : origine étrangère (liste EXACTE, jamais un motif) → 403.
#[tokio::test(flavor = "multi_thread")]
async fn garde_origine_etrangere_403() {
    let reponse = envoie(
        "POST",
        "/api/agents/w1:p1/prompt",
        &[
            ("origin", "https://evilmachine.example.com"),
            ("content-type", "application/json"),
        ],
        br#"{"prompt":"bonjour"}"#.to_vec(),
    )
    .await;
    assert_eq!(reponse.status(), StatusCode::FORBIDDEN);
}

/// La garde : Content-Type non JSON → 415, avant toute lecture du corps.
#[tokio::test(flavor = "multi_thread")]
async fn garde_content_type_415() {
    let reponse = envoie(
        "POST",
        "/api/agents/w1:p1/prompt",
        &[
            ("origin", "http://localhost"),
            ("content-type", "text/plain"),
        ],
        br#"bonjour"#.to_vec(),
    )
    .await;
    assert_eq!(reponse.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

/// La garde : taille déclarée > 64 Kio → 413 AVANT lecture (économie de
/// mémoire) — le corps n'est pas transmis.
#[tokio::test(flavor = "multi_thread")]
async fn garde_taille_declaree_413() {
    let reponse = envoie(
        "POST",
        "/api/agents/w1:p1/prompt",
        &[
            ("origin", "http://localhost"),
            ("content-type", "application/json"),
            ("content-length", "70000"),
        ],
        Vec::new(),
    )
    .await;
    assert_eq!(reponse.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

/// Le repli: `/api/*` inconnu → JSON 404 (C08), jamais le HTML par accident.
#[tokio::test(flavor = "multi_thread")]
async fn api_inconnu_json_404() {
    let reponse = envoie("GET", "/api/nimporte/quoi", &[], Vec::new()).await;
    assert_eq!(reponse.status(), StatusCode::NOT_FOUND);
    let octets = axum::body::to_bytes(reponse.into_body(), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps lu : {cause:?}"));
    let valeur: serde_json::Value = serde_json::from_slice(&octets)
        .unwrap_or_else(|cause| panic!("JSON illisible : {cause:?}"));
    assert_eq!(valeur["error"], "route inconnue");
}

/// Hors `/api` : la PWA n'est pas montée (T054) — 503 nommé.
#[tokio::test(flavor = "multi_thread")]
async fn hors_api_503_pwa_absente() {
    let reponse = envoie("GET", "/", &[], Vec::new()).await;
    assert_eq!(reponse.status(), StatusCode::SERVICE_UNAVAILABLE);
    let octets = axum::body::to_bytes(reponse.into_body(), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps lu : {cause:?}"));
    let valeur: serde_json::Value = serde_json::from_slice(&octets)
        .unwrap_or_else(|cause| panic!("JSON illisible : {cause:?}"));
    assert_eq!(valeur["error"], "PWA not built");
}

/// La politique de lecture (C08), unitaire : 405 + `Allow: GET, HEAD`.
#[test]
fn methode_non_autorisee_lecture_porte_allow() {
    let reponse = methode_non_autorisee_lecture(Request::new(Body::empty()));
    assert_eq!(reponse.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(
        reponse
            .headers()
            .get("allow")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("GET, HEAD")
    );
}
