//! L'équipement de test du crate : services composés avec des faux, aucune
//! dépendance au réel (ni socket, ni fichiers, ni horloge système).

use application::commands::focus::FocaliseurAgent;
use application::commands::launch::{HorlogeMoteur, LanceurAgent};
use application::commands::prompt::EnvoieurPrompt;
use application::commands::stop::ArreteurAgent;
use application::conversations::{
    BrancheDeProjet, EntreeLu, ErreurDeLecture, LitSessions, ServiceConversations,
};
use application::overview::ResoutSessions;
pub(crate) use application::overview::SourceDeSession;
use application::refresh::{ServiceSnapshots, SourceMaintenant};
use application::state::ObservationBorne;
use application::types_installes::{ErreurInventaire, InventaireTypes, TypeInstalle};
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use domain::catalog::{CatalogObservation, ValidatedArgs};
use domain::errors::ErreurDomaine;
use domain::errors::PortError as ErreurPort;
use domain::ids::{PaneId, TabId, WorkspaceId};
use domain::observation::{
    AgentObservation, AgentSessionRef, SessionRefKind, Snapshot, SnapshotProvenance,
    TabObservation, WorkspaceObservation,
};
use domain::ports::{
    ArtifactBody, ArtifactPort, AuthorizedFileRequest, AuthorizedRoots, CatalogPort, ImageScan,
    PortFuture, RecentImageObservation,
};
use domain::ports::{SessionFuture, SessionPort};
use domain::session::{
    ResolvedSource, SessionHint, SessionMetadata, SessionPage, SessionPageOutcome,
    SessionPageRequest,
};
use domain::status::AgentStatus;
use http_api::services::Services;
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};
use test_support::fake_herdr::HerdrFaux;
use tower::ServiceExt;

/// Une horloge injectable : l'instant est choisi par le test.
#[derive(Clone)]
pub(crate) struct MaintenantTest {
    pub instant: Arc<Mutex<Instant>>,
}

impl MaintenantTest {
    pub(crate) fn nouveau(instant: Instant) -> Self {
        Self {
            instant: Arc::new(Mutex::new(instant)),
        }
    }
}

