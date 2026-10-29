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

/// Une observation qui ne bouge jamais.
struct SansObservation;

impl application::observation::ObservateurDeSessions for SansObservation {
    fn observe(
        &self,
        _source: &application::sessions_types::ResolvedSource,
    ) -> application::observation::ObservationDeSession {
        let (_emetteur, revisions) = tokio::sync::watch::channel(0_u64);
        application::observation::ObservationDeSession::nouvelle(revisions, None, ())
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
        observateur: Arc::new(SansObservation),
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

/// `pi` est installé — le seul type que ce câblage connaît.
struct TypesPi;

impl InventaireTypes for TypesPi {
    fn installes(
        &self,
    ) -> Result<Vec<TypeInstalle>, application::types_installes::ErreurInventaire> {
        Ok(vec![TypeInstalle {
            commande: String::from("pi"),
            cible: String::from("pi"),
            installe: true,
        }])
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn le_lancement_compose_refuse_un_niveau_que_le_modele_n_offre_pas() {
    // A15 : la validation de PRODUCTION (`catalog::args::args_verifies`, que
    // `verificateur_args` applique au catalogue mesuré) passe par
    // `niveau_supporte` — ici sur un catalogue injecté (aucune CLI lancée).
    // Le refus sort en 400 avec sa cause, AVANT tout onglet.
    use tower::ServiceExt as _;
    let config = config();
    let faux = test_support::fake_herdr::HerdrFaux::nouveau();
    let mut ports = ports(Arc::new(faux.clone()));
    ports.types = Arc::new(TypesPi);
    ports.args = Arc::new(Box::new(
        |kind: &str, modele: Option<&str>, thinking: Option<&str>| {
            catalog::args::args_verifies(kind, modele, thinking, |_genre| {
                vec![catalog::adapters::ModeleCatalogue {
                    id: String::from("anthropic/claude-sonnet-4-5"),
                    libelle: None,
                    niveaux: vec![String::from("low"), String::from("high")],
                }]
            })
        },
    ));
    let services = Arc::new(services(
        &config,
        ports,
        direct(),
        Arc::new(application::diagnostics::SinkMuet),
        Arc::new(SansAssets),
    ));
    let corps = serde_json::json!({
        "kind": "pi",
        "model": "anthropic/claude-sonnet-4-5",
        "thinking": "xhigh"
    });
    let reponse = http_api::router::routeur(services, vec![])
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/workspaces/w1/agents")
                .header("origin", "http://localhost")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(corps.to_string()))
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause}"));
    let statut = reponse.status();
    let octets = axum::body::to_bytes(reponse.into_body(), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause}"));
    let corps: serde_json::Value =
        serde_json::from_slice(&octets).unwrap_or_else(|cause| panic!("JSON : {cause}"));
    assert_eq!(statut, 400, "corps : {corps}");
    let message = corps["error"].as_str().unwrap_or_default();
    assert!(
        message.contains("xhigh"),
        "la cause nomme le niveau : {message}"
    );
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != test_support::fake_herdr::Op::CreationTab),
        "aucun onglet pour une demande refusée"
    );
}

/// Une session Pi réelle, sur disque, publiée par le faux Herdr pour `pane`.
fn session_pi(dossier: &std::path::Path, nom: &str, de: usize, a: usize) -> std::path::PathBuf {
    let chemin = dossier.join(nom);
    let mut contenu = String::new();
    for n in de..a {
        contenu.push_str(&format!(
            r#"{{"type":"message","id":"m{n}","message":{{"role":"user","content":"texte {n}"}}}}"#
        ));
        contenu.push('\n');
    }
    std::fs::write(&chemin, contenu).unwrap_or_else(|cause| panic!("écriture : {cause}"));
    chemin
}

