//! Les args de lancement (T030) : la matrice complète kind × model ×
//! thinking, le fournisseur explicitement non appliqué, la vérification du
//! niveau contre le catalogue.

use catalog::adapters::ModeleCatalogue;
use catalog::args::{construit_args, niveau_supporte};

#[test]
fn la_matrice_complete_des_quatre_kinds() {
    // 4 kinds × model présent/absent × thinking présent/absent + les
    // inconnus — CHAQUE case a son verdict.
    let modeles = [Some("gpt-5"), None];
    let thinkings = [Some("high"), None];

    // pi : --model <id> / --thinking <niveau>.
    assert!(
        construit_args("pi", modeles[0], thinkings[0]).args
            == vec!["--model", "gpt-5", "--thinking", "high"]
    );
    assert!(construit_args("pi", modeles[0], thinkings[1]).args == vec!["--model", "gpt-5"]);
    assert!(
        construit_args("pi", modeles[1], thinkings[0])
            .erreur
            .as_deref()
            == Some("“pi” requires a model to choose a reasoning level (demanded: high)"),
        "un thinking sans modèle : refus (on ne devine pas le modèle)"
    );
    assert!(
        construit_args("pi", modeles[1], thinkings[1])
            .args
            .is_empty()
    );

    // claude : --effort (et le SEUL à autoriser un effort sans modèle).
    assert!(
        construit_args("claude", modeles[0], thinkings[0]).args
            == vec!["--model", "gpt-5", "--effort", "high"]
    );
    assert!(construit_args("claude", modeles[0], thinkings[1]).args == vec!["--model", "gpt-5"]);
    assert!(
        construit_args("claude", modeles[1], thinkings[0]).args == vec!["--effort", "high"],
        "claude seul applique un effort sans modèle"
    );
    assert!(
        construit_args("claude", modeles[1], thinkings[1])
            .args
            .is_empty()
    );

    // codex : -m + --config model_reasoning_effort="<n>" (forme canonique).
    assert!(
        construit_args("codex", modeles[0], thinkings[0]).args
            == vec!["-m", "gpt-5", "--config", "model_reasoning_effort=\"high\""],
        "la forme canonique codex"
    );
    assert!(construit_args("codex", modeles[0], thinkings[1]).args == vec!["-m", "gpt-5"]);
    assert!(
        construit_args("codex", modeles[1], thinkings[0])
            .erreur
            .is_some()
    );
    assert!(
        construit_args("codex", modeles[1], thinkings[1])
            .args
            .is_empty()
    );

    // cursor : le niveau est DANS le nom — un thinking demandé = refus, le
    // modèle reste proposé.
    let outcome = construit_args("cursor", modeles[0], thinkings[0]);
    assert!(
        outcome.erreur.is_some() && outcome.args == vec!["--model", "gpt-5"],
        "le modèle reste, le niveau refusé"
    );
    assert!(construit_args("cursor", modeles[0], thinkings[1]).args == vec!["--model", "gpt-5"]);
    assert!(
        construit_args("cursor", modeles[1], thinkings[0])
            .erreur
            .is_some()
    );
    assert!(
        construit_args("cursor", modeles[1], thinkings[1])
            .args
            .is_empty()
    );

    // Un kind hors table : aucune mécanique vérifiée.
    assert!(
        construit_args("zsh", modeles[0], thinkings[1])
            .erreur
            .as_deref()
            == Some("no verified launch mechanism for “zsh”"),
        "l'inconnu ne s'invente pas"
    );
    // Les espaces se triment (le fil : model.trim()).
    assert!(
        construit_args("pi", Some("  gpt-5  "), Some("  ")).args == vec!["--model", "gpt-5"],
        "un thinking blanc = absent"
    );
}

#[test]
fn le_fournisseur_est_explicitement_non_appliqué() {
    // Historiquement : le `provider` de la demande n'a JAMAIS été consommé —
    // il ne fuite JAMAIS dans les args, et rien ne le présente comme appliqué.
    for kind in ["pi", "claude", "codex", "cursor"] {
        let outcome = construit_args(kind, Some("m"), Some("high"));
        assert!(
            !outcome.fournisseur_applique,
            "{kind} : le fournisseur n'est pas appliqué (historique)"
        );
        assert!(
            !outcome
                .args
                .iter()
                .any(|drapeau| drapeau.contains("provider")),
            "{kind} : aucun drapeau de fournisseur"
        );
    }
}

#[test]
fn la_vérification_du_niveau_respecte_ce_que_lagent_déclare() {
    let catalogue = vec![
        ModeleCatalogue {
            id: "gpt-5".to_string(),
            libelle: None,
            niveaux: vec!["low".to_string(), "high".to_string()],
        },
        // Un modèle sans niveaux déclarés : « je ne sais pas » — on passe.
        ModeleCatalogue {
            id: "muet".to_string(),
            libelle: None,
            niveaux: Vec::new(),
        },
    ];
    // Un niveau OFFERT : passe.
    assert!(niveau_supporte("codex", "gpt-5", "high", &catalogue).is_none());
    // Un niveau NON offert : refusé avec les dispos.
    let refus = niveau_supporte("codex", "gpt-5", "ultra", &catalogue);
    assert!(
        refus.as_deref() == Some("“gpt-5” does not offer the level “ultra” (available: low, high)"),
        "le refus cite les disponibles : {refus:?}"
    );
    // Un modèle absent du catalogue : on ne tranche pas à sa place.
    assert!(niveau_supporte("codex", "inconnu", "ultra", &catalogue).is_none());
    // Un modèle muet : je ne sais pas — je passe.
    assert!(niveau_supporte("codex", "muet", "ultra", &catalogue).is_none());
    // Un kind hors MODEL_AWARE : niveau non vérifié.
    assert!(
        niveau_supporte("zsh", "gpt-5", "high", &catalogue).as_deref()
            == Some("“zsh”: unverified reasoning level"),
        "un kind sans mécanique : non vérifié"
    );
    // Un thinking vide : rien à vérifier.
    assert!(niveau_supporte("codex", "gpt-5", "  ", &catalogue).is_none());
}
