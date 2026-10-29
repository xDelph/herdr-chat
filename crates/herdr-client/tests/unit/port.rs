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
    // ⚠️ Une photo qui ne porte ni tabs ni layouts : les déclarer (même
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
fn la_photo_porte_les_tabs_et_dispositions_que_le_fil_livre() {
    // Régression (P0) : `tabs[]` et `layouts[]` du snapshot étaient jetés —
    // `tabNumber`, `tabLabel` et `paneRank` restaient null pour tous.
    let photo: PhotoSession = serde_json::from_value(json!({
        "agents": [],
        "workspaces": [{ "workspace_id": "w1" }],
        "tabs": [
            { "tab_id": "w1:t1", "workspace_id": "w1", "label": "1", "number": 1 },
            { "tab_id": "w1:t2", "workspace_id": "w1", "label": "atelier", "number": 2,
              "agent_status": "idle", "pane_count": 2 }
        ],
        "layouts": [{
            "tab_id": "w1:t2", "workspace_id": "w1", "focused_pane_id": "w1:p3",
            "zoomed": false, "splits": [],
            "panes": [
                { "pane_id": "w1:p3", "focused": true,
                  "rect": { "x": 95, "y": 0, "width": 95, "height": 82 } },
                { "pane_id": "w1:p2", "focused": false,
                  "rect": { "x": 0, "y": 0, "width": 95, "height": 82 } }
            ]
        }],
        "protocol": 22,
        "version": "0.9.3"
    }))
    .unwrap_or_else(|cause| panic!("photo : {cause}"));
    let snapshot = observation_depuis_photo(&photo);
    let tabs = snapshot
        .tabs
        .as_ref()
        .unwrap_or_else(|| panic!("tabs portés"));
    assert_eq!(tabs.len(), 2);
    assert_eq!(tabs[1].number, 2);
    assert_eq!(tabs[1].label.as_deref(), Some("atelier"));
    let nommage = domain::naming::NamingContext::from_snapshot(&snapshot);
    let rang = |pane: &str| {
        nommage
            .panes
            .get(&domain::ids::PaneId::from(String::from(pane)))
            .and_then(|situation| situation.rank)
    };
    assert_eq!(rang("w1:p2"), Some(1), "gauche d'abord");
    assert_eq!(rang("w1:p3"), Some(2));
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

/// `agent.start` : le refus « coquille pas prête » d'Herdr est REJOUABLE
/// (`ShellNotReady`), tout autre refus structuré est `Failed` avec la cause
/// d'Herdr (le moteur y lit « blocked »), une panne reste une erreur de port.
#[test]
fn les_refus_de_agent_start_sont_traduits_comme_le_fil() {
    use herdr_client::port::issue_de_lancement;
    use herdr_client::transport::ErreurTransport;

    let pane = domain::ids::PaneId::from(String::from("w1:p4"));
    match issue_de_lancement(
        Err(ErreurTransport::AmontRefus {
            code: String::from("invalid_request"),
            message: String::from("pane w1:p4 is not an available shell"),
        }),
        &pane,
    ) {
        Ok(StartEvidence::ShellNotReady { detail }) => {
            assert!(detail.contains("not an available shell"), "{detail}");
        }
        autre => panic!("la coquille pas prête doit être rejouable : {autre:?}"),
    }
    match issue_de_lancement(
        Err(ErreurTransport::AmontRefus {
            code: String::from("agent_start_failed"),
            message: String::from("agent did not become ready: blocked"),
        }),
        &pane,
    ) {
        Ok(StartEvidence::Failed { detail }) => {
            assert!(detail.to_lowercase().contains("blocked"), "{detail}");
            assert!(detail.contains("agent_start_failed"), "{detail}");
        }
        autre => panic!("un refus amont est `Failed` : {autre:?}"),
    }
    match issue_de_lancement(Ok(json!({ "type": "agent_started" })), &pane) {
        Ok(StartEvidence::Started { pane: occupe }) => assert_eq!(occupe, pane),
        autre => panic!("un démarrage accepté est `Started` : {autre:?}"),
    }
    assert_eq!(
        issue_de_lancement(Err(ErreurTransport::DelaiDepasse), &pane),
        Err(domain::errors::PortError::Timeout),
        "un délai sans verdict n'est jamais un refus"
    );
}

/// Le socket attend PLUS longtemps qu'Herdr : le verdict d'`agent.start`
/// (120 s côté Herdr) arrive toujours avant l'abandon du socket — sinon un
/// démarrage lent était déclaré « délai dépassé » à 15 s.
#[test]
fn le_socket_attend_le_verdict_de_agent_start() {
    use herdr_client::port::DELAI_AGENT_MS;
    use herdr_client::transport::{DELAI_PAR_DEFAUT, delai_de};

    let demande_a_herdr = std::time::Duration::from_millis(DELAI_AGENT_MS);
    assert!(delai_de("agent.start") > demande_a_herdr);
    assert!(delai_de("agent.start") > DELAI_PAR_DEFAUT);
    // La borne de Herdr : « greater than 3000 and at most 300000 ».
    assert!((3_001..=300_000).contains(&std::hint::black_box(DELAI_AGENT_MS)));
    // Les autres méthodes gardent le défaut mesuré.
    assert_eq!(delai_de("agent.prompt"), DELAI_PAR_DEFAUT);
}

#[test]
fn la_photo_porte_les_panes_et_leur_cwd() {
    // D02 : `panes[]` (forme mesurée sur Herdr 0.9, 31 panes) porte le cwd
    // des panes qui ne sont pas des agents — seule source du dossier d'un
    // projet de shells. Les champs non lus (scroll, titres…) sont ignorés ;
    // un cwd null reste absent.
    let photo: PhotoSession = serde_json::from_value(json!({
        "agents": [],
        "workspaces": [{ "workspace_id": "w3" }],
        "panes": [
            { "agent_status": "unknown", "cwd": "/projets/jarvis", "focused": false,
              "foreground_cwd": "/projets/jarvis", "pane_id": "w3:p1", "revision": 1,
              "scroll": { "max_offset_from_bottom": 0, "offset_from_bottom": 0,
                          "viewport_rows": 80 },
              "tab_id": "w3:t1", "terminal_id": "term_1",
              "terminal_title": "shell", "terminal_title_stripped": "shell",
              "workspace_id": "w3" },
            { "agent_status": "unknown", "cwd": null, "focused": false,
              "pane_id": "w3:p2", "revision": 1, "tab_id": "w3:t1",
              "terminal_id": "term_2", "workspace_id": "w3" }
        ],
        "protocol": 22,
        "version": "0.9.3"
    }))
    .unwrap_or_else(|cause| panic!("photo : {cause}"));
    let snapshot = observation_depuis_photo(&photo);
    assert_eq!(snapshot.panes.len(), 2);
    assert_eq!(snapshot.panes[0].cwd.as_deref(), Some("/projets/jarvis"));
    assert_eq!(snapshot.panes[1].cwd, None, "null reste absent");
    let workspace = &snapshot.workspaces[0];
    assert_eq!(
        domain::naming::checkout_path_of(workspace, &domain::naming::panes_situes(&snapshot))
            .as_deref(),
        Some("/projets/jarvis")
    );
}

#[test]
fn une_photo_sans_panes_n_en_invente_pas() {
    let photo: PhotoSession = serde_json::from_value(json!({
        "agents": [], "workspaces": [], "protocol": 22, "version": "0.9.3"
    }))
    .unwrap_or_else(|cause| panic!("photo : {cause}"));
    assert!(observation_depuis_photo(&photo).panes.is_empty());
}
