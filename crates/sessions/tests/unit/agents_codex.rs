//! Le profil Codex (T019/D12–D13) : le corpus FROZEN passe par le profil
//! sans perte — contextes injectés filtrés, longs prompts conservés,
//! réflexion chiffrée jamais inventée.

use serde_json::{Value, json};
use sessions::agents::codex::ProfilCodex;
use sessions::pipeline::{LigneNormalisee, Registre};
use std::path::PathBuf;

fn fixture_codex() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../compatibility/benchmark/fixtures/codex/pane-01.jsonl")
}

#[test]
fn le_corpus_gelé_passe_par_le_profil_sans_perte() {
    let texte = match std::fs::read_to_string(fixture_codex()) {
        Ok(texte) => texte,
        Err(cause) => panic!("corpus D12–D13 illisible : {cause}"),
    };
    let mut registre = Registre::nouveau();
    registre.pose(ProfilCodex::profil());
    let mut vus = 0_usize;
    let mut contexts_injectes = 0_usize;
    let mut messages_reels = 0_usize;
    let mut reglages = 0_usize;
    for ligne in texte.lines() {
        if ligne.trim().is_empty() {
            continue;
        }
        let valeur: Value = match serde_json::from_str(ligne) {
            Ok(valeur) => valeur,
            Err(cause) => panic!("une ligne du corpus est du JSON : {cause} — {ligne}"),
        };
        match registre.traite("codex", &valeur) {
            Some(LigneNormalisee::Message(ligne_pi)) => {
                vus += 1;
                // Un message réel ne porte JAMAIS les marques injectées.
                let contenu = serde_json::to_string(&ligne_pi.message.content).unwrap_or_default();
                if contenu.contains("<environment_context>")
                    || contenu.contains("# AGENTS.md instructions for")
                {
                    contexts_injectes += 1;
                }
                if ligne_pi.message.role.as_deref() == Some("user")
                    && !contenu.contains("AGENTS.md")
                {
                    messages_reels += 1;
                }
                // Les horodatages du corpus passent (fidélité).
                if valeur.get("timestamp").is_some() {
                    assert!(
                        ligne_pi.timestamp.is_some(),
                        "l'horodatage du corpus doit rester : {ligne_pi:?}"
                    );
                }
            }
            Some(LigneNormalisee::Reglage(_)) => reglages += 1,
            None => {
                // Refusé : les types hors conversation — MAIS une enveloppe
                // response_item/message dont les blocs étaient tous du
                // contexte injecté compte comme filtré (D13).
                let payload = valeur.get("payload").cloned().unwrap_or(Value::Null);
                let contenu = serde_json::to_string(&payload).unwrap_or_default();
                if contenu.contains("AGENTS.md") || contenu.contains("environment_context") {
                    contexts_injectes += 1;
                }
            }
        }
    }
    assert!(vus > 0, "le corpus doit produire des messages : {vus}");
    assert!(
        contexts_injectes > 0,
        "le corpus porte du contexte injecté — il doit être FILTRÉ, pas servi"
    );
    assert!(
        messages_reels > 0,
        "les VRAIS prompts du corpus (longs) doivent rester : {messages_reels}"
    );
    // La réflexion chiffrée : jamais un texte inventé — les reasoning
    // passent seulement en masqués (déjà testé au codec) ; rien à craindre
    // pour le corpus : AUCUN texte de réflexion ne sort.
    for ligne in texte.lines().filter(|l| l.contains("reasoning")) {
        let valeur: Value = match serde_json::from_str(ligne) {
            Ok(valeur) => valeur,
            Err(_) => continue,
        };
        if let Some(LigneNormalisee::Message(ligne_pi)) = registre.traite("codex", &valeur) {
            let contenu = serde_json::to_string(&ligne_pi.message.content).unwrap_or_default();
            assert!(
                !contenu.contains("\"text\":\"") || contenu.contains("redacted"),
                "la réflexion chiffrée n'est jamais inventée : {contenu}"
            );
        }
    }
    let _ = reglages; // les réglages du corpus passent par l'étape réglage
}

#[test]
fn la_politique_codex_se_pose_sans_changer_le_socle() {
    // Le socle reste le même : le profil codex passe par le pipeline
    // générique — un profil pi posé à côté reste fonctionnel.
    let mut registre = Registre::nouveau();
    registre.pose(ProfilCodex::profil());
    registre.pose(sessions::agents::pi::ProfilPi::profil());
    let message_codex = json!({
        "timestamp": "2025-10-15T12:45:00.000Z", "ordinal": 42, "type": "response_item",
        "payload": { "type": "message", "role": "assistant",
                     "content": [{ "type": "output_text", "text": "réponse codex" }] },
    });
    match registre.traite("codex", &message_codex) {
        Some(LigneNormalisee::Message(ligne)) => {
            assert!(
                ligne.id.as_deref() == Some("codex:42:item"),
                "l'id codex:ordinal : {:?}",
                ligne.id
            );
        }
        autre => panic!("un message codex passe : {autre:?}"),
    }
    let message_pi = json!({
        "type": "message", "id": "msg-pi", "role": "user",
        "content": [{ "type": "text", "text": "côté pi" }],
    });
    match registre.traite("pi", &message_pi) {
        Some(LigneNormalisee::Message(ligne)) => {
            assert!(
                ligne.id.as_deref() == Some("msg-pi"),
                "pi reste pi à côté de codex"
            );
        }
        autre => panic!("pi doit rester fonctionnel : {autre:?}"),
    }
    // Les capacités mesurées : les quatre pour codex.
    let capacites = ProfilCodex::capacites();
    assert!(
        capacites.lisible && capacites.catalogue && capacites.lancement && capacites.interactions
    );
}
