//! H19 `GET /api/agents/{paneId}/stream` — le flux de session (STREAMING.md).
//!
//! ⚠️ Un faux port de sessions répond selon le curseur demandé, et un faux
//! observateur fait bouger la révision à la main : on prouve que le flux
//! commence par la queue (`reset`), pousse le delta à la révision suivante
//! (`entries`, `id` = curseur), reprend exactement au `Last-Event-ID`, et
//! rend son permis quand le client part.

use crate::unit::support::{FauxObservateur, FauxSessionPort, agent, borne, services};
use axum::http::StatusCode;
use contracts::events::SessionStreamEntries;
use contracts::http::sessions::SessionResponse;
use domain::observation::SessionRefKind;
use domain::ports::{SessionFuture, SessionPort};
use domain::session::{
    ResolvedSource, SessionEntry, SessionHint, SessionMetadata, SessionPage, SessionPageOutcome,
    SessionPageRequest, SourceKind,
};
use futures_util::StreamExt as _;
use http_api::router::routeur;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use test_support::fake_herdr::HerdrFaux;
use tower::ServiceExt;

/// Un port dont le contenu grandit : `lignes` est la session entière, le
/// curseur est l'indice de la prochaine ligne (`c<N>`).
#[derive(Clone, Default)]
struct PortQuiGrandit {
    lignes: Arc<Mutex<Vec<&'static str>>>,
    demandes: Arc<Mutex<Vec<Option<String>>>>,
    /// Le chemin publié est refusé par la garde (403 sur H04).
    refuse: Arc<std::sync::atomic::AtomicBool>,
}

impl PortQuiGrandit {
    fn ajoute(&self, id: &'static str) {
        self.lignes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(id);
    }
}

fn source() -> ResolvedSource {
    ResolvedSource {
        kind: SourceKind::File,
        base: "/sessions/pi/wx.jsonl".to_string(),
        session_id: None,
        family: None,
    }
}

impl SessionPort for PortQuiGrandit {
    fn resolve(&self, _hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
        Box::pin(async { Ok(Some(source())) })
    }

    fn page(&self, demande: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
        self.demandes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(demande.cursor.clone());
        if self.refuse.load(std::sync::atomic::Ordering::SeqCst) {
            return Box::pin(async {
                Err(domain::errors::ErreurDomaine::chemin_refuse(
                    "session path outside the allowed root",
                ))
            });
        }
        let lignes = self
            .lignes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        // Un curseur que ce port ne reconnaît pas est refusé, comme le vrai
        // port (H04 : 400 `invalid cursor`).
        let depuis: usize = match demande.cursor.as_deref() {
            None => 0,
            Some(curseur) => match curseur
                .strip_prefix('c')
                .and_then(|indice| indice.parse().ok())
            {
                Some(indice) => indice,
                None => {
                    return Box::pin(async {
                        Err(domain::errors::ErreurDomaine::entree_invalide(
                            "invalid cursor",
                        ))
                    });
                }
            },
        };
        let entries: Vec<SessionEntry> = lignes
            .iter()
            .skip(depuis)
            .map(|id| SessionEntry {
                kind: String::from("message"),
                id: Some((*id).to_string()),
                parent_id: None,
                raw: format!(r#"{{"type":"message","id":"{id}","message":{{"role":"assistant","content":"{id}"}}}}"#),
                timestamp: None,
            })
            .collect();
        let page = SessionPage {
            session_path: source().base,
            entries,
            incremental: demande.cursor.is_some(),
            cursor: Some(format!("c{}", lignes.len())),
            previous_cursor: None,
            has_more: false,
            reset: false,
            rattrape: true,
        };
        Box::pin(async move { Ok(SessionPageOutcome::Page(page)) })
    }

    fn metadata(&self, _source: ResolvedSource) -> SessionFuture<'_, SessionMetadata> {
        Box::pin(async { Ok(SessionMetadata::default()) })
    }
}

