//! L'adaptateur `ControlPort` (T056 suite) : les **mappages** wire → domaine.
//!
//! ⚠️ Ce qui est testé ici est la partie où une erreur coûte cher : un champ
//! omis chez Herdr qui devient une valeur inventée, un `null` confondu avec
//! `false`, une confirmation de prompt qui n'est pas la nôtre. Le socket
//! lui-même est couvert par les tests du transport ; ces cas-ci prennent la
//! donnée en main — aucune socket, aucun Herdr.

use domain::ports::{PartialStep, PromptEvidence, StartEvidence, TransportOutcome};
use domain::status::AgentStatus;
use herdr_client::port::{
    agent_depuis, ecran_depuis, erreur_de_port, observation_depuis_photo, preuve_de_prompt,
    preuve_de_transport, statut_depuis, workspace_depuis,
};
use herdr_client::wire::{
    GenreRefSession, InfoAgent, InfoSessionAgent, InfoWorkspace, PhotoSession,
};
use serde_json::json;

/// Un agent du fil, complet — la forme mesurée.
fn agent_fil() -> InfoAgent {
    serde_json::from_value(json!({
        "pane_id": "w1:p1",
        "tab_id": "w1:t1",
        "workspace_id": "w1",
        "terminal_id": "term-1",
        "revision": 7,
        "agent_status": "blocked",
        "focused": true,
        "agent": "claude",
        "name": "pixel-1",
        "terminal_title": "π - pixel",
        "cwd": "/projets/atelier",
        "agent_session": {
            "agent": "claude",
            "kind": "path",
            "source": "herdr:claude",
            "value": "/sessions/w1.jsonl"
        }
    }))
    .unwrap_or_else(|cause| panic!("agent du fil : {cause}"))
}

#[test]
fn un_agent_se_traduit_sans_rien_inventer() {
    let observation = agent_depuis(&agent_fil());
    assert_eq!(observation.pane_id.as_str(), "w1:p1");
    assert_eq!(observation.workspace_id.as_str(), "w1");
    assert_eq!(observation.status, AgentStatus::Blocked);
    assert!(observation.focused);
    assert_eq!(
        observation.agent.as_ref().map(|k| k.as_str()),
        Some("claude")
    );
    assert_eq!(
        observation.name.as_ref().map(|n| n.as_str()),
        Some("pixel-1")
    );
    let session = observation
        .session
        .as_ref()
        .unwrap_or_else(|| panic!("session exposée"));
    assert_eq!(session.value, "/sessions/w1.jsonl");
    assert_eq!(session.kind, domain::observation::SessionRefKind::Path);
}

#[test]
fn un_champ_absent_reste_absent_jamais_un_substitut() {
    // Le fil minimal : ni type, ni nom, ni titre, ni session.
    let fil: InfoAgent = serde_json::from_value(json!({
        "pane_id": "w1:p9",
        "tab_id": "w1:t1",
        "workspace_id": "w1",
        "terminal_id": "term",
        "revision": 1,
        "agent_status": "idle",
        "focused": false
    }))
    .unwrap_or_else(|cause| panic!("agent minimal : {cause}"));
    let observation = agent_depuis(&fil);
    assert!(observation.agent.is_none(), "aucun type inventé");
    assert!(observation.name.is_none());
    assert!(observation.terminal_title.is_none());
    assert!(observation.session.is_none());
    assert!(!observation.focused, "un false MESURÉ reste false");
}

#[test]
fn un_nom_vide_compte_comme_absent() {
    // Herdr peut publier une chaîne vide : elle ne nomme rien.
    let mut fil = agent_fil();
    fil.name = Some(Some(String::new()));
    fil.agent = Some(Some(String::new()));
    let observation = agent_depuis(&fil);
    assert!(observation.name.is_none());
    assert!(observation.agent.is_none());
}

#[test]
fn un_workspace_distingue_absence_et_false() {
    let absent: InfoWorkspace = serde_json::from_value(json!({
        "workspace_id": "w1"
    }))
    .unwrap_or_else(|cause| panic!("workspace minimal : {cause}"));
    // `focused` absent : on ne sait pas — `None`, pas `false`.
    assert!(workspace_depuis(&absent).focused.is_none());

    let mesure: InfoWorkspace = serde_json::from_value(json!({
        "workspace_id": "w1",
        "focused": false,
        "label": "atelier",
        "worktree": {
            "checkout_path": "/projets/atelier",
            "is_linked_worktree": true,
            "repo_key": "atelier",
            "repo_name": "atelier",
            "repo_root": "/projets/atelier"
        }
    }))
    .unwrap_or_else(|cause| panic!("workspace mesuré : {cause}"));
    let vu = workspace_depuis(&mesure);
    assert_eq!(vu.focused, Some(false), "un false mesuré reste un false");
    assert_eq!(vu.label.as_deref(), Some("atelier"));
    assert_eq!(
        vu.worktree.as_ref().map(|w| w.checkout_path.as_str()),
        Some("/projets/atelier")
    );
}

#[test]
fn la_photo_ne_declare_pas_de_tabs_qu_elle_ne_porte_pas() {
    let photo: PhotoSession = serde_json::from_value(json!({
        "agents": [],
        "workspaces": [{ "workspace_id": "w1" }],
        "protocol": 22,
        "version": "0.9.3"
    }))
    .unwrap_or_else(|cause| panic!("photo : {cause}"));
    let snapshot = observation_depuis_photo(&photo);
    // ⚠️ `session.snapshot` ne porte ni tabs ni layouts : les déclarer (même
    // vides) ferait croire qu'on a regardé.
    assert!(snapshot.tabs.is_none());
    assert!(snapshot.layouts.is_none());
    let provenance = snapshot
        .provenance
        .as_ref()
        .unwrap_or_else(|| panic!("provenance"));
    assert_eq!(provenance.protocol, 22);
    assert_eq!(provenance.version, "0.9.3");
    assert_eq!(snapshot.workspaces.len(), 1);
}