impl SourceMaintenant for MaintenantTest {
    fn maintenant(&self) -> Instant {
        *self.instant.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Un agent minimal — les champs que les routes lisent.
pub(crate) fn agent(
    pane: &str,
    kind: &str,
    session: Option<(SessionRefKind, &str)>,
) -> AgentObservation {
    AgentObservation {
        pane_id: PaneId::from(String::from(pane)),
        tab_id: TabId::from(String::from("t1")),
        workspace_id: WorkspaceId::from(String::from("w1")),
        terminal_id: String::from("term"),
        revision: 1,
        status: AgentStatus::Blocked,
        focused: false,
        agent: Some(domain::ids::AgentKind::from(String::from(kind))),
        name: Some(domain::ids::AgentName::from(String::from("nom"))),
        terminal_title: Some(String::from("titre")),
        cwd: Some(String::from("/projets/atelier")),
        foreground_cwd: None,
        completion_seq: None,
        state_change_seq: None,
        session: session.map(|(kind, valeur)| AgentSessionRef {
            kind,
            value: String::from(valeur),
        }),
    }
}

/// Une observation avec son snapshot minimal — le workspace et le tab
/// suffisent au nommage.
pub(crate) fn borne(agents: Vec<AgentObservation>) -> ObservationBorne {
    let photo = Snapshot {
        agents,
        provenance: Some(SnapshotProvenance {
            version: String::from("0.9.3"),
            protocol: 22,
        }),
        workspaces: vec![WorkspaceObservation {
            workspace_id: WorkspaceId::from(String::from("w1")),
            label: Some(String::from("atelier")),
            agent_status: None,
            focused: None,
            number: None,
            pane_count: Some(1),
            tab_count: Some(1),
            active_tab_id: None,
            worktree: None,
        }],
        tabs: Some(vec![TabObservation {
            tab_id: TabId::from(String::from("t1")),
            workspace_id: WorkspaceId::from(String::from("w1")),
            label: Some(String::from("1")),
            number: 1,
            agent_status: None,
            pane_count: Some(1),
        }]),
        ..Snapshot::default()
    };
    ObservationBorne {
        generation: 1,
        observe_a: Instant::now(),
        snapshot: photo,
    }
}

/// Le faux lecteur de fenêtre de la liste — le même que celui de T039 :
/// sources et fenêtres par pane.
#[derive(Debug, Clone)]
pub(crate) struct FauxSessions {
    pub sources: BTreeMap<PaneId, Option<SourceDeSession>>,
    pub lectures: BTreeMap<PaneId, Result<Vec<EntreeLu>, ErreurDeLecture>>,
    pub en_vol: Arc<AtomicU64>,
    pub pics: Arc<AtomicU64>,
    pub porte: Arc<(Mutex<bool>, Condvar)>,
}

/// La variante vide par défaut : sources et fenêtres vides, porte ouverte.
impl Default for FauxSessions {
    fn default() -> Self {
        Self::nouveau()
    }
}

impl FauxSessions {
    pub(crate) fn nouveau() -> Self {
        Self {
            sources: BTreeMap::new(),
            lectures: BTreeMap::new(),
            en_vol: Arc::new(AtomicU64::new(0)),
            pics: Arc::new(AtomicU64::new(0)),
            porte: Arc::new((Mutex::new(true), Condvar::new())),
        }
    }

    pub(crate) fn avec_source(mut self, pane: &str, source: Option<SourceDeSession>) -> Self {
        self.sources
            .insert(PaneId::from(String::from(pane)), source);
        self
    }

    pub(crate) fn avec_lecture(
        mut self,
        pane: &str,
        lu: Result<Vec<EntreeLu>, ErreurDeLecture>,
    ) -> Self {
        self.lectures.insert(PaneId::from(String::from(pane)), lu);
        self
    }
}

impl ResoutSessions for FauxSessions {
    fn source_de(&self, agent: &AgentObservation) -> Option<SourceDeSession> {
        self.sources.get(&agent.pane_id).cloned().flatten()
    }
}

impl LitSessions for FauxSessions {
    fn fenetre(
        &self,
        pane: &PaneId,
        _source: &SourceDeSession,
    ) -> Result<Vec<EntreeLu>, ErreurDeLecture> {
        let en_vol = self.en_vol.fetch_add(1, Ordering::SeqCst) + 1;
        self.pics.fetch_max(en_vol, Ordering::SeqCst);
        let mut verrou = self.porte.0.lock().unwrap_or_else(PoisonError::into_inner);
        while !*verrou {
            verrou = self
                .porte
                .1
                .wait(verrou)
                .unwrap_or_else(PoisonError::into_inner);
        }
        drop(verrou);
        self.en_vol.fetch_sub(1, Ordering::SeqCst);
        match self.lectures.get(pane) {
            Some(Ok(entrees)) => Ok(entrees.clone()),
            Some(Err(panne)) => Err(panne.clone()),
            None => Ok(Vec::new()),
        }
    }
}

/// La branche : une table simple par cwd.
pub(crate) fn branche_simple(cwd: &str, branche: &str) -> Box<dyn BrancheDeProjet> {
    #[derive(Clone)]
    struct Simple(String, String);
    impl BrancheDeProjet for Simple {
        fn branche(&self, cwd: &str) -> Option<String> {
            (cwd == self.0).then(|| self.1.clone())
        }
    }
    Box::new(Simple(String::from(cwd), String::from(branche)))
}

/// Le faux port de session détaillée (H04) : résolutions scriptées + pages
/// scriptées (le dernier élément se répète), et les demandes de page
/// enregistrées pour prouver ce que le handler a transmis.
#[derive(Clone, Default)]
pub(crate) struct FauxSessionPort {
    interieur: Arc<Mutex<FauxSessionInterieur>>,
}

#[derive(Default)]
struct FauxSessionInterieur {
    resolutions: VecDeque<Option<ResolvedSource>>,
    pages: VecDeque<Result<SessionPageOutcome, ErreurDomaine>>,
    demandes: Vec<SessionPageRequest>,
}

impl FauxSessionPort {
    pub(crate) fn nouveau() -> Self {
        Self::default()
    }

    pub(crate) fn avec_source(self, source: Option<ResolvedSource>) -> Self {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .resolutions
            .push_back(source);
        self
    }

    pub(crate) fn avec_page(self, page: Result<SessionPageOutcome, ErreurDomaine>) -> Self {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pages
            .push_back(page);
        self
    }

    pub(crate) fn demandes(&self) -> Vec<SessionPageRequest> {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .demandes
            .clone()
    }

    fn resolution(&self) -> Option<Option<ResolvedSource>> {
        let mut interieur = self
            .interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if interieur.resolutions.is_empty() {
            return Some(None);
        }
        if interieur.resolutions.len() == 1 {
            interieur.resolutions.back().cloned()
        } else {
            interieur.resolutions.pop_front()
        }
    }

    fn page(&self) -> Result<SessionPageOutcome, ErreurDomaine> {
        let mut interieur = self
            .interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if interieur.pages.is_empty() {
            return Ok(SessionPageOutcome::Vide(page_vide()));
        }
        if interieur.pages.len() == 1 {
            interieur.pages.back().cloned()
        } else {
            interieur.pages.pop_front()
        }
        .unwrap_or(Ok(SessionPageOutcome::Vide(page_vide())))
    }
}

impl SessionPort for FauxSessionPort {
    fn resolve(&self, _hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
        let resolution = self.resolution();
        Box::pin(async move { Ok(resolution.unwrap_or(None)) })
    }

    fn page(&self, demande: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .demandes
            .push(demande);
        let page = self.page();
        Box::pin(async move { page })
    }

    fn metadata(&self, _source: ResolvedSource) -> SessionFuture<'_, SessionMetadata> {
        Box::pin(async { Ok(SessionMetadata::default()) })
    }
}

/// Une page vide prête — le défaut du faux.
pub(crate) fn page_vide() -> SessionPage {
    SessionPage {
        session_path: "/sessions/pi/wx.jsonl".to_string(),
        entries: Vec::new(),
        incremental: false,
        cursor: None,
        previous_cursor: None,
        has_more: false,
        reset: false,
        rattrape: false,
    }
}

/// Les services prêts pour une requête — le HerdrFaux est partagé entre les
/// snapshots et les lectures d'écran (la même instance, le même monde).
#[allow(clippy::type_complexity)]
pub(crate) fn services(
    herdr: HerdrFaux,
    faux_sessions: FauxSessions,
    session_port: Arc<FauxSessionPort>,
) -> (Arc<Services>, HerdrFaux) {
    let maintenant: Arc<dyn SourceMaintenant> = Arc::new(MaintenantTest::nouveau(Instant::now()));
    let debut = Instant::now();
    let snapshots = Arc::new(ServiceSnapshots::nouveau(
        Box::new(herdr.clone()),
        Arc::clone(&maintenant),
    ));
    let conversations = ServiceConversations::nouveau(
        Box::new(faux_sessions.clone()),
        branche_simple("/projets/atelier", "plan/rust-backend"),
    );
    let services = Arc::new(Services {
        snapshots,
        port: Arc::new(herdr.clone()),
        conversations: Arc::new(conversations),
        resout: Arc::new(faux_sessions),
        sessions: session_port,
        socket: "/tmp/herdr-remote/herdr.sock".to_string(),
        maintenant,
        debut,
        journal_chemin: Some("/tmp/herdr-remote/herdr.log".to_string()),
        prompt: Arc::new(EnvoieurPrompt::nouveau()),
        arret: ArreteurAgent::nouveau(),
        focus: FocaliseurAgent::nouveau(),
        lancement: Arc::new(LanceurAgent::nouveau()),
        args: Arc::new(Box::new(
            |kind: &str, _modele: Option<&str>, _thinking: Option<&str>| {
                // La validation INJECTÉE (T030) : les types mesurés passent, les
                // autres sont refusés — jamais devinés.
                if matches!(kind, "pi" | "claude" | "codex") {
                    Ok(vec![String::from("--mode"), String::from(kind)])
                } else {
                    Err(format!("unsupported kind: {kind}"))
                }
            },
        )),
        horloge: Arc::new(HorlogeTest),
        types: Arc::new(InventaireFaux::defaut()),
        catalogue: Arc::new(FauxCatalogue::defaut()),
        artefacts: Arc::new(FauxArtefacts::defaut()),
        racines_extra: Vec::new(),
        notifications: None,
    });
    (services, herdr)
}

/// Une requête GET complète sur le routeur — le corps est décodé en JSON.
pub(crate) async fn requete_get(
    routeur: Router<()>,
    chemin: &str,
) -> (StatusCode, serde_json::Value) {
    let reponse = routeur
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(chemin)
                .body(Body::empty())
                .unwrap_or_else(|cause| panic!("requête construite : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("reponse recue : {cause:?}"));
    let statut = reponse.status();
    let corps = axum::body::to_bytes(reponse.into_body(), 64 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps lu : {cause:?}"));
    let valeur: serde_json::Value =
        serde_json::from_slice(&corps).unwrap_or_else(|cause| panic!("JSON illisible : {cause:?}"));
    (statut, valeur)
}

/// Une requête GET **brute** : statut, en-têtes et octets — pour les corps
/// non JSON (fichier, clef VAPID en texte brut) que `requete_get` refuse de
/// décoder en JSON (et c'est voulu : un JSON illisible doit se voir).
pub(crate) async fn get_brut(routeur: Router<()>, chemin: &str) -> axum::response::Response {
    routeur
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(chemin)
                .body(Body::empty())
                .unwrap_or_else(|cause| panic!("requête construite : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("reponse recue : {cause:?}"))
}

/// Une mutation complète (origine loopback + JSON) : la garde passe, le
/// handler est le sujet. Le corps est rendu en JSON décodé.
pub(crate) async fn envoie_post(
    routeur: Router<()>,
    chemin: &str,
    corps: Vec<u8>,
) -> (StatusCode, serde_json::Value) {
    let reponse = routeur
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(chemin)
                .header("origin", "http://localhost")
                .header("content-type", "application/json")
                .body(Body::from(corps))
                .unwrap_or_else(|cause| panic!("requête construite : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("reponse recue : {cause:?}"));
    let statut = reponse.status();
    let octets = axum::body::to_bytes(reponse.into_body(), 256 * 1024)
        .await
        .unwrap_or_else(|cause| panic!("corps lu : {cause:?}"));
    // Un corps vide (204) rend une valeur nulle, jamais une erreur de lecture.
    let valeur: serde_json::Value = if octets.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&octets).unwrap_or_else(|cause| panic!("JSON illisible : {cause:?}"))
    };
    (statut, valeur)
}

/// Une requête complète (méthode/chemin libres) — pour la politique 405.
#[allow(clippy::needless_pass_by_value)]
pub(crate) async fn requete(
    routeur: Router<()>,
    methode: &str,
    chemin: &str,
) -> axum::response::Response {
    routeur
        .oneshot(
            Request::builder()
                .method(methode)
                .uri(chemin)
                .body(Body::empty())
                .unwrap_or_else(|cause| panic!("requête construite : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("reponse recue : {cause:?}"))
}

/// L'horloge du moteur de lancement : rien n'attend réellement.
pub(crate) struct HorlogeTest;

impl HorlogeMoteur for HorlogeTest {
    fn attend(&self, _duree: Duration) {}
    fn ecoule(&self) -> Duration {
        Duration::ZERO
    }
}

/// L'inventaire des types installés — scripté, jamais un processus lancé.
pub(crate) struct InventaireFaux {
    types: Vec<TypeInstalle>,
    panne: Option<ErreurInventaire>,
}

impl InventaireFaux {
    /// Le défaut : `pi` et `claude` installés et lisibles, `cursor` installé
    /// mais NON lisible (rien n'a été mesuré pour lui), `gemini` absent.
    pub(crate) fn defaut() -> Self {
        Self {
            types: vec![
                TypeInstalle {
                    commande: String::from("pi"),
                    cible: String::from("pi"),
                    installe: true,
                },
                TypeInstalle {
                    commande: String::from("claude"),
                    cible: String::from("claude"),
                    installe: true,
                },
                TypeInstalle {
                    commande: String::from("cursor-agent"),
                    cible: String::from("cursor"),
                    installe: true,
                },
                TypeInstalle {
                    commande: String::from("gemini"),
                    cible: String::from("gemini"),
                    installe: false,
                },
            ],
            panne: None,
        }
    }

    /// La découverte en panne : le lancement doit refuser (503), pas créer
    /// un onglet pour un agent qui n'existe peut-être pas.
    pub(crate) fn en_panne(detail: &str) -> Self {
        Self {
            types: Vec::new(),
            panne: Some(ErreurInventaire::Indisponible {
                detail: String::from(detail),
            }),
        }
    }

    pub(crate) fn avec(mut self, type_installe: TypeInstalle) -> Self {
        self.types.push(type_installe);
        self
    }
}

impl InventaireTypes for InventaireFaux {
    fn installes(&self) -> Result<Vec<TypeInstalle>, ErreurInventaire> {
        match &self.panne {
            Some(panne) => Err(panne.clone()),
            None => Ok(self.types.clone()),
        }
    }
}

/// Les services du défaut, avec une retouche — les tests qui ont besoin d'un
/// faux précis n'écrivent pas la composition entière (et le défaut reste le
/// même pour tous).
pub(crate) fn services_retouches(
    herdr: HerdrFaux,
    retouche: impl FnOnce(&mut Services),
) -> Arc<Services> {
    let (services, _) = services(herdr, FauxSessions::default(), Arc::default());
    let mut copie = (*services).clone();
    retouche(&mut copie);
    Arc::new(copie)
}

/// Les services avec un inventaire de types choisi — les autres services de
/// commande restent ceux du défaut.
pub(crate) fn services_avec_types(herdr: HerdrFaux, inventaire: InventaireFaux) -> Arc<Services> {
    services_retouches(herdr, |services| {
        services.types = Arc::new(inventaire);
    })
}

/// Le faux catalogue (H09) : un catalogue par type, ou une panne nommée.
pub(crate) struct FauxCatalogue {
    observations: BTreeMap<String, CatalogObservation>,
    panne: Option<ErreurPort>,
}

impl FauxCatalogue {
    /// Le défaut : un catalogue mesuré pour `pi`, rien pour les autres.
    pub(crate) fn defaut() -> Self {
        let mut observations = BTreeMap::new();
        observations.insert(
            String::from("pi"),
            CatalogObservation {
                kind: domain::ids::AgentKind::from(String::from("pi")),
                error: None,
                models: vec![domain::catalog::AgentModel {
                    label: Some(String::from("Claude Sonnet 4.5")),
                    id: String::from("anthropic/claude-sonnet-4-5"),
                    thinking_levels: vec![String::from("low"), String::from("high")],
                }],
                thinking_levels: vec![String::from("low"), String::from("high")],
                source: String::from("pi --list-models"),
            },
        );
        // Un type sans mécanisme de listage : liste VIDE et erreur nommée,
        // jamais une liste inventée.
        observations.insert(
            String::from("cursor"),
            CatalogObservation {
                kind: domain::ids::AgentKind::from(String::from("cursor")),
                error: Some(String::from("no catalog mechanism for cursor")),
                models: Vec::new(),
                thinking_levels: Vec::new(),
                source: String::new(),
            },
        );
        Self {
            observations,
            panne: None,
        }
    }

    pub(crate) fn en_panne(panne: ErreurPort) -> Self {
        Self {
            observations: BTreeMap::new(),
            panne: Some(panne),
        }
    }
}

impl CatalogPort for FauxCatalogue {
    fn catalog(&self, kind: &domain::ids::AgentKind) -> PortFuture<'_, CatalogObservation> {
        let resultat = match (&self.panne, self.observations.get(kind.as_str())) {
            (Some(panne), _) => Err(panne.clone()),
            (None, Some(observation)) => Ok(observation.clone()),
            // Un type inconnu du faux : catalogue vide avec son erreur —
            // c'est une VALEUR, jamais une panne du port.
            (None, None) => Ok(CatalogObservation {
                kind: kind.clone(),
                error: Some(format!("unsupported kind: {}", kind.as_str())),
                models: Vec::new(),
                thinking_levels: Vec::new(),
                source: String::new(),
            }),
        };
        Box::pin(async move { resultat })
    }

    fn installed(&self) -> PortFuture<'_, Vec<domain::catalog::InstalledKindInstance>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn validate_launch(
        &self,
        _choice: domain::catalog::LaunchChoice,
    ) -> PortFuture<'_, ValidatedArgs> {
        Box::pin(async {
            Err(ErreurPort::Unsupported {
                feature: String::from("la validation n'est pas le sujet de ce faux"),
            })
        })
    }
}

/// Le faux port d'artefacts (H17/H18) : un corps scripté, des images
/// scriptées, ou un refus nommé — et la capture des demandes.
#[derive(Clone)]
pub(crate) struct FauxArtefacts {
    corps: Result<ArtifactBody, ErreurPort>,
    images: Result<Vec<RecentImageObservation>, ErreurPort>,
    demandes: Arc<Mutex<Vec<AuthorizedFileRequest>>>,
}

impl FauxArtefacts {
    /// Le défaut : un fichier texte rendu inline — jamais un binaire inventé.
    pub(crate) fn defaut() -> Self {
        Self {
            corps: Ok(ArtifactBody {
                content_type: String::from("text/plain; charset=utf-8"),
                filename: Some(String::from("notes.txt")),
                inline: true,
                bytes: b"bonjour".to_vec(),
            }),
            images: Ok(Vec::new()),
            demandes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(crate) fn avec_corps(corps: ArtifactBody) -> Self {
        Self {
            corps: Ok(corps),
            images: Ok(Vec::new()),
            demandes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(crate) fn refuse(panne: ErreurPort) -> Self {
        Self {
            corps: Err(panne.clone()),
            images: Err(panne),
            demandes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(crate) fn avec_images(images: Vec<RecentImageObservation>) -> Self {
        Self {
            corps: Self::defaut().corps,
            images: Ok(images),
            demandes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(crate) fn demandes(&self) -> Vec<AuthorizedFileRequest> {
        self.demandes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl ArtifactPort for FauxArtefacts {
    fn open(&self, request: AuthorizedFileRequest) -> PortFuture<'_, ArtifactBody> {
        self.demandes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(request);
        let resultat = self.corps.clone();
        Box::pin(async move { resultat })
    }

    fn recent_images(&self, _roots: AuthorizedRoots) -> PortFuture<'_, ImageScan> {
        let resultat = self.images.clone().map(|images| ImageScan { images });
        Box::pin(async move { resultat })
    }
}
