//! H14 `GET /api/events` — le flux du direct.
//!
//! ⚠️ **Un faux client `EventSource`** décode les trames (`id`/`event`/`data`)
//! et les charges **contre le contrat** : un payload qui ne se décode pas est
//! un échec, pas une tolérance.
//!
//! ⚠️ La coupure de la réponse doit **rendre le permis** : c'est le RAII de
//! l'abonnement (T043) que le handler doit laisser faire, sans le retenir
//! ailleurs.
//! Prouve : C26.

use crate::unit::support::{services, services_retouches};
use application::events::journal::Journal;
use application::events::subscription::{ABONNEMENTS_MAX, ServiceAbonnements};
use axum::http::StatusCode;
use contracts::events::{AgentStatusChanged, ChangeKind, EvenementSse, Ready, Resync};
use contracts::presence::Nullable;
use futures_util::StreamExt as _;
use http_api::router::routeur;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use test_support::fake_herdr::HerdrFaux;
use tower::ServiceExt;

/// Une trame SSE décodée — ce qu'un `EventSource` rend à l'application.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Trame {
    id: Option<String>,
    genre: String,
    donnees: String,
}

/// Le faux client : lit les trames jusqu'à en avoir `combien`, puis rend la
/// main (le flux, lui, reste ouvert côté serveur jusqu'à la chute du corps).
async fn lit_trames(
    reponse: axum::response::Response,
    combien: usize,
) -> (Vec<Trame>, axum::body::Body) {
    let mut flux = reponse.into_body().into_data_stream();
    let mut tampon = String::new();
    let mut trames = Vec::new();
    while trames.len() < combien {
        let portion = tokio::time::timeout(Duration::from_secs(5), flux.next())
            .await
            .unwrap_or_else(|_| panic!("le flux n'a rien envoyé à temps"))
            .unwrap_or_else(|| panic!("le flux s'est fermé trop tôt"))
            .unwrap_or_else(|cause| panic!("le flux a échoué : {cause:?}"));
        tampon.push_str(&String::from_utf8_lossy(&portion));
        while let Some(fin) = tampon.find("\n\n") {
            let bloc: String = tampon.drain(..fin + 2).collect();
            if let Some(trame) = decode_trame(&bloc) {
                trames.push(trame);
            }
        }
    }
    (trames, axum::body::Body::from(tampon))
}

/// Décode une trame SSE — le format du fil, commentaires ignorés.
fn decode_trame(bloc: &str) -> Option<Trame> {
    let mut id = None;
    let mut genre = None;
    let mut donnees = Vec::new();
    for ligne in bloc.lines() {
        if ligne.starts_with(':') || ligne.is_empty() {
            continue;
        }
        if let Some(valeur) = ligne.strip_prefix("id:") {
            id = Some(String::from(valeur.trim()));
        } else if let Some(valeur) = ligne.strip_prefix("event:") {
            genre = Some(String::from(valeur.trim()));
        } else if let Some(valeur) = ligne.strip_prefix("data:") {
            donnees.push(String::from(valeur.trim_start()));
        }
    }
    Some(Trame {
        id,
        genre: genre?,
        donnees: donnees.join("\n"),
    })
}

/// Ouvre le flux et rend la réponse (statut déjà vérifié par l'appelant).
async fn ouvre(
    services: Arc<http_api::services::Services>,
    dernier_id: Option<&str>,
) -> axum::response::Response {
    let mut demande = axum::http::Request::builder()
        .method("GET")
        .uri("/api/events");
    if let Some(id) = dernier_id {
        demande = demande.header("last-event-id", id);
    }
    routeur(services, vec![])
        .oneshot(
            demande
                .body(axum::body::Body::empty())
                .unwrap_or_else(|cause| panic!("requête : {cause:?}")),
        )
        .await
        .unwrap_or_else(|cause| panic!("réponse : {cause:?}"))
}

#[tokio::test(flavor = "multi_thread")]
async fn flux_entetes_et_ready() {
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let reponse = ouvre(services, None).await;
    assert_eq!(reponse.status(), StatusCode::OK);
    assert_eq!(
        reponse
            .headers()
            .get("content-type")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("text/event-stream")
    );
    assert_eq!(
        reponse
            .headers()
            .get("cache-control")
            .and_then(|valeur| valeur.to_str().ok()),
        Some("no-cache")
    );
    let (trames, _corps) = lit_trames(reponse, 1).await;
    assert_eq!(trames[0].genre, "ready");
    // `ready` n'a PAS d'identifiant : il n'appartient pas au journal.
    assert_eq!(trames[0].id, None);
    let ready: Ready = serde_json::from_str(&trames[0].donnees)
        .unwrap_or_else(|cause| panic!("ready se décode : {cause:?}"));
    assert_eq!(ready.cursor, 0, "journal vide : frontière zéro");
}