#[test]
fn un_ecran_vide_n_invente_pas_de_texte() {
    use herdr_client::client::SourceLecture;
    let pane = domain::ids::PaneId::from(String::from("w1:p1"));
    let vide = ecran_depuis(&pane, (String::new(), false), SourceLecture::Recent);
    assert!(vide.text.is_none(), "pas de texte vide présenté comme lu");
    assert_eq!(vide.source, Some(domain::observation::ReadSource::Recent));
    assert_eq!(vide.truncated, Some(false));

    let plein = ecran_depuis(
        &pane,
        (String::from("$ pret"), true),
        SourceLecture::Visible,
    );
    assert_eq!(plein.text.as_deref(), Some("$ pret"));
    assert_eq!(plein.truncated, Some(true));
    assert_eq!(plein.source, Some(domain::observation::ReadSource::Visible));
}

#[test]
fn la_confirmation_du_prompt_doit_etre_la_notre() {
    // Notre empreinte : confirmée.
    let notre = preuve_de_prompt(&json!({ "fingerprint": "abc" }), "abc");
    assert!(matches!(notre, PromptEvidence::Confirmed { .. }));

    // Une empreinte ÉTRANGÈRE n'est pas une confirmation (C05).
    let etrangere = preuve_de_prompt(&json!({ "fingerprint": "autre" }), "abc");
    match etrangere {
        PromptEvidence::Unknown { detail, partial } => {
            assert!(detail.contains("étrangère"), "{detail}");
            assert!(partial.contains(&PartialStep::LiteralTextWritten));
        }
        autre => panic!("une empreinte étrangère n'est pas une preuve : {autre:?}"),
    }

    // Un `result` objet SANS empreinte ne prouve rien non plus.
    let sans = preuve_de_prompt(&json!({}), "abc");
    assert!(matches!(sans, PromptEvidence::Unknown { .. }));
}

#[test]
fn une_ecriture_est_une_livraison_de_transport() {
    let preuve = preuve_de_transport("touches envoyées", PartialStep::KeysSent);
    assert_eq!(preuve.outcome, TransportOutcome::Delivered);
    assert_eq!(preuve.partial, vec![PartialStep::KeysSent]);
}

#[test]
fn les_causes_de_transport_gardent_leur_nature() {
    use herdr_client::transport::ErreurTransport;

    let refus = erreur_de_port(&ErreurTransport::AmontRefus {
        code: String::from("-32600"),
        message: String::from("agent not found"),
    });
    assert!(matches!(refus, domain::errors::PortError::Upstream { .. }));

    let delai = erreur_de_port(&ErreurTransport::DelaiDepasse);
    assert_eq!(delai, domain::errors::PortError::Timeout);

    let ferme = erreur_de_port(&ErreurTransport::Ferme);
    assert!(matches!(ferme, domain::errors::PortError::Transport { .. }));
}

#[test]
fn les_cinq_statuts_du_fil_sont_les_cinq_du_domaine() {
    use herdr_client::wire::StatutAgent;
    for (fil, attendu) in [
        (StatutAgent::Idle, AgentStatus::Idle),
        (StatutAgent::Working, AgentStatus::Working),
        (StatutAgent::Blocked, AgentStatus::Blocked),
        (StatutAgent::Done, AgentStatus::Done),
        (StatutAgent::Unknown, AgentStatus::Unknown),
    ] {
        assert_eq!(statut_depuis(fil), attendu);
    }
}

#[test]
fn une_session_par_identifiant_garde_son_genre() {
    let fil = InfoSessionAgent {
        agent: String::from("codex"),
        kind: GenreRefSession::Id,
        source: String::from("herdr:codex"),
        value: String::from("01a13437"),
    };
    let session = herdr_client::port::session_depuis(&fil);
    assert_eq!(session.kind, domain::observation::SessionRefKind::Id);
    assert_eq!(session.value, "01a13437");
}

#[test]
fn une_preuve_de_lancement_nomme_le_pane() {
    let pane = domain::ids::PaneId::from(String::from("w1:p4"));
    match herdr_client::port::preuve_de_lancement(&pane) {
        StartEvidence::Started { pane: demarre } => assert_eq!(demarre, pane),
        autre => panic!("un lancement réussi est `Started` : {autre:?}"),
    }
}

/// La confirmation d'un prompt : **la forme MESURÉE sur le socket**.
///
/// ⚠️ Herdr répond `result.type = "agent_prompted"` (E1, mesuré : 618 ms, texte
/// visible dans la TUI) et **n'a aucune empreinte à renvoyer** — l'empreinte est
/// notre identifiant de livraison, calculé côté serveur, qu'Herdr n'a jamais vu.
/// Exiger un `fingerprint` faisait donc échouer **tout** envoi littéral : la PWA
/// affichait un échec rouge pendant que le message partait réellement.
#[test]
fn un_agent_prompted_est_une_confirmation() {
    let preuve = preuve_de_prompt(&json!({ "type": "agent_prompted" }), "abc");
    match preuve {
        PromptEvidence::Confirmed { fingerprint } => assert_eq!(fingerprint.as_str(), "abc"),
        autre => panic!("`agent_prompted` est la preuve du serveur : {autre:?}"),
    }
}

/// Sans `agent_prompted` ni empreinte, l'état est **inconnu** — jamais un échec.
#[test]
fn une_reponse_muette_reste_inconnue_et_n_echoue_pas() {
    let preuve = preuve_de_prompt(&json!({}), "abc");
    assert!(matches!(preuve, PromptEvidence::Unknown { .. }));
}
