//! Ce que le harnais de Claude Code injecte en rôle `user` : jamais une
//! demande de l'utilisateur, toujours un message `custom` nommé. Formes
//! relevées sur une vraie session (2026-10-29), raccourcies.

use serde_json::{Value, json};
use sessions::agents::claude::harnais::{notification_de, rapport_de};
use sessions::agents::claude::{ProfilClaude, ligne_traitee};
use sessions::normalisation::Normaliseur;
use sessions::pipeline::{LigneNormalisee, Registre};

const NOTIFICATION: &str = "<task-notification>\n<task-id>a6d35318c8bc3f24e</task-id>\n<tool-use-id>toolu_01Ni</tool-use-id>\n<output-file>/private/tmp/x/tasks/a6d35318c8bc3f24e.output</output-file>\n<status>completed</status>\n<summary>Agent \"Audit PWA revamp frontend\" finished</summary>\n<note>A task-notification fires each time this agent stops.</note>\n<result>This agent's report was delivered to you as a message from \"a6d35318c8bc3f24e\" (its SubagentHandback call). Read it there; it is not repeated here.\n</result>\n<usage><subagent_tokens>140181</subagent_tokens><tool_uses>44</tool_uses><duration_ms>325661</duration_ms></usage>\n</task-notification>";

const RAPPORT: &str = "<agent-message from=\"a6d35318c8bc3f24e\">\n[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:\n  ## Diagnostic\n  \n  - **Entry.** `main.tsx`\n    - imbriqué\n</agent-message>";

fn registre() -> Registre {
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    registre
}

fn message(ligne: &Value) -> domain::session::LignePi {
    match registre().traite("claude", ligne) {
        Some(LigneNormalisee::Message(ligne)) => *ligne,
        autre => panic!("un message était attendu : {autre:?}"),
    }
}

