//! T056 — la composition : les ports entrent, un routeur qui RÉPOND sort.
//!
//! ⚠️ Les ports sont des faux : aucun socket Herdr, aucun fichier, aucun
//! catalogue lancé. Ce qui est vérifié ici est le CÂBLAGE — socket publié,
//! chemins de la configuration, ports effectivement utilisés — pas le
//! comportement des adaptateurs (chacun a ses tests).
//! Prouve : O01.

use application::commands::launch::ConstructeurArgs;
use application::conversations::{ErreurDeLecture, LitSessions};
use application::overview::{ResoutSessions, SourceDeSession};
use application::ports::{
    ArtifactPort, AuthorizedFileRequest, AuthorizedRoots, CatalogPort, ControlPort, ImageScan,
    PortFuture, SessionPort,
};
use application::types_installes::{InventaireTypes, TypeInstalle};
use domain::catalog::{CatalogObservation, InstalledKindInstance, LaunchChoice, ValidatedArgs};
use domain::errors::PortError;
use domain::ids::PaneId;
use domain::session::SessionPageOutcome;
use domain::session::{ResolvedSource, SessionHint, SessionMetadata, SessionPageRequest};
use herdrchat::composition::{Ports, direct, services};
use herdrchat::config::config_depuis_avec;
use http_api::assets::SansAssets;
use std::collections::HashMap;
use std::sync::Arc;

/// La configuration de test — le launcher Tailscale est injecté (aucun CLI
/// réel n'est appelé).
fn config() -> herdrchat::config::Config {
    let mut env = HashMap::new();
    env.insert(String::from("HERDR_REMOTE_PORT"), String::from("8791"));
    config_depuis_avec(&env, std::path::Path::new("/Users/test"), &AucunServeur)
        .unwrap_or_else(|erreur| panic!("configuration : {}", erreur.detail))
}

/// Aucun `tailscale serve` n'est lancé par la configuration de test.
struct AucunServeur;

impl herdrchat::config::LanceStatutServe for AucunServeur {
    /// Aucune CLI : la configuration ne découvre aucune origine Serve, ce qui
    /// est exactement le cas d'un poste sans tailnet.
    fn lance(&self, _argv: &[&str], _delai: std::time::Duration) -> Result<String, String> {
        Err(String::from("aucun tailscale dans ce test"))
    }
}

struct SansSessions;

impl SessionPort for SansSessions {
    fn resolve(
        &self,
        _hint: SessionHint,
    ) -> domain::ports::SessionFuture<'_, Option<ResolvedSource>> {
        Box::pin(async { Ok(None) })
    }

    fn page(
        &self,
        _request: SessionPageRequest,
    ) -> domain::ports::SessionFuture<'_, SessionPageOutcome> {
        Box::pin(async {
            Ok(SessionPageOutcome::Invalide {
                detail: String::from("pas de source"),
            })
        })
    }

    fn metadata(
        &self,
        _source: ResolvedSource,
    ) -> domain::ports::SessionFuture<'_, SessionMetadata> {
        Box::pin(async { Ok(SessionMetadata::default()) })
    }
}

struct SansCatalogue;

impl CatalogPort for SansCatalogue {
    fn catalog(&self, kind: &domain::ids::AgentKind) -> PortFuture<'_, CatalogObservation> {
        let kind = kind.clone();
        Box::pin(async move {
            Ok(CatalogObservation {
                kind,
                error: Some(String::from("aucun adaptateur")),
                models: Vec::new(),
                thinking_levels: Vec::new(),
                source: String::new(),
            })
        })
    }

    fn installed(&self) -> PortFuture<'_, Vec<InstalledKindInstance>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn validate_launch(&self, _choice: LaunchChoice) -> PortFuture<'_, ValidatedArgs> {
        Box::pin(async {
            Err(PortError::Unsupported {
                feature: String::from("aucun adaptateur"),
            })
        })
    }
}

struct SansArtefacts;

