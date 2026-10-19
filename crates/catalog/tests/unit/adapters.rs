//! Les adaptateurs de catalogues (T029) : les formes mesurées passent, les
//! limitations (claude) sont dites, aucun niveau n'est déduit pour
//! cursor/devin, l'absence est explicite — et le chemin passe par
//! l'exécuteur borné avec des CLIs factices.

use catalog::adapters::{
    Adaptateur, Parseur, adaptateur_de, catalogue_d_adaptateur, catalogue_de, commande_par_defaut,
    parse_claude, parse_codex, parse_cursor, parse_devin, parse_pi,
};
use serde_json::json;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static NONCE: AtomicU32 = AtomicU32::new(0);

/// Un CLI factice (le même gabarit que T028 — le noyau interprète, aucun
/// shell côté exécuteur).
fn cli_factice(prefixe: &str, corps: &str) -> PathBuf {
    let racine = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match fs::create_dir(&racine) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    let chemin = racine.join("factice.sh");
    match fs::write(&chemin, format!("#!/bin/sh\n{corps}")) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let mut permissions = match fs::metadata(&chemin) {
        Ok(meta) => meta.permissions(),
        Err(cause) => panic!("metadata refusée : {cause}"),
    };
    permissions.set_mode(0o755);
    match fs::set_permissions(&chemin, permissions) {
        Ok(()) => (),
        Err(cause) => panic!("chmod refusé : {cause}"),
    }
    chemin
}

#[test]
fn le_tableau_pi_se_parse_avec_ses_pieges() {
    let sortie = "provider  model  context  max-out  thinking  images\n\
                  anthropic  Anthropic: Claude Opus 5  200k  32k  yes  yes\n\
                  openai  gpt-5  128k  16k  no  yes\n\
                  openai  ~/gpt-5-latest  128k  16k  yes  yes\n";
    let modeles = parse_pi(sortie);
    assert!(
        modeles.len() == 3,
        "trois modèles (l'en-tête écartée) : {}",
        modeles.len()
    );
    // Le nom avec espace interne survit au découpage 2+ espaces.
    assert!(
        modeles[0].id == "anthropic/Anthropic: Claude Opus 5",
        "l'espace interne intact : {}",
        modeles[0].id
    );
    // Le thinking = la CAPACITÉ (oui → les niveaux mesurés).
    assert!(
        modeles[0].niveaux.len() == 7,
        "capacité oui → 7 niveaux : {}",
        modeles[0].niveaux.len()
    );
    assert!(modeles[1].niveaux.is_empty(), "capacité non → aucun niveau");
    // Le préfixe ~/ des latest tombe.
    assert!(
        modeles[2].id == "openai/gpt-5-latest",
        "le ~/ tombe : {}",
        modeles[2].id
    );
    // Aucun libellé inventé (le tableau de pi n'en porte pas).
    assert!(modeles.iter().all(|modele| modele.libelle.is_none()));
}

#[test]
fn la_limitation_claude_est_dite_pas_cachée() {
    let catalogue = parse_claude();
    // L'erreur EST le message : la liste complète n'est pas énumérable hors
    // session — la limitation se lit.
    let erreur = catalogue.erreur.unwrap_or_default();
    assert!(
        erreur.contains("authenticated"),
        "la limitation est dite : {erreur}"
    );
    assert!(
        catalogue.modeles.len() == 4,
        "les quatre alias : {}",
        catalogue.modeles.len()
    );
    assert!(catalogue.modeles.iter().any(|m| m.id == "sonnet"));
    assert!(
        catalogue.niveaux == vec!["low", "medium", "high", "max"],
        "les efforts mesurés"
    );
}

