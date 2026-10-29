//! Le point d'entrée unique des lignes de fichier : Codex et Claude sont
//! servis dans la forme commune, Pi reste intact, un inconnu reste brut.

use serde_json::Value;
use sessions::normalisation::Normaliseur;
use std::path::PathBuf;

fn corpus(famille: &str) -> String {
    let chemin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../compatibility/benchmark/fixtures/{famille}/pane-01.jsonl"
    ));
    match std::fs::read_to_string(&chemin) {
        Ok(texte) => texte,
        Err(cause) => panic!("corpus {famille} illisible : {cause}"),
    }
}

fn role_du_message(raw: &str) -> Option<String> {
    let valeur: Value = serde_json::from_str(raw).ok()?;
    valeur["message"]["role"].as_str().map(str::to_string)
}

#[test]
fn une_ligne_codex_est_servie_dans_la_forme_commune() {
    let normaliseur = Normaliseur::standard();
    let mut messages = 0_usize;
    let mut bruts_de_conversation = 0_usize;
    for ligne in corpus("codex")
        .lines()
        .filter(|ligne| !ligne.trim().is_empty())
    {
        let entree = normaliseur.entree(Some("codex"), ligne);
        if entree.kind == "message" {
            messages += 1;
            assert!(
                role_du_message(&entree.raw).is_some(),
                "un message traduit porte message.role : {}",
                entree.raw
            );
        }
        // Une enveloppe codex de conversation n'est servie brute que si le
        // codec l'a filtrée (contexte injecté) : la PWA ne lit pas
        // `response_item`, un vrai message brut serait perdu pour elle.
        let contexte_injecte = entree.raw.contains("AGENTS.md instructions")
            || entree.raw.contains("<environment_context>");
        if entree.kind == "response_item"
            && entree.raw.contains("\"type\":\"message\"")
            && !contexte_injecte
        {
            bruts_de_conversation += 1;
        }
    }
    assert!(
        messages > 0,
        "le corpus codex donne des messages : {messages}"
    );
    assert!(
        bruts_de_conversation == 0,
        "aucune enveloppe de message servie brute : {bruts_de_conversation}"
    );
}

#[test]
fn une_ligne_claude_est_traduite_et_un_refus_perd_son_message() {
    let normaliseur = Normaliseur::standard();
    let mut messages = 0_usize;
    for ligne in corpus("claude")
        .lines()
        .filter(|ligne| !ligne.trim().is_empty())
    {
        let entree = normaliseur.entree(Some("claude"), ligne);
        if entree.kind == "message" {
            messages += 1;
        }
    }
    assert!(
        messages > 0,
        "le corpus claude donne des messages : {messages}"
    );

    let interrompue = r#"{"type":"user","timestamp":"2026-10-15T10:00:00Z","uuid":"u-1","message":{"role":"user","content":"[Request interrupted by user]"}}"#;
    let entree = normaliseur.entree(Some("claude"), interrompue);
    assert!(
        role_du_message(&entree.raw).is_none(),
        "une ligne refusée ne se relit plus comme un message : {}",
        entree.raw
    );
    assert!(entree.timestamp.is_some(), "le reste de la ligne survit");
}

#[test]
fn une_ligne_pi_passe_intacte() {
    let normaliseur = Normaliseur::standard();
    let ligne = r#"{"type":"message","id":"m1","timestamp":"2026-10-15T10:00:00Z","message":{"role":"assistant","content":"ok","usage":{"input":12}}}"#;
    let entree = normaliseur.entree(Some("pi"), ligne);
    assert!(
        entree.raw == ligne,
        "Pi n'est pas re-sérialisé : {}",
        entree.raw
    );
    assert!(entree.kind == "message" && entree.id.as_deref() == Some("m1"));
}

#[test]
fn une_famille_inconnue_garde_sa_ligne_brute() {
    let normaliseur = Normaliseur::standard();
    let ligne = r#"{"type":"response_item","payload":{"type":"message","role":"user"}}"#;
    let entree = normaliseur.entree(Some("cursor"), ligne);
    assert!(
        entree.raw == ligne,
        "aucun profil voisin appliqué : {}",
        entree.raw
    );
    let illisible = normaliseur.entree(Some("codex"), "{pas du json");
    assert!(illisible.kind == "unknown" && illisible.raw == "{pas du json");
}