impl ArtifactPort for SansArtefacts {
    fn open(&self, _request: AuthorizedFileRequest) -> PortFuture<'_, domain::ports::ArtifactBody> {
        Box::pin(async {
            Err(PortError::PathRejected {
                detail: String::from("aucun adaptateur"),
            })
        })
    }

    fn recent_images(&self, _roots: AuthorizedRoots) -> PortFuture<'_, ImageScan> {
        Box::pin(async { Ok(ImageScan { images: Vec::new() }) })
    }
}

struct SansResout;

impl ResoutSessions for SansResout {
    fn source_de(&self, _agent: &domain::observation::AgentObservation) -> Option<SourceDeSession> {
        None
    }
}

struct SansLecture;

impl ResoutSessions for SansLecture {
    fn source_de(&self, _agent: &domain::observation::AgentObservation) -> Option<SourceDeSession> {
        None
    }
}

impl LitSessions for SansLecture {
    fn fenetre(
        &self,
        _pane: &PaneId,
        _source: &SourceDeSession,
    ) -> Result<Vec<application::conversations::EntreeLu>, ErreurDeLecture> {
        Err(ErreurDeLecture {
            benin: true,
            cause: String::from("aucun adaptateur"),
        })
    }
}

struct TypesVides;

impl InventaireTypes for TypesVides {
    fn installes(
        &self,
    ) -> Result<Vec<TypeInstalle>, application::types_installes::ErreurInventaire> {
        Ok(Vec::new())
    }
}

struct SansBranche;

impl application::conversations::BrancheDeProjet for SansBranche {
    fn branche(&self, _cwd: &str) -> Option<String> {
        None
    }
}

/// Les ports du câblage — tous factices, aucun I/O.
fn ports(controle: Arc<dyn ControlPort>) -> Ports {
    let args: Arc<ConstructeurArgs> = Arc::new(Box::new(
        |_kind: &str, _modele: Option<&str>, _thinking: Option<&str>| {
            Err(String::from("aucun adaptateur"))
        },
    ));
    Ports {
        controle,
        sessions: Arc::new(SansSessions),
        catalogue: Arc::new(SansCatalogue),
        artefacts: Arc::new(SansArtefacts),
        notifications: None,
        resout: Arc::new(SansResout),
        lit_sessions: Arc::new(SansLecture),
        types: Arc::new(TypesVides),
        branche: Arc::new(SansBranche),
        args,
    }
}

#[test]
fn la_composition_publie_le_socket_et_les_chemins_de_la_configuration() {
    let config = config();
    let faux = test_support::fake_herdr::HerdrFaux::nouveau();
    let journal = direct();
    let services = services(
        &config,
        ports(Arc::new(faux)),
        journal,
        Arc::new(application::diagnostics::SinkMuet),
        Arc::new(SansAssets),
    );
    // H01 publiera ces deux chemins : ce sont ceux de la configuration, pas
    // des chemins reconstruits.
    assert_eq!(
        services.socket,
        config.herdr_socket_path.display().to_string()
    );
    assert_eq!(
        services.journal_chemin.as_deref(),
        Some(config.log_path.display().to_string()).as_deref()
    );
    assert_eq!(
        services.racines_extra.len(),
        config.racines_fichiers_extra.len()
    );
    // Sans service push composé, la capacité est ABSENTE (503), jamais un
    // substitut.
    assert!(services.notifications.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn le_routeur_compose_repond_a_la_sante() {
    use tower::ServiceExt as _;
    let config = config();
    let faux = test_support::fake_herdr::HerdrFaux::nouveau();
    let services = Arc::new(services(
        &config,
        ports(Arc::new(faux)),
        direct(),
        Arc::new(application::diagnostics::SinkMuet),
        Arc::new(SansAssets),
    ));
    let socket = services.socket.clone();
    let reponse = http_api::router::routeur(Arc::clone(&services), vec![])
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/health")
                .body(axum::body::Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause}"));
    assert_eq!(reponse.status(), 200);
    let octets = axum::body::to_bytes(reponse.into_body(), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause}"));
    let corps: serde_json::Value =
        serde_json::from_slice(&octets).unwrap_or_else(|cause| panic!("JSON : {cause}"));
    assert_eq!(corps["ok"], true);
    assert_eq!(corps["herdr"]["socket"], socket);
}