#[test]
fn le_catalogue_codex_porte_les_niveaux_par_modèle() {
    let sortie = json!({
        "models": [
            { "slug": "gpt-5", "display_name": "GPT-5",
              "supported_reasoning_levels": [ { "effort": "low" }, { "effort": "high" }, { "effort": "high" } ] },
            { "slug": "o4-mini" },
        ],
    })
    .to_string();
    let modeles = parse_codex(&sortie).unwrap_or_else(|cause| panic!("le JSON passe : {cause}"));
    assert!(modeles.len() == 2);
    assert!(modeles[0].libelle.as_deref() == Some("GPT-5"));
    assert!(
        modeles[0].niveaux == vec!["low", "high"],
        "les niveaux du modèle, dédupliqués dans l'ordre : {:?}",
        modeles[0].niveaux
    );
    // L'union des niveaux de TOUS les modèles.
    let catalogue = match parse_codex(&sortie) {
        Ok(modeles) => {
            let mut catalogue_vide = parse_claude();
            catalogue_vide.modeles = modeles;
            catalogue_vide.erreur = None;
            catalogue_vide
        }
        Err(cause) => panic!("déjà prouvé : {cause}"),
    };
    let _ = catalogue;
    // Un JSON illisible : l'erreur nommée — le catalogue ne se devine pas.
    assert!(parse_codex("pas du json").is_err());
    // Un catalogue vide : l'erreur.
    assert!(parse_codex(r#"{"models": []}"#).is_err());
}

#[test]
fn cursor_et_devin_ninventent_aucun_niveau() {
    // cursor : le niveau est DANS le nom (`gpt-5.6-sol-high`) — rien à
    // proposer séparément, jamais.
    let sortie_cursor = "gpt-5.6-sol-high - GPT-5.6 Sol High\nglm-5 - GLM-5\n";
    let modeles = parse_cursor(sortie_cursor);
    assert!(modeles.len() == 2);
    assert!(
        modeles[0].id == "gpt-5.6-sol-high"
            && modeles[0].libelle.as_deref() == Some("GPT-5.6 Sol High")
    );
    assert!(
        modeles.iter().all(|modele| modele.niveaux.is_empty()),
        "cursor : AUCUN niveau séparé déduit"
    );

    // devin : le modèle est le VARIANT, pas la famille — prendre le slug
    // de famille enverrait un nom que le CLI refuse.
    let sortie_devin = json!({
        "families": [
            { "family_label": "SWE-2", "slug": "swe-2",
              "variants": [ { "model_uid": "swe-2-high", "label": "SWE-2 High" },
                            { "model_uid": "swe-2-low", "label": "SWE-2 Low" } ] },
            { "family_label": "SWE-1.6", "slug": "swe-1.6",
              "variants": [ { "model_uid": "swe-1-6-slow", "label": "SWE-1.6 Slow" } ] },
        ],
    })
    .to_string();
    let modeles = parse_devin(&sortie_devin);
    assert!(modeles.len() == 3, "les VARIANTS : {}", modeles.len());
    assert!(
        modeles.iter().all(|modele| modele.niveaux.is_empty()),
        "devin : AUCUN niveau séparé déduit"
    );
    assert!(
        modeles.iter().any(|m| m.id == "swe-1-6-slow"),
        "le variant que le CLI accepte"
    );
    assert!(
        !modeles.iter().any(|m| m.id == "swe-2"),
        "le slug de FAMILLE n'est jamais un modèle"
    );
    // Un JSON illisible : rien (le catalogue ne se devine pas).
    assert!(parse_devin("illisible").is_empty());
}

#[test]
fn le_chemin_passe_par_lexécuteur_avec_des_clis_factices() {
    // Le codex factice : le MÊME adaptateur, la commande INJECTÉE — aucun
    // CLI d'agent réel n'est jamais lancé.
    let cli = cli_factice(
        "soutien-adapters-codex",
        "echo '{\"models\": [{\"slug\": \"gpt-5\", \"display_name\": \"GPT-5\"}]}'",
    );
    let adaptateur = Adaptateur {
        genre: "codex",
        commande: &[],
        source: "factice codex debug models",
        parseur: Parseur::CodexJson,
    };
    let catalogue = catalogue_d_adaptateur(&adaptateur, &[cli.to_string_lossy().to_string()]);
    assert!(
        catalogue.erreur.is_none(),
        "le CLI factice passe : {:?}",
        catalogue.erreur
    );
    assert!(catalogue.modeles.len() == 1 && catalogue.modeles[0].id == "gpt-5");

    // Un CLI en échec : l'erreur est déclarée (le code + stderr), les
    // listes vides.
    let cli_echec = cli_factice("soutien-adapters-echec", "echo 'la raison' >&2; exit 2");
    let catalogue = catalogue_d_adaptateur(&adaptateur, &[cli_echec.to_string_lossy().to_string()]);
    let erreur = catalogue.erreur.unwrap_or_default();
    assert!(
        erreur.contains("2") && erreur.contains("la raison"),
        "code + stderr déclarés : {erreur}"
    );
    assert!(catalogue.modeles.is_empty());
}

#[test]
fn claude_ne_lance_aucun_processus_meme_avec_une_commande_bidon() {
    // ⚠️ Trouvé en exécutant le port réel : l'adaptateur `claude` recevait sa
    // vraie commande et **lançait `claude`** (une session interactive) pour
    // jeter sa sortie. Le catalogue est la liste documentée des alias — donc
    // aucune exécution, même avec une commande qui n'existe pas.
    let adaptateur = adaptateur_de("claude").unwrap_or_else(|| panic!("claude est dans la table"));
    let catalogue = catalogue_d_adaptateur(
        adaptateur,
        &[String::from("/chemin/qui/n/existe/pas/claude")],
    );
    assert!(
        !catalogue.modeles.is_empty(),
        "les alias documentés sont servis sans processus"
    );
    let erreur = catalogue.erreur.unwrap_or_default();
    assert!(
        erreur.contains("authenticated"),
        "la limitation reste dite : {erreur}"
    );
}

#[test]
fn la_commande_par_defaut_est_celle_de_la_table() {
    // La production n'injecte rien : c'est CETTE commande qui part.
    assert_eq!(
        commande_par_defaut("pi"),
        vec![String::from("pi"), String::from("--list-models")]
    );
    assert_eq!(
        commande_par_defaut("codex"),
        vec![
            String::from("codex"),
            String::from("debug"),
            String::from("models")
        ]
    );
    assert!(
        commande_par_defaut("agent-inconnu").is_empty(),
        "un genre hors table n'a pas de commande"
    );
}

#[test]
fn un_kind_absent_est_une_absence_explicite() {
    // Hors table : models: [] AVEC la raison — l'interface affiche
    // l'absence au lieu d'inventer une liste.
    let catalogue = catalogue_de("agent-inconnu");
    let erreur = catalogue.erreur.unwrap_or_default();
    assert!(
        erreur.contains("inconnu"),
        "la raison nomme le kind : {erreur}"
    );
    assert!(catalogue.modeles.is_empty());
    // Les cinq kinds connus sont dans la table.
    for genre in ["pi", "claude", "codex", "cursor", "devin"] {
        assert!(adaptateur_de(genre).is_some(), "{genre} a son adaptateur");
    }
    assert!(adaptateur_de("zsh").is_none());
}
