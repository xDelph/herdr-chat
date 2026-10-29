//! Le travail bloquant des handlers ne gèle plus les autres requêtes : sur un
//! runtime à UN thread, une lecture de session lente laisse `/api/health`
//! répondre tout de suite.

use crate::unit::support::{FauxSessionPort, agent, borne, services};
use domain::observation::SessionRefKind;
use domain::ports::{SessionFuture, SessionPort};
use domain::session::{
    ResolvedSource, SessionHint, SessionMetadata, SessionPageOutcome, SessionPageRequest,
    SourceKind,
};
use http_api::router::routeur;
use std::sync::Arc;
use std::time::{Duration, Instant};
use test_support::fake_herdr::HerdrFaux;
use tower::ServiceExt;

/// Un port dont la lecture bloque le thread 800 ms — comme un gros fichier
/// ou une base verrouillée.
struct PortLent;

impl SessionPort for PortLent {
    fn resolve(&self, _hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
        Box::pin(async {
            Ok(Some(ResolvedSource {
                kind: SourceKind::File,
                base: String::from("/sessions/pi/lent.jsonl"),
                session_id: None,
                family: None,
            }))
        })
    }

    fn page(&self, _demande: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
        Box::pin(async {
            std::thread::sleep(Duration::from_millis(800));
            Ok(SessionPageOutcome::Vide(crate::unit::support::page_vide()))
        })
    }

    fn metadata(&self, _source: ResolvedSource) -> SessionFuture<'_, SessionMetadata> {
        Box::pin(async { Ok(SessionMetadata::default()) })
    }
}

async fn get(services: Arc<http_api::services::Services>, uri: &str) -> axum::http::StatusCode {
    routeur(services, vec![])
        .oneshot(
            axum::http::Request::builder()
                .method("GET")
                .uri(uri)
                .body(axum::body::Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause:?}"))
        .status()
}

#[tokio::test(flavor = "current_thread")]
async fn une_lecture_lente_ne_gele_pas_les_autres_requetes() {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(
        borne(vec![agent(
            "w1:p1",
            "pi",
            Some((SessionRefKind::Path, "/sessions/pi/lent.jsonl")),
        )])
        .snapshot,
    );
    let (services, _) = services(
        faux,
        Default::default(),
        Arc::new(FauxSessionPort::nouveau()),
    );
    let mut retouches = (*services).clone();
    retouches.sessions = Arc::new(PortLent);
    let services = Arc::new(retouches);

    // La mesure part AVANT la lecture lente : si elle occupe le seul thread,
    // la santé ne peut répondre qu'après elle.
    let debut = Instant::now();
    let lente = tokio::spawn(get(Arc::clone(&services), "/api/agents/w1:p1/session"));
    tokio::task::yield_now().await;
    let statut = get(Arc::clone(&services), "/api/health").await;
    let duree = debut.elapsed();
    assert!(
        statut.is_success() || statut.is_server_error(),
        "santé : {statut}"
    );
    assert!(
        duree < Duration::from_millis(400),
        "la santé attendait la lecture lente : {duree:?}"
    );
    let _ = lente.await;
}
