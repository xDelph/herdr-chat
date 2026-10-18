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
