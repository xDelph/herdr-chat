//! H20 — GET `/api/agents/{paneId}/taches` et H21 — GET
//! `/api/agents/{paneId}/taches/{id}/session` : les tâches de fond d'un
//! agent et la transcription de l'une d'elles. Chaque issue nommée a son
//! statut ; une capacité absente est une VALEUR (`supported:false`).

use crate::unit::support::{
    FauxSessionPort, FauxSessions, SourceDeSession, agent, borne, requete_get, services,
};
use application::conversations::{GenreTache, StatutTache, TacheDeFond};
use axum::http::StatusCode;
use domain::observation::SessionRefKind;
use domain::session::{SessionEntry, SessionPage, SessionPageOutcome, SourceKind};
use http_api::router::routeur;
use std::sync::Arc;
use test_support::fake_herdr::HerdrFaux;

fn herdr_avec_agent(pane: &str) -> HerdrFaux {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(
        borne(vec![agent(
            pane,
            "claude",
            Some((SessionRefKind::Path, "/claude/-projet/s1.jsonl")),
        )])
        .snapshot,
    );
    faux
}

fn source() -> SourceDeSession {
    SourceDeSession {
        kind: SessionRefKind::Path,
        base: Some(String::from("/claude/-projet/s1.jsonl")),
        session_id: None,
        cwd: None,
        parent: None,
    }
}

