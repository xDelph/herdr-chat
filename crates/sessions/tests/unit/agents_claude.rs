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
fn le_mode_shell_devient_une_execution_et_jamais_une_demande() {
    // Forme mesurée (Claude Code 2.1.310) : deux lignes `user` consécutives,
    // la commande puis sa sortie. Aucune ne doit compter comme une demande.
    use sessions::agents::claude::ligne_claude_vers_pi;
    let entree = json!({
        "type": "user", "uuid": "u1", "timestamp": "2026-10-24T20:05:16.675Z",
        "message": { "role": "user",
                     "content": "<bash-input> ls -la && git status</bash-input>" }
    });
    let sortie = json!({
        "type": "user", "uuid": "u2", "parentUuid": "u1",
        "timestamp": "2026-10-24T20:05:16.982Z",
        "message": { "role": "user",
                     "content": "<bash-stdout>✓ Done\n✓ Done</bash-stdout><bash-stderr>attention</bash-stderr>" }
    });
    let commande =
        ligne_claude_vers_pi(&entree).unwrap_or_else(|| panic!("la commande est une ligne"));
    assert_eq!(commande.message.role.as_deref(), Some("bashExecution"));
    assert_eq!(
        commande.message.command.as_deref(),
        Some("ls -la && git status")
    );
    assert_eq!(commande.message.output.as_deref(), Some(""));
    assert_eq!(
        commande.message.exit_code, None,
        "le code n'est écrit nulle part"
    );
    assert_eq!(commande.id.as_deref(), Some("claude:u1"));
    let resultat =
        ligne_claude_vers_pi(&sortie).unwrap_or_else(|| panic!("la sortie est une ligne"));
    assert_eq!(resultat.message.role.as_deref(), Some("bashExecution"));
    assert_eq!(resultat.message.command.as_deref(), Some(""));
    assert_eq!(
        resultat.message.output.as_deref(),
        Some("✓ Done\n✓ Done\nattention"),
        "stdout puis stderr"
    );
    // Une demande ordinaire reste une demande.
    let demande = json!({
        "type": "user", "uuid": "u3",
        "message": { "role": "user", "content": "explique <bash-input> dans la doc" }
    });
    assert_eq!(
        ligne_claude_vers_pi(&demande)
            .and_then(|ligne| ligne.message.role)
            .as_deref(),
        Some("user")
    );
}

#[test]
fn la_sortie_shell_vide_ou_en_erreur_seule_reste_lisible() {
    use sessions::agents::claude::execution_shell;
    let seule_erreur = json!({
        "type": "user", "uuid": "u4",
        "message": { "role": "user",
                     "content": "<bash-stdout></bash-stdout><bash-stderr>psql: error</bash-stderr>" }
    });
    let ligne = execution_shell(&seule_erreur).unwrap_or_else(|| panic!("sortie"));
    assert_eq!(ligne.message.output.as_deref(), Some("psql: error"));
    // Un assistant qui cite la balise n'est pas une commande.
    let assistant = json!({
        "type": "assistant", "uuid": "u5",
        "message": { "role": "assistant", "content": "<bash-input>ls</bash-input>" }
    });
    assert!(execution_shell(&assistant).is_none());
}