#[tokio::test(flavor = "multi_thread")]
async fn flux_sans_curseur_ne_rejoue_pas_l_historique() {
    // L'historique existe, mais une NOUVELLE fenêtre ne le rejoue pas (C11) :
    // elle part de la frontière courante après `ready`.
    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    journal
        .publie(
            "agent_status",
            serde_json::to_vec(&AgentStatusChanged {
                from: Nullable::Nulle,
                kind: ChangeKind::Appeared,
                pane_id: String::from("w1:p1"),
                to: String::from("working"),
            })
            .unwrap_or_else(|cause| panic!("charge : {cause}")),
        )
        .unwrap_or_else(|cause| panic!("publication : {cause:?}"));
    let partage = Arc::clone(&journal);
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let mut copie = (*services).clone();
    copie.journal = partage;
    let services = Arc::new(copie);
    let reponse = ouvre(services, None).await;
    let (trames, _corps) = lit_trames(reponse, 1).await;
    assert_eq!(trames.len(), 1);
    assert_eq!(trames[0].genre, "ready");
    let ready: Ready = serde_json::from_str(&trames[0].donnees)
        .unwrap_or_else(|cause| panic!("ready se décode : {cause:?}"));
    assert_eq!(ready.cursor, 1, "la frontière courante, pas zéro");
}

#[tokio::test(flavor = "multi_thread")]
async fn flux_rejoue_ce_qui_a_ete_manque() {
    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    let premier = journal
        .publie("agent_status", b"{\"paneId\":\"w1:p1\"}".to_vec())
        .unwrap_or_else(|cause| panic!("publication : {cause:?}"));
    journal
        .publie("prompt", b"{\"paneId\":\"w1:p1\"}".to_vec())
        .unwrap_or_else(|cause| panic!("publication : {cause:?}"));
    let partage = Arc::clone(&journal);
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let mut copie = (*services).clone();
    copie.journal = partage;
    let services = Arc::new(copie);
    // Le client revient avec le curseur du PREMIER événement : il doit
    // recevoir le second, et rien d'autre.
    let reponse = ouvre(services, Some(&premier.id.opaque())).await;
    let (trames, _corps) = lit_trames(reponse, 2).await;
    assert_eq!(trames[0].genre, "ready");
    assert_eq!(trames[1].genre, "prompt", "seul l'événement manqué");
    assert_eq!(trames[1].donnees, "{\"paneId\":\"w1:p1\"}");
    // L'identifiant est la forme opaque `<boot>:<séquence>`.
    let id = trames[1].id.as_deref().unwrap_or_else(|| panic!("id"));
    assert!(id.contains(':'), "identifiant opaque, pas un nombre : {id}");
}

#[tokio::test(flavor = "multi_thread")]
async fn flux_curseur_legacy_declenche_un_resync_unique() {
    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    journal
        .publie("agent_status", b"{}".to_vec())
        .unwrap_or_else(|cause| panic!("publication : {cause:?}"));
    let partage = Arc::clone(&journal);
    let (services, _) = services(HerdrFaux::nouveau(), Default::default(), Default::default());
    let mut copie = (*services).clone();
    copie.journal = partage;
    let services = Arc::new(copie);
    // Un curseur legacy numérique : la continuité n'est pas garantie.
    let reponse = ouvre(services, Some("42")).await;
    let (trames, _corps) = lit_trames(reponse, 2).await;
    assert_eq!(trames[0].genre, "ready");
    assert_eq!(trames[1].genre, "resync");
    let resync: Resync = serde_json::from_str(&trames[1].donnees)
        .unwrap_or_else(|cause| panic!("resync se décode : {cause:?}"));
    assert_eq!(resync.reason, "truncated journal");
    // Le curseur de reprise est celui du journal (1 événement publié).
    assert_eq!(resync.resume_from, 1);
    assert_eq!(
        trames[1].id.as_deref(),
        Some(format!("{}:1", journal_boot(&journal)).as_str())
    );
}

