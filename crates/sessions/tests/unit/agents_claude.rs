//! Le profil Claude (T020/D14) : le corpus frozen passe par le profil —
//! slash commands et erreurs d'outil préservées, aucun retour du message
//! filtré par le fallback raw.

use serde_json::{Value, json};
use sessions::agents::claude::{ProfilClaude, ligne_traitee};
use sessions::pipeline::{LigneNormalisee, Registre};
use std::path::PathBuf;

fn fixture_claude() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../compatibility/benchmark/fixtures/claude/pane-01.jsonl")
}

#[test]
fn le_corpus_gelé_passe_par_le_profil_sans_perte() {
    let texte = match std::fs::read_to_string(fixture_claude()) {
        Ok(texte) => texte,
        Err(cause) => panic!("corpus D14 illisible : {cause}"),
    };
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    let mut demandes = 0_usize;
    let mut appels = 0_usize;
    for ligne in texte.lines().filter(|l| !l.trim().is_empty()) {
        let valeur: Value = match serde_json::from_str(ligne) {
            Ok(valeur) => valeur,
            Err(cause) => panic!("ligne du corpus en JSON : {cause}"),
        };
        // La politique D14 passe AVANT le pipeline : les lignes de
        // conversation refusées ne restent jamais lisibles.
        let traitee = ligne_traitee(&valeur);
        let converti = anthropique_vers_brut(&traitee);
        if let Some(LigneNormalisee::Message(ligne_pi)) = registre.traite("claude", &converti) {
            let contenu = serde_json::to_string(&ligne_pi.message.content).unwrap_or_default();
            if contenu.contains("toolCall") {
                appels += 1;
            } else if ligne_pi.message.role.as_deref() == Some("user")
                && !contenu.contains("toolResult")
            {
                demandes += 1;
            }
        }
    }
    assert!(demandes > 0, "les demandes du corpus restent : {demandes}");
    assert!(
        appels > 0,
        "les appels d'outils du corpus restent : {appels}"
    );
}

fn anthropique_vers_brut(valeur: &Value) -> Value {
    valeur.clone()
}

#[test]
fn la_politique_d14_ne_renvoie_jamais_le_message_filtré() {
    // Une ligne REFUSÉE (marque sans demande) : conservée SANS message —
    // le fallback raw ne réinjecte pas ce qui a été écarté.
    let refusee = json!({
        "type": "user", "timestamp": "t", "uuid": "u-1",
        "message": { "role": "user", "content": "[Request interrupted by user]" },
    });
    let traitee = ligne_traitee(&refusee);
    assert!(
        traitee.get("message").is_none(),
        "le message filtré ne revient PAS : {traitee}"
    );
    assert!(traitee.get("timestamp").is_some(), "le reste survit");
    // Une ligne ACCEPTÉE passe intacte.
    let acceptee = json!({
        "type": "user",
        "message": { "role": "user", "content": "ma vraie demande" },
    });
    let traitee = ligne_traitee(&acceptee);
    assert!(
        traitee.get("message").is_some(),
        "une ligne acceptée garde son message"
    );
    // Une ligne hors conversation (comptabilité) passe telle quelle.
    let comptabilite = json!({ "type": "file-history-snapshot", "snapshot": {} });
    let traitee = ligne_traitee(&comptabilite);
    assert!(
        traitee == comptabilite,
        "la comptabilité passe sans être touchée"
    );
}

#[test]
fn la_commande_slash_et_l_erreur_doutil_sont_préservées() {
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    // La slash command : rendue UTILE (nom + arguments), jamais refusée.
    let commande = json!({
        "type": "user",
        "message": { "role": "user", "content": "<command-name>/rapport</command-name><command-args>--bref</command-args>" },
    });
    match registre.traite("claude", &commande) {
        Some(LigneNormalisee::Message(ligne)) => {
            let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
            assert!(
                contenu.contains("/rapport --bref"),
                "la commande et ses arguments : {contenu}"
            );
        }
        autre => panic!("une commande slash est une action : {autre:?}"),
    }
    // L'erreur d'outil : isError porté.
    let echec = json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "c1", "content": "boom", "is_error": true }] },
    });
    match registre.traite("claude", &echec) {
        Some(LigneNormalisee::Message(ligne)) => {
            assert!(
                ligne.message.is_error == Some(true),
                "l'échec d'outil porte isError"
            );
        }
        autre => panic!("un échec d'outil doit rester visible : {autre:?}"),
    }
}

#[test]
fn le_profil_claude_se_pose_avec_les_autres() {
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    registre.pose(ProfilCodex::profil());
    registre.pose(sessions::agents::pi::ProfilPi::profil());
    let capacites = ProfilClaude::capacites();
    assert!(
        capacites.lisible && capacites.catalogue && capacites.lancement && capacites.interactions
    );
    // Les trois profils coexistent — chaque genre reste le sien.
    assert!(
        registre
            .traite(
                "claude",
                &json!({
                    "type": "user", "message": { "role": "user", "content": "pour claude" }
                })
            )
            .is_some()
    );
    assert!(registre.traite("pi", &json!({
        "type": "message", "id": "m", "role": "user", "content": [{ "type": "text", "text": "pour pi" }]
    })).is_some());
    assert!(
        registre
            .traite("inconnu", &json!({ "type": "user" }))
            .is_none(),
        "pas de repli"
    );
}

use sessions::agents::codex::ProfilCodex;