fn texte(ligne: &domain::session::LignePi) -> String {
    ligne.message.content[0]["text"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

#[test]
fn le_rapport_d_un_sous_agent_n_est_pas_une_demande() {
    // La forme « agent au repos » : une ligne user, isMeta, origine peer.
    let ligne = json!({
        "type": "user", "isMeta": true, "uuid": "u-rap", "timestamp": "2026-10-29T13:00:30.000Z",
        "origin": { "kind": "peer" }, "promptSource": "system",
        "message": { "role": "user", "content": format!(
            "Another Claude session sent a message:\n{RAPPORT}\n\nThat \"other Claude session\" is an agent working inside this same session."
        ) },
    });
    let rendu = message(&ligne);
    assert_eq!(rendu.message.role.as_deref(), Some("custom"));
    assert_eq!(
        rendu.message.custom_type.as_deref(),
        Some("subagent-report")
    );
    assert_eq!(rendu.id.as_deref(), Some("claude:u-rap"));
    let details = rendu.message.details.clone().unwrap_or(Value::Null);
    assert_eq!(details["taskId"], json!("a6d35318c8bc3f24e"));
    assert_eq!(details["handback"], json!(true));
    assert!(details.get("midTurn").is_none(), "au repos : ouvre un tour");
    // Le cadre est retiré, l'indentation du harnais aussi — le Markdown
    // imbriqué garde la sienne.
    assert_eq!(
        texte(&rendu),
        "## Diagnostic\n\n- **Entry.** `main.tsx`\n  - imbriqué"
    );
    assert!(!texte(&rendu).contains("Another Claude session"));
}

#[test]
fn le_rapport_arrive_pendant_le_tour_est_marque() {
    let ligne = json!({
        "type": "attachment", "uuid": "u-att", "timestamp": "2026-10-29T13:01:00.000Z",
        "attachment": {
            "type": "queued_command", "prompt": RAPPORT, "commandMode": "prompt",
            "origin": { "kind": "peer" }, "isMeta": true,
        },
    });
    let rendu = message(&ligne);
    assert_eq!(
        rendu.message.custom_type.as_deref(),
        Some("subagent-report")
    );
    let details = rendu.message.details.clone().unwrap_or(Value::Null);
    assert_eq!(details["midTurn"], json!(true));
}

#[test]
fn la_fin_d_une_tache_est_une_notification_structuree() {
    for (ligne, pendant) in [
        (
            json!({
                "type": "user", "uuid": "u-n1", "timestamp": "2026-10-29T13:00:35.329Z",
                "origin": { "kind": "task-notification" }, "promptSource": "system",
                "message": { "role": "user", "content": NOTIFICATION },
            }),
            false,
        ),
        (
            json!({
                "type": "attachment", "uuid": "u-n2", "timestamp": "2026-10-29T13:02:12.288Z",
                "attachment": {
                    "type": "queued_command", "prompt": NOTIFICATION,
                    "commandMode": "task-notification",
                    "origin": { "kind": "task-notification" },
                },
            }),
            true,
        ),
    ] {
        let rendu = message(&ligne);
        assert_eq!(rendu.message.role.as_deref(), Some("custom"));
        assert_eq!(
            rendu.message.custom_type.as_deref(),
            Some("task-notification")
        );
        let details = rendu.message.details.clone().unwrap_or(Value::Null);
        assert_eq!(details["taskId"], json!("a6d35318c8bc3f24e"));
        assert_eq!(details["status"], json!("completed"));
        assert_eq!(details["description"], json!("Audit PWA revamp frontend"));
        assert_eq!(details["kind"], json!("agent"));
        assert_eq!(details["usage"]["durationMs"], json!(325_661));
        assert_eq!(details.get("midTurn").is_some(), pendant);
        // Le résultat qui renvoie au rapport n'est pas répété : le résumé
        // tient lieu de corps.
        assert_eq!(
            texte(&rendu),
            "Agent \"Audit PWA revamp frontend\" finished"
        );
    }
}

#[test]
fn une_fin_de_commande_garde_son_resultat_et_son_echec() {
    let fin = notification_de(
        "<task-notification>\n<task-id>bgra58ffc</task-id>\n<status>failed</status>\n<summary>Background command \"Start dev server\" failed with exit code 1</summary>\n</task-notification>",
    )
    .unwrap_or_else(|| panic!("notification de commande"));
    assert_eq!(fin.task_id, "bgra58ffc");
    assert_eq!(fin.status.as_deref(), Some("failed"));
    assert_eq!(fin.description().as_deref(), Some("Start dev server"));
    assert_eq!(fin.genre(), Some("commande"));
    // Les entités échappées par le harnais sont décodées (mesuré).
    let echappee = notification_de(
        "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command \"cd x &amp;&amp; cat &lt;a&gt;\" completed (exit code 0)</summary>\n</task-notification>",
    )
    .unwrap_or_else(|| panic!("notification échappée"));
    assert_eq!(echappee.description().as_deref(), Some("cd x && cat <a>"));
    // Une citation dans une demande n'est pas une notification.
    assert!(notification_de("voici <task-notification><task-id>x</task-id>").is_none());
}

#[test]
fn un_message_d_agent_sans_handback_garde_son_texte() {
    let rapport =
        rapport_de("<agent-message from=\"t1\">\nJ'ai besoin d'un accès.\n</agent-message>")
            .unwrap_or_else(|| panic!("message d'agent"));
    assert!(!rapport.handback);
    assert_eq!(rapport.de.as_deref(), Some("t1"));
    assert_eq!(rapport.corps, "J'ai besoin d'un accès.");
}

#[test]
fn les_injections_meta_ne_sont_jamais_des_demandes() {
    for ligne in [
        json!({ "type": "user", "isMeta": true, "message": { "role": "user", "content": "[Image: original 780x3600, displayed at 433x2000.]" } }),
        json!({ "type": "user", "isMeta": true, "message": { "role": "user", "content": [{ "type": "text", "text": "[Image: source: /tmp/a.png]" }] } }),
        json!({ "type": "user", "origin": { "kind": "peer" }, "message": { "role": "user", "content": "texte inconnu d'un pair" } }),
    ] {
        assert!(registre().traite("claude", &ligne).is_none(), "{ligne}");
        // Et la politique D14 retire le message : il ne revient pas brut.
        assert!(ligne_traitee(&ligne).get("message").is_none());
    }
    // Une vraie demande, elle, reste une demande — même si elle cite une
    // balise du harnais au milieu du texte.
    let humaine = json!({
        "type": "user", "origin": { "kind": "human" },
        "message": { "role": "user", "content": "pourquoi vois-je <task-notification> dans le chat ?" },
    });
    let rendu = message(&humaine);
    assert_eq!(rendu.message.role.as_deref(), Some("user"));
    assert!(rendu.message.custom_type.is_none());
}

#[test]
fn la_demande_pendant_le_tour_porte_mid_turn() {
    let ligne = json!({
        "type": "attachment", "uuid": "u-q", "timestamp": "2026-10-29T14:42:06.560Z",
        "attachment": {
            "type": "queued_command", "prompt": "encore un détail",
            "commandMode": "prompt", "origin": { "kind": "human" },
        },
    });
    let rendu = message(&ligne);
    assert_eq!(rendu.message.role.as_deref(), Some("user"));
    assert_eq!(
        rendu.message.details.clone().unwrap_or(Value::Null)["midTurn"],
        json!(true)
    );
}

#[test]
fn le_normaliseur_sert_la_forme_custom_et_n_ajoute_rien_aux_autres() {
    let normaliseur = Normaliseur::standard();
    let brut = json!({
        "type": "user", "uuid": "u-n1", "timestamp": "2026-10-29T13:00:35.329Z",
        "origin": { "kind": "task-notification" },
        "message": { "role": "user", "content": NOTIFICATION },
    })
    .to_string();
    let entree = normaliseur.entree(Some("claude"), &brut);
    assert_eq!(entree.kind, "message");
    let valeur: Value = serde_json::from_str(&entree.raw).unwrap_or(Value::Null);
    assert_eq!(valeur["message"]["customType"], json!("task-notification"));
    // Un message ordinaire ne porte ni `customType` ni `details` sur le fil.
    let ordinaire =
        json!({ "type": "user", "message": { "role": "user", "content": "bonjour" } }).to_string();
    let entree = normaliseur.entree(Some("claude"), &ordinaire);
    assert!(!entree.raw.contains("customType"), "{}", entree.raw);
    assert!(!entree.raw.contains("details"), "{}", entree.raw);
}

#[test]
fn le_rapport_final_d_un_sous_agent_est_sa_reponse() {
    // Dans la transcription d'un sous-agent : l'appel `SubagentHandback`
    // porte le rapport — il devient du texte, pas une action repliée.
    let ligne = json!({
        "type": "assistant", "uuid": "u-h", "isSidechain": true,
        "message": { "role": "assistant", "content": [
            { "type": "tool_use", "id": "t1", "name": "SubagentHandback", "input": { "message": "## Rapport\n\nTout est vert." } },
        ]},
    });
    let rendu = message(&ligne);
    assert_eq!(rendu.message.role.as_deref(), Some("assistant"));
    assert_eq!(
        rendu.message.content,
        json!([{ "type": "text", "text": "## Rapport\n\nTout est vert." }])
    );
    // Un autre outil reste un appel.
    let autre = json!({
        "type": "assistant",
        "message": { "role": "assistant", "content": [
            { "type": "tool_use", "id": "t2", "name": "Bash", "input": { "command": "ls" } },
        ]},
    });
    assert_eq!(
        message(&autre).message.content[0]["type"],
        json!("toolCall")
    );
}