/// L'époque du journal — lue par la forme opaque du dernier identifiant.
fn journal_boot(journal: &Arc<ServiceAbonnements>) -> String {
    let abonnement = journal
        .abonne("")
        .unwrap_or_else(|refus| panic!("abonnement : {refus:?}"));
    let id = abonnement
        .dernier_id()
        .unwrap_or_else(|| panic!("un identifiant existe"));
    id.boot
}

#[tokio::test(flavor = "multi_thread")]
async fn flux_503_au_neuvieme() {
    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    // Huit abonnements ouverts : le neuvième est refusé, avec sa cause.
    let mut gardes = Vec::new();
    for _ in 0..ABONNEMENTS_MAX {
        gardes.push(
            journal
                .abonne("")
                .unwrap_or_else(|refus| panic!("abonnement : {refus:?}")),
        );
    }
    let partage = Arc::clone(&journal);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.journal = partage;
    });
    let reponse = ouvre(services, None).await;
    assert_eq!(reponse.status(), StatusCode::SERVICE_UNAVAILABLE);
    let octets = axum::body::to_bytes(reponse.into_body(), 8192)
        .await
        .unwrap_or_else(|cause| panic!("corps : {cause:?}"));
    let corps: serde_json::Value =
        serde_json::from_slice(&octets).unwrap_or_else(|cause| panic!("JSON : {cause:?}"));
    let message = corps["error"].as_str().unwrap_or_else(|| panic!("error"));
    assert!(message.contains("trop de flux"), "{message}");
    drop(gardes);
}

#[tokio::test(flavor = "multi_thread")]
async fn flux_la_coupure_rend_le_permis() {
    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    let partage = Arc::clone(&journal);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.journal = partage;
    });
    assert_eq!(journal.nb_abonnes(), 0);
    let reponse = ouvre(services, None).await;
    let (trames, corps) = lit_trames(reponse, 1).await;
    assert_eq!(trames[0].genre, "ready");
    // Le flux est ouvert : un abonnement vivant côté service.
    assert_eq!(journal.nb_abonnes(), 1);
    // Le client s'en va : la réponse tombe, l'abonnement avec elle.
    drop(corps);
    for _ in 0..50 {
        if journal.nb_abonnes() == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(journal.nb_abonnes(), 0, "la coupure rend le permis");
}

#[tokio::test(flavor = "multi_thread")]
async fn flux_live_emet_un_evenement_publie() {
    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    let partage = Arc::clone(&journal);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.journal = partage;
    });
    let reponse = ouvre(services, None).await;
    let mut flux = reponse.into_body().into_data_stream();
    // 1) `ready` d'abord.
    let mut tampon = String::new();
    let mut trames = Vec::new();
    while trames.is_empty() {
        let portion = tokio::time::timeout(Duration::from_secs(5), flux.next())
            .await
            .unwrap_or_else(|_| panic!("rien reçu"))
            .unwrap_or_else(|| panic!("flux fermé"))
            .unwrap_or_else(|cause| panic!("flux : {cause:?}"));
        tampon.push_str(&String::from_utf8_lossy(&portion));
        while let Some(fin) = tampon.find("\n\n") {
            let bloc: String = tampon.drain(..fin + 2).collect();
            if let Some(trame) = decode_trame(&bloc) {
                trames.push(trame);
            }
        }
    }
    assert_eq!(trames[0].genre, "ready");
    // 2) La publication arrive sur le direct — avec son identifiant.
    journal
        .publie(
            "session_changed",
            br#"{"paneId":"w1:p1","sourceRevision":"0123456789abcdef"}"#.to_vec(),
        )
        .unwrap_or_else(|cause| panic!("publication : {cause:?}"));
    let mut live = Vec::new();
    while live.is_empty() {
        let portion = tokio::time::timeout(Duration::from_secs(5), flux.next())
            .await
            .unwrap_or_else(|_| panic!("rien reçu sur le direct"))
            .unwrap_or_else(|| panic!("flux fermé"))
            .unwrap_or_else(|cause| panic!("flux : {cause:?}"));
        tampon.push_str(&String::from_utf8_lossy(&portion));
        while let Some(fin) = tampon.find("\n\n") {
            let bloc: String = tampon.drain(..fin + 2).collect();
            if let Some(trame) = decode_trame(&bloc) {
                live.push(trame);
            }
        }
    }
    assert_eq!(live[0].genre, "session_changed");
    assert_eq!(
        live[0].donnees,
        "{\"paneId\":\"w1:p1\",\"sourceRevision\":\"0123456789abcdef\"}"
    );
    assert!(live[0].id.is_some(), "un événement du journal a un id");
}