#[derive(Debug)]
struct Trame {
    id: Option<String>,
    genre: String,
    donnees: String,
}

fn decode(bloc: &str) -> Option<Trame> {
    let mut id = None;
    let mut genre = None;
    let mut donnees = Vec::new();
    for ligne in bloc.lines() {
        if let Some(valeur) = ligne.strip_prefix("id:") {
            id = Some(valeur.trim().to_string());
        } else if let Some(valeur) = ligne.strip_prefix("event:") {
            genre = Some(valeur.trim().to_string());
        } else if let Some(valeur) = ligne.strip_prefix("data:") {
            donnees.push(valeur.trim_start().to_string());
        }
    }
    Some(Trame {
        id,
        genre: genre?,
        donnees: donnees.join("\n"),
    })
}

struct Client {
    flux: axum::body::BodyDataStream,
    tampon: String,
}

impl Client {
    async fn suivante(&mut self) -> Trame {
        loop {
            if let Some(fin) = self.tampon.find("\n\n") {
                let bloc: String = self.tampon.drain(..fin + 2).collect();
                if let Some(trame) = decode(&bloc) {
                    return trame;
                }
                continue;
            }
            let portion = tokio::time::timeout(Duration::from_secs(5), self.flux.next())
                .await
                .unwrap_or_else(|_| panic!("le flux n'a rien envoyé à temps"))
                .unwrap_or_else(|| panic!("le flux s'est fermé trop tôt"))
                .unwrap_or_else(|cause| panic!("le flux a échoué : {cause:?}"));
            self.tampon.push_str(&String::from_utf8_lossy(&portion));
        }
    }
}

fn monde() -> (
    Arc<http_api::services::Services>,
    PortQuiGrandit,
    FauxObservateur,
) {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(
        borne(vec![agent(
            "w1:p1",
            "pi",
            Some((SessionRefKind::Path, "/sessions/pi/wx.jsonl")),
        )])
        .snapshot,
    );
    let (services, _) = services(
        faux,
        Default::default(),
        Arc::new(FauxSessionPort::nouveau()),
    );
    let port = PortQuiGrandit::default();
    let observateur = FauxObservateur::nouveau();
    let mut retouches = (*services).clone();
    retouches.sessions = Arc::new(port.clone());
    retouches.observateur = Arc::new(observateur.clone());
    (Arc::new(retouches), port, observateur)
}