fn tache(id: &str, statut: StatutTache, transcription: bool) -> TacheDeFond {
    TacheDeFond {
        id: String::from(id),
        genre: GenreTache::Agent,
        description: Some(String::from("Audit du flux")),
        type_agent: Some(String::from("general-purpose")),
        statut,
        debut: Some(1_000),
        fin: None,
        derniere_activite: Some(2_000),
        resume: None,
        transcription,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn taches_200_la_liste_au_format_du_contrat() {
    let lecteur = FauxSessions::nouveau()
        .avec_source("w1:p1", Some(source()))
        .avec_taches(Ok(vec![
            tache("a1", StatutTache::EnCours, true),
            TacheDeFond {
                genre: GenreTache::Commande,
                type_agent: None,
                description: None,
                ..tache("b1", StatutTache::Inconnu, false)
            },
        ]));
    let (etat, _) = services(
        herdr_avec_agent("w1:p1"),
        lecteur,
        Arc::new(FauxSessionPort::nouveau()),
    );
    let (statut, corps) = requete_get(routeur(etat, vec![]), "/api/agents/w1:p1/taches").await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["paneId"], "w1:p1");
    assert_eq!(corps["supported"], true);
    let taches = corps["tasks"].as_array().cloned().unwrap_or_default();
    assert_eq!(taches.len(), 2);
    assert_eq!(taches[0]["status"], "en_cours");
    assert_eq!(taches[0]["kind"], "agent");
    assert_eq!(taches[0]["agentType"], "general-purpose");
    assert_eq!(taches[0]["startedAt"], 1_000);
    assert_eq!(taches[0]["transcript"], true);
    assert!(taches[0].get("endedAt").is_none(), "absent, jamais null");
    assert_eq!(taches[1]["status"], "inconnu");
    assert_eq!(taches[1]["kind"], "commande");
    assert!(taches[1].get("description").is_none());
    // Le contrat décode la réponse telle quelle.
    let decode: Result<contracts::http::taches::BackgroundTasksResponse, _> =
        serde_json::from_value(corps.clone());
    assert!(decode.is_ok(), "{decode:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn taches_capacite_absente_est_une_valeur() {
    let lecteur = FauxSessions::nouveau().avec_source("w1:p1", Some(source()));
    let (etat, _) = services(
        herdr_avec_agent("w1:p1"),
        lecteur,
        Arc::new(FauxSessionPort::nouveau()),
    );
    let (statut, corps) = requete_get(routeur(etat, vec![]), "/api/agents/w1:p1/taches").await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["supported"], false);
    assert_eq!(corps["tasks"], serde_json::json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn taches_404_pane_inconnu_ou_sans_session_et_502_en_panne() {
    let lecteur = FauxSessions::nouveau().avec_taches(Ok(Vec::new()));
    let (etat, _) = services(
        herdr_avec_agent("w1:p1"),
        lecteur,
        Arc::new(FauxSessionPort::nouveau()),
    );
    let route = routeur(etat, vec![]);
    let (statut, _) = requete_get(route.clone(), "/api/agents/w9:p9/taches").await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    // Sans source résolue.
    let (statut, corps) = requete_get(route, "/api/agents/w1:p1/taches").await;
    assert_eq!(statut, StatusCode::NOT_FOUND);
    assert!(corps["error"].as_str().is_some());

    let panne = FauxSessions::nouveau()
        .avec_source("w1:p1", Some(source()))
        .avec_taches(Err(String::from("permission refusée")));
    let (etat, _) = services(
        herdr_avec_agent("w1:p1"),
        panne,
        Arc::new(FauxSessionPort::nouveau()),
    );
    let (statut, corps) = requete_get(routeur(etat, vec![]), "/api/agents/w1:p1/taches").await;
    assert_eq!(statut, StatusCode::BAD_GATEWAY);
    assert_eq!(corps["error"], "permission refusée", "la cause réelle");
}

#[tokio::test(flavor = "multi_thread")]
async fn session_de_tache_lit_la_transcription_par_le_port() {
    let lecteur = FauxSessions::nouveau()
        .avec_source("w1:p1", Some(source()))
        .avec_taches(Ok(vec![tache("a1", StatutTache::EnCours, true)]));
    let page = SessionPage {
        session_path: String::from("/claude/-projet/s1/subagents/agent-a1.jsonl"),
        entries: vec![SessionEntry {
            kind: String::from("message"),
            id: Some(String::from("claude:u1")),
            parent_id: None,
            raw: String::from(
                r#"{"type":"message","message":{"role":"user","content":"consigne"}}"#,
            ),
            timestamp: None,
        }],
        incremental: false,
        cursor: Some(String::from("hc2:x")),
        previous_cursor: None,
        has_more: false,
        reset: false,
        rattrape: true,
    };
    let port = Arc::new(FauxSessionPort::nouveau().avec_page(Ok(SessionPageOutcome::Page(page))));
    let (etat, _) = services(herdr_avec_agent("w1:p1"), lecteur, Arc::clone(&port));
    let (statut, corps) = requete_get(
        routeur(etat, vec![]),
        "/api/agents/w1:p1/taches/a1/session?tail=1024",
    )
    .await;
    assert_eq!(statut, StatusCode::OK);
    assert_eq!(corps["entries"].as_array().map(Vec::len), Some(1));
    // Le handler a demandé la transcription EN TANT QUE session Claude, sur
    // le chemin rendu par le lecteur de tâches.
    let demandes = port.demandes();
    assert_eq!(demandes.len(), 1);
    assert_eq!(
        demandes[0].source.base,
        "/claude/-projet/s1/subagents/agent-a1.jsonl"
    );
    assert_eq!(demandes[0].source.kind, SourceKind::File);
    assert_eq!(
        demandes[0].source.family.as_ref().map(|f| f.as_str()),
        Some("claude")
    );
    assert_eq!(demandes[0].limit, 1024);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_de_tache_404_sans_transcription_et_422_hors_racine() {
    let lecteur = FauxSessions::nouveau()
        .avec_source("w1:p1", Some(source()))
        .avec_taches(Ok(vec![tache("b1", StatutTache::Terminee, false)]));
    let port = Arc::new(
        FauxSessionPort::nouveau().avec_page(Ok(SessionPageOutcome::Invalide {
            detail: String::from("session path outside the allowed root"),
        })),
    );
    let (etat, _) = services(
        herdr_avec_agent("w1:p1"),
        lecteur.clone(),
        Arc::clone(&port),
    );
    let route = routeur(etat, vec![]);
    let (statut, _) = requete_get(route.clone(), "/api/agents/w1:p1/taches/b1/session").await;
    assert_eq!(statut, StatusCode::NOT_FOUND, "pas de transcription");
    assert!(port.demandes().is_empty(), "aucune lecture tentée");

    let lecteur = lecteur.avec_taches(Ok(vec![tache("a1", StatutTache::EnCours, true)]));
    let (etat, _) = services(herdr_avec_agent("w1:p1"), lecteur, Arc::clone(&port));
    let (statut, corps) =
        requete_get(routeur(etat, vec![]), "/api/agents/w1:p1/taches/a1/session").await;
    assert_eq!(statut, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(corps["cause"], "invalide");
}