#[tokio::test(flavor = "multi_thread")]
async fn les_charges_du_contrat_se_decodent() {
    // Les cinq charges du journal (dont le nouveau `session_changed`) se
    // décodent TELLES QUE le serveur les émet : c'est le contrat du client.
    let charges = [
        (
            "agent_status",
            json!({
                "from": null,
                "kind": "appeared",
                "paneId": "w1:p1",
                "to": "working"
            }),
        ),
        (
            "prompt",
            json!({
                "paneId": "w1:p1",
                "confirmation": "confirmed",
                "fingerprint": "abc",
                "status": "sent"
            }),
        ),
        (
            "prompt-suppressed",
            json!({ "paneId": "w1:p1", "reason": "consecutive identical send" }),
        ),
        (
            "agent-launched",
            json!({ "kind": "pi", "paneId": "w1:p4", "workspaceId": "w1" }),
        ),
        (
            "session_changed",
            json!({ "paneId": "w1:p1", "sourceRevision": "0123456789abcdef" }),
        ),
    ];
    for (genre, charge) in charges {
        let enveloppe = json!({ "event": genre, "data": charge });
        let decode: EvenementSse = serde_json::from_value(enveloppe.clone())
            .unwrap_or_else(|cause| panic!("{genre} se decode contre le contrat : {cause:?}"));
        let vu = match &decode {
            EvenementSse::AgentStatus(_) => "agent_status",
            EvenementSse::Prompt(_) => "prompt",
            EvenementSse::PromptSuppressed(_) => "prompt-suppressed",
            EvenementSse::AgentLaunched(_) => "agent-launched",
            EvenementSse::SessionChanged(_) => "session_changed",
            EvenementSse::Ready(_) => "ready",
            EvenementSse::Resync(_) => "resync",
        };
        assert_eq!(vu, genre, "le nom decode est celui emis");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn un_client_lent_recoit_tout_sans_trou_ni_doublon() {
    // Le client ne lit pas pendant que 200 événements sont publiés : la
    // sonnette bornée (16) déborde. Chaque événement doit pourtant arriver,
    // une fois, dans l'ordre — le journal comble les trous.
    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    let partage = Arc::clone(&journal);
    let services = services_retouches(HerdrFaux::nouveau(), move |services| {
        services.journal = partage;
    });
    let reponse = ouvre(services, None).await;
    let mut flux = reponse.into_body().into_data_stream();
    let mut tampon = String::new();
    let mut trames: Vec<Trame> = Vec::new();
    // `ready` d'abord : l'abonnement est en place.
    while trames.is_empty() {
        let portion = tokio::time::timeout(Duration::from_secs(5), flux.next())
            .await
            .unwrap_or_else(|_| panic!("rien reçu"))
            .unwrap_or_else(|| panic!("flux fermé"))
            .unwrap_or_else(|cause| panic!("flux : {cause:?}"));
        tampon.push_str(&String::from_utf8_lossy(&portion));
        while let Some(fin) = tampon.find("\n\n") {
            let bloc: String = tampon.drain(..fin + 2).collect();
            if let Some(trame) = decode_trame(&bloc) {
                trames.push(trame);
            }
        }
    }
    for n in 0..200 {
        journal
            .publie(
                "session_changed",
                format!(r#"{{"paneId":"w1:p{n}","sourceRevision":"0123456789abcdef"}}"#)
                    .into_bytes(),
            )
            .unwrap_or_else(|cause| panic!("publication : {cause:?}"));
    }
    let mut recus: Vec<String> = Vec::new();
    while recus.len() < 200 {
        let portion = tokio::time::timeout(Duration::from_secs(5), flux.next())
            .await
            .unwrap_or_else(|_| panic!("il manque des événements : {} reçus", recus.len()))
            .unwrap_or_else(|| panic!("flux fermé"))
            .unwrap_or_else(|cause| panic!("flux : {cause:?}"));
        tampon.push_str(&String::from_utf8_lossy(&portion));
        while let Some(fin) = tampon.find("\n\n") {
            let bloc: String = tampon.drain(..fin + 2).collect();
            if let Some(trame) = decode_trame(&bloc)
                && trame.genre == "session_changed"
            {
                recus.push(trame.donnees);
            }
        }
    }
    let attendus: Vec<String> = (0..200)
        .map(|n| format!(r#"{{"paneId":"w1:p{n}","sourceRevision":"0123456789abcdef"}}"#))
        .collect();
    assert!(recus == attendus, "tous, une fois, dans l'ordre");
}