async fn ouvre(
    services: Arc<http_api::services::Services>,
    uri: &str,
    dernier_id: Option<&str>,
) -> (StatusCode, Client) {
    let mut demande = axum::http::Request::builder().method("GET").uri(uri);
    if let Some(id) = dernier_id {
        demande = demande.header("last-event-id", id);
    }
    let reponse = routeur(services, vec![])
        .oneshot(
            demande
                .body(axum::body::Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause:?}"));
    let statut = reponse.status();
    (
        statut,
        Client {
            flux: reponse.into_body().into_data_stream(),
            tampon: String::new(),
        },
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn le_flux_commence_par_la_queue_puis_pousse_le_delta() {
    let (services, port, observateur) = monde();
    port.ajoute("m1");
    port.ajoute("m2");
    let (statut, mut client) = ouvre(Arc::clone(&services), "/api/agents/w1:p1/stream", None).await;
    assert_eq!(statut, StatusCode::OK);

    let premiere = client.suivante().await;
    assert_eq!(
        premiere.genre, "reset",
        "sans curseur, la queue remplace la vue"
    );
    assert_eq!(premiere.id.as_deref(), Some("c2"));
    let page: SessionResponse = serde_json::from_str(&premiere.donnees)
        .unwrap_or_else(|cause| panic!("reset se décode contre le contrat : {cause}"));
    assert_eq!(page.entries.len(), 2);

    // L'agent écrit : la révision bouge, le delta part — et lui seul.
    port.ajoute("m3");
    observateur.ecrit();
    let suite = client.suivante().await;
    assert_eq!(suite.genre, "entries");
    assert_eq!(
        suite.id.as_deref(),
        Some("c3"),
        "l'id est le curseur après ces lignes"
    );
    let delta: SessionStreamEntries = serde_json::from_str(&suite.donnees)
        .unwrap_or_else(|cause| panic!("entries se décode contre le contrat : {cause}"));
    let ids: Vec<String> = delta
        .entries
        .iter()
        .filter_map(|entree| entree.id.clone().en_option())
        .collect();
    assert_eq!(ids, vec![String::from("m3")]);
    assert_eq!(delta.cursor, "c3");
    assert!(delta.caught_up);
}

#[tokio::test(flavor = "multi_thread")]
async fn la_reconnexion_reprend_exactement_au_dernier_id() {
    let (services, port, observateur) = monde();
    for id in ["m1", "m2", "m3"] {
        port.ajoute(id);
    }
    // Le navigateur reconnecte avec `Last-Event-ID: c2` : il avait m1, m2.
    let (statut, mut client) = ouvre(
        Arc::clone(&services),
        "/api/agents/w1:p1/stream?cursor=c0",
        Some("c2"),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let reprise = client.suivante().await;
    assert_eq!(reprise.genre, "entries", "Last-Event-ID prime sur ?cursor=");
    let delta: SessionStreamEntries =
        serde_json::from_str(&reprise.donnees).unwrap_or_else(|cause| panic!("décodage : {cause}"));
    assert_eq!(delta.entries.len(), 1, "seule m3 manquait");
    assert_eq!(
        port.demandes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .first()
            .cloned()
            .flatten()
            .as_deref(),
        Some("c2")
    );
    let _ = observateur;
}

#[tokio::test(flavor = "multi_thread")]
async fn un_last_event_id_refuse_repart_de_la_queue() {
    // Régression : le port rend désormais un curseur étranger ou illisible en
    // ERREUR (400) au lieu d'une page la plus récente ; le flux doit alors
    // repartir de la queue (reset), pas attendre en silence.
    let (services, port, _observateur) = monde();
    port.ajoute("m1");
    port.ajoute("m2");
    let (statut, mut client) = ouvre(
        Arc::clone(&services),
        "/api/agents/w1:p1/stream",
        Some("hc2:curseur-d-une-autre-session"),
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    let premiere = client.suivante().await;
    assert_eq!(premiere.genre, "reset", "un curseur refusé remplace la vue");
    let page: SessionResponse = serde_json::from_str(&premiere.donnees)
        .unwrap_or_else(|cause| panic!("reset se décode contre le contrat : {cause}"));
    assert_eq!(page.entries.len(), 2);
    let demandes = port
        .demandes
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    assert_eq!(
        demandes,
        vec![Some(String::from("hc2:curseur-d-une-autre-session")), None]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn un_pane_inconnu_est_un_404_et_le_permis_revient() {
    let (services, _port, _observateur) = monde();
    let (statut, _client) = ouvre(Arc::clone(&services), "/api/agents/w9:p9/stream", None).await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    assert_eq!(
        services.permis_flux_session.available_permits(),
        http_api::handlers::flux_session::FLUX_SESSION_MAX
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn le_client_parti_rend_son_permis() {
    let (services, port, _observateur) = monde();
    port.ajoute("m1");
    let (statut, mut client) = ouvre(Arc::clone(&services), "/api/agents/w1:p1/stream", None).await;
    assert_eq!(statut, StatusCode::OK);
    let _ = client.suivante().await;
    assert_eq!(
        services.permis_flux_session.available_permits(),
        http_api::handlers::flux_session::FLUX_SESSION_MAX - 1
    );
    drop(client);
    let mut rendu = false;
    for _ in 0..50 {
        if services.permis_flux_session.available_permits()
            == http_api::handlers::flux_session::FLUX_SESSION_MAX
        {
            rendu = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(rendu, "le permis revient quand le client part");
}

/// Une base SQLite façon opencode : la lecture vers l'avant relit la ligne
/// frontière (`seq >=`) et ne dit jamais « rattrapé ».
#[derive(Clone, Default)]
struct PortSqlite {
    contenu: Arc<Mutex<String>>,
    lectures: Arc<std::sync::atomic::AtomicUsize>,
}

impl SessionPort for PortSqlite {
    fn resolve(&self, _hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
        Box::pin(async { Ok(Some(source())) })
    }

    fn page(&self, _demande: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
        self.lectures
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let contenu = self
            .contenu
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        let page = SessionPage {
            session_path: source().base,
            entries: vec![SessionEntry {
                kind: String::from("message"),
                id: Some(String::from("opencode:frontiere")),
                parent_id: None,
                raw: contenu,
                timestamp: None,
            }],
            incremental: true,
            cursor: Some(String::from("c-frontiere")),
            previous_cursor: None,
            has_more: false,
            reset: false,
            rattrape: false,
        };
        Box::pin(async move { Ok(SessionPageOutcome::Page(page)) })
    }

    fn metadata(&self, _source: ResolvedSource) -> SessionFuture<'_, SessionMetadata> {
        Box::pin(async { Ok(SessionMetadata::default()) })
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn une_ligne_frontiere_relue_ne_fait_pas_boucler_le_flux() {
    // Mesuré sur opencode : 17 713 événements `entries` identiques en 10 s.
    let (services, _port, observateur) = monde();
    let port = PortSqlite::default();
    *port.contenu.lock().unwrap_or_else(PoisonError::into_inner) =
        String::from(r#"{"type":"message","message":{"role":"assistant","content":"Bon"}}"#);
    let mut retouches = (*services).clone();
    retouches.sessions = Arc::new(port.clone());
    let services = Arc::new(retouches);
    let (statut, mut client) = ouvre(Arc::clone(&services), "/api/agents/w1:p1/stream", None).await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(client.suivante().await.genre, "reset");

    // Une révision sans changement : rien ne part. (Avant le correctif, la
    // ligne frontière repartait sans fin, sans même attendre de révision.)
    observateur.ecrit();
    let rien = tokio::time::timeout(Duration::from_millis(400), client.suivante()).await;
    assert!(
        rien.is_err(),
        "une ligne inchangée a été réémise : {rien:?}"
    );

    // La ligne est RÉÉCRITE (la réponse grandit) : elle repart, une fois.
    *port.contenu.lock().unwrap_or_else(PoisonError::into_inner) =
        String::from(r#"{"type":"message","message":{"role":"assistant","content":"Bonjour"}}"#);
    observateur.ecrit();
    let reecrite = client.suivante().await;
    assert_eq!(reecrite.genre, "entries");
    assert!(reecrite.donnees.contains("Bonjour"), "{}", reecrite.donnees);
}

#[tokio::test(flavor = "multi_thread")]
async fn un_chemin_refuse_ferme_le_flux_avec_sa_cause() {
    // Le vrai port refuse un chemin publié hors des racines (403 sur H04) :
    // le flux le dit (`gone`, cause réelle) et se ferme — jamais une attente
    // muette de révisions qui ne serviront rien.
    let (services, port, _observateur) = monde();
    port.refuse.store(true, std::sync::atomic::Ordering::SeqCst);
    let (statut, mut client) = ouvre(Arc::clone(&services), "/api/agents/w1:p1/stream", None).await;
    assert_eq!(statut, StatusCode::OK);
    let trame = client.suivante().await;
    assert_eq!(trame.genre, "gone", "{trame:?}");
    assert!(
        trame.donnees.contains("outside the allowed root"),
        "{}",
        trame.donnees
    );
}