async fn get(routeur: axum::Router, uri: &str) -> (u16, serde_json::Value) {
    use tower::ServiceExt as _;
    let reponse = routeur
        .oneshot(
            axum::http::Request::builder()
                .uri(uri)
                .body(axum::body::Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause}"));
    let statut = reponse.status().as_u16();
    let octets = axum::body::to_bytes(reponse.into_body(), 1024 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause}"));
    (
        statut,
        serde_json::from_slice(&octets).unwrap_or(serde_json::Value::Null),
    )
}

fn encode(curseur: &serde_json::Value) -> String {
    curseur
        .as_str()
        .unwrap_or_else(|| panic!("curseur attendu : {curseur}"))
        .bytes()
        .map(|octet| match octet {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (octet as char).to_string()
            }
            autre => format!("%{autre:02X}"),
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn la_matrice_des_curseurs_passe_par_le_vrai_port_de_sessions() {
    // H04/C04/C12 : la VRAIE lecture (`sessions::port::PortSessions`, ses
    // curseurs versionnés) derrière le routeur composé — plus un faux qui
    // injecte l'erreur. Illisible, exclusif, étranger → 400 ; chemin hors
    // racines → 403 ; historique d'un fichier remplacé → 409 ; base SQLite
    // absente → 503.
    static COMPTEUR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dossier = std::env::temp_dir().join(format!(
        "herdrchat-curseurs-{}-{}",
        std::process::id(),
        COMPTEUR.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dossier);
    std::fs::create_dir_all(&dossier).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    let a = session_pi(&dossier, "a.jsonl", 0, 4);
    let b = session_pi(&dossier, "b.jsonl", 50, 54);

    let mut photo = test_support::fixtures::snapshot_de_base();
    let mut agent_a = photo.agents[0].clone();
    agent_a.agent = Some(domain::ids::AgentKind::from(String::from("pi")));
    agent_a.session = Some(domain::observation::AgentSessionRef {
        kind: domain::observation::SessionRefKind::Path,
        value: a.display().to_string(),
    });
    let mut agent_b = agent_a.clone();
    agent_b.pane_id = PaneId::from(String::from("wB:p9"));
    agent_b.session = Some(domain::observation::AgentSessionRef {
        kind: domain::observation::SessionRefKind::Path,
        value: b.display().to_string(),
    });
    // Un chemin publié HORS des racines de sessions : jamais lu.
    let dehors =
        std::env::temp_dir().join(format!("herdrchat-dehors-{}.jsonl", std::process::id()));
    let mut agent_dehors = agent_a.clone();
    agent_dehors.pane_id = PaneId::from(String::from("wB:p8"));
    agent_dehors.session = Some(domain::observation::AgentSessionRef {
        kind: domain::observation::SessionRefKind::Path,
        value: dehors.display().to_string(),
    });
    // Une session opencode dont la base n'existe pas.
    let mut agent_sqlite = agent_a.clone();
    agent_sqlite.pane_id = PaneId::from(String::from("wB:p7"));
    agent_sqlite.agent = Some(domain::ids::AgentKind::from(String::from("opencode")));
    agent_sqlite.session = Some(domain::observation::AgentSessionRef {
        kind: domain::observation::SessionRefKind::Id,
        value: String::from("ses_absente"),
    });
    let pane_a = agent_a.pane_id.to_string();
    photo.agents = vec![agent_a, agent_b, agent_dehors, agent_sqlite];
    let faux = test_support::fake_herdr::HerdrFaux::nouveau();
    faux.repond_snapshot(photo);

    let port: Arc<dyn SessionPort> = Arc::new(sessions::port::PortSessions::nouveau(
        sessions::resolver::Racines {
            pi_sessions: dossier.clone(),
            claude_projects: dossier.join("claude"),
            codex_home: dossier.join("codex-home"),
            codex_sessions: dossier.join("codex-sessions"),
            devin_db: dossier.join("devin.db"),
            opencode_db: dossier.join("opencode.db"),
        },
    ));
    let mut ports = ports(Arc::new(faux));
    ports.sessions = port;
    let services = Arc::new(services(
        &config(),
        ports,
        direct(),
        Arc::new(application::diagnostics::SinkMuet),
        Arc::new(SansAssets),
    ));
    let routeur = http_api::router::routeur(services, vec![]);

    let (statut, page_a) = get(routeur.clone(), &format!("/api/agents/{pane_a}/session")).await;
    assert_eq!(statut, 200, "{page_a}");
    let (statut, page_b) = get(routeur.clone(), "/api/agents/wB:p9/session").await;
    assert_eq!(statut, 200, "{page_b}");

    // Un chemin hors des racines : refusé (403), jamais lu.
    let (statut, corps) = get(routeur.clone(), "/api/agents/wB:p8/session").await;
    assert_eq!(statut, 403, "chemin refusé : {corps}");
    // Une base SQLite absente : indisponible (503), pas une panne (502).
    let (statut, corps) = get(routeur.clone(), "/api/agents/wB:p7/session").await;
    assert_eq!(statut, 503, "base absente : {corps}");
    // cursor + before : exclusifs.
    let (statut, corps) = get(
        routeur.clone(),
        &format!(
            "/api/agents/{pane_a}/session?cursor={}&before={}",
            encode(&page_a["cursor"]),
            encode(&page_a["previousCursor"])
        ),
    )
    .await;
    assert_eq!(statut, 400, "exclusifs : {corps}");
    // Illisible.
    let (statut, corps) = get(
        routeur.clone(),
        &format!("/api/agents/{pane_a}/session?cursor=hc2%3A%25%25%25"),
    )
    .await;
    assert_eq!(statut, 400, "illisible : {corps}");
    // Le curseur de B ne lit jamais A (C12).
    let (statut, corps) = get(
        routeur.clone(),
        &format!(
            "/api/agents/{pane_a}/session?cursor={}",
            encode(&page_b["cursor"])
        ),
    )
    .await;
    assert_eq!(statut, 400, "étranger : {corps}");
    // Le fichier de A remplacé au même chemin : son curseur d'historique est
    // périmé (409), jamais relu au milieu d'une autre session.
    let remplacant = session_pi(&dossier, "remplacant.jsonl", 100, 110);
    std::fs::rename(&remplacant, &a).unwrap_or_else(|cause| panic!("rename : {cause}"));
    let (statut, corps) = get(
        routeur.clone(),
        &format!(
            "/api/agents/{pane_a}/session?before={}",
            encode(&page_a["previousCursor"])
        ),
    )
    .await;
    assert_eq!(statut, 409, "historique périmé : {corps}");
    let _ = std::fs::remove_dir_all(&dossier);
}