#[test]
fn une_demande_envoyee_pendant_le_tour_est_une_demande() {
    // Forme mesurée sur une vraie session Claude Code : le message reçu en
    // cours de tour est un `attachment` `queued_command`.
    let pendant = json!({
        "type": "attachment",
        "uuid": "51115105-ec86",
        "timestamp": "2026-10-29T14:42:58.698Z",
        "attachment": {
            "type": "queued_command",
            "prompt": "encore un autre problème",
            "commandMode": "prompt",
            "origin": { "kind": "human" },
        },
    });
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    let Some(LigneNormalisee::Message(ligne)) = registre.traite("claude", &pendant) else {
        panic!("la demande envoyée pendant le tour doit être lue");
    };
    assert_eq!(ligne.message.role.as_deref(), Some("user"));
    assert_eq!(ligne.id.as_deref(), Some("claude:51115105-ec86"));
    assert!(
        serde_json::to_string(&ligne.message.content)
            .unwrap_or_default()
            .contains("encore un autre problème")
    );

    // Une notification interne passe par le même canal : ce n'est pas une
    // demande de l'utilisateur.
    let notification = json!({
        "type": "attachment",
        "attachment": {
            "type": "queued_command",
            "prompt": "<task-notification>…</task-notification>",
            "commandMode": "task-notification",
            "origin": { "kind": "task-notification" },
        },
    });
    assert!(registre.traite("claude", &notification).is_none());
}

#[test]
fn les_images_arrivent_dans_la_forme_commune() {
    // Une capture collée dans une demande, et une image lue par un outil :
    // les deux formes mesurées sur une vraie session Claude Code.
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    let demande = json!({
        "type": "user", "uuid": "u-img",
        "message": { "role": "user", "content": [
            { "type": "text", "text": "j'ai toujours le flou" },
            { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "QUJD" } },
        ]},
    });
    let Some(LigneNormalisee::Message(ligne)) = registre.traite("claude", &demande) else {
        panic!("la demande avec image est lue");
    };
    let contenu = serde_json::to_value(&ligne.message.content).unwrap_or(Value::Null);
    assert!(
        contenu
            .as_array()
            .is_some_and(|blocs| blocs.iter().any(|bloc| bloc
                == &json!({ "type": "image", "data": "QUJD", "mimeType": "image/jpeg" }))),
        "l'image collée est un bloc image commun : {contenu}"
    );

    let resultat = json!({
        "type": "user", "uuid": "u-res",
        "message": { "role": "user", "content": [{
            "type": "tool_result", "tool_use_id": "t1",
            "content": [{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "UE5H" } }],
        }]},
    });
    let Some(LigneNormalisee::Message(ligne)) = registre.traite("claude", &resultat) else {
        panic!("le résultat d'outil avec image est lu");
    };
    assert_eq!(ligne.message.role.as_deref(), Some("toolResult"));
    let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
    assert!(contenu.contains("\"mimeType\":\"image/png\""), "{contenu}");
}

#[test]
fn la_file_d_attente_des_demandes_est_lisible() {
    // Formes mesurées (2026-10-29) : enqueue avec texte, remove avec raison,
    // dequeue sans texte ; une notification du harnais n'est pas une demande.
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    let enqueue = json!({"type":"queue-operation","operation":"enqueue","timestamp":"2026-10-29T17:15:08.191Z","content":"et le chrono a reset"});
    let Some(LigneNormalisee::Message(ligne)) = registre.traite("claude", &enqueue) else {
        panic!("l'entrée en file est lue");
    };
    assert_eq!(ligne.message.role.as_deref(), Some("custom"));
    let brut = serde_json::to_string(&ligne).unwrap_or_default();
    assert!(
        brut.contains("queue-operation")
            && brut.contains("enqueue")
            && brut.contains("et le chrono a reset"),
        "{brut}"
    );

    let retrait = json!({"type":"queue-operation","operation":"remove","reason":"absorbed_mid_turn","timestamp":"2026-10-29T17:15:25Z","content":"et le chrono a reset"});
    assert!(registre.traite("claude", &retrait).is_some());
    let tete =
        json!({"type":"queue-operation","operation":"dequeue","timestamp":"2026-10-29T17:16:00Z"});
    assert!(
        registre.traite("claude", &tete).is_some(),
        "dequeue sans texte reste lu"
    );
    let notification = json!({"type":"queue-operation","operation":"enqueue","timestamp":"2026-10-29T17:16:00Z","content":"<task-notification><task-id>x</task-id></task-notification>"});
    assert!(
        registre.traite("claude", &notification).is_none(),
        "le harnais n'est pas une demande"
    );
}

#[test]
fn la_reflexion_de_claude_est_conservee() {
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    let ligne = json!({"type":"assistant","uuid":"a-1","message":{"role":"assistant","content":[
        {"type":"thinking","thinking":"L'erreur vient de moi.","signature":"sig"}
    ]}});
    let Some(LigneNormalisee::Message(lue)) = registre.traite("claude", &ligne) else {
        panic!("un message fait d'une seule réflexion est lu");
    };
    let contenu = serde_json::to_string(&lue.message.content).unwrap_or_default();
    assert!(
        contenu.contains("\"type\":\"thinking\"") && contenu.contains("L'erreur vient de moi."),
        "{contenu}"
    );
    let masquee = json!({"type":"assistant","uuid":"a-2","message":{"role":"assistant","content":[{"type":"redacted_thinking","data":"x"}]}});
    let Some(LigneNormalisee::Message(lue)) = registre.traite("claude", &masquee) else {
        panic!("une réflexion masquée est lue");
    };
    assert!(
        serde_json::to_string(&lue.message.content)
            .unwrap_or_default()
            .contains("\"redacted\":true")
    );
}
