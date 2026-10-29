//! Standing negative fixtures for the layout/graph doors (TECH §11: "has a
//! negative fixture proving rejection", §9: probes stay, though nothing here
//! touches the real `src/` trees).
//!
//! These are unit assertions over pure analyzers: they build synthetic
//! structures in memory (and never apply them to the working tree), then try
//! to prove that each rule can fail as well as stay silent. No `unwrap`/`expect`
//! anywhere — CI runs clippy with `--deny warnings`, including this target.

use std::path::Path;

use xtask::allowlist::{self, Allowlist};
use xtask::graph;
use xtask::layout::{self, Violation};

// Probe bodies are literal here: this file lives under `tests/`, where the
// scanner itself is exempt. Nothing in this target touches the real src trees.

#[test]
fn inline_test_module_under_src_is_flagged() {
    let body = "//! doc\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {}\n}\n";
    let path = "crates/foo/src/lib.rs";
    let violations = layout::scan_rust_file(path, body);
    let rules: Vec<&str> = violations.iter().map(|v| v.rule).collect();
    assert!(rules.contains(&"rust-cfg-test"), "cfg(test) doit être vu");
    assert!(
        rules.contains(&"rust-inline-test-module"),
        "mod tests doit être vu"
    );
    assert!(
        rules.contains(&"rust-inline-test-attr"),
        "#[test] doit être vu"
    );
    for v in &violations {
        assert_eq!(v.path, path);
    }
}

#[test]
fn same_body_under_tests_dir_is_clean() {
    let body =
        "//! doc\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {}\n}\n#[tokio::test]\n";
    let path = "crates/foo/tests/unit/foo.rs";
    assert!(
        layout::scan_rust_file(path, body).is_empty(),
        "un fichier sous tests/ est exempt du scan"
    );
}

#[test]
fn tokio_test_attr_outside_tests_is_flagged() {
    let body = "use std::path::Path;\n#[tokio::test]\nfn t() {}\n";
    let violations = layout::scan_rust_file("xtask/src/run.rs", body);
    assert_eq!(violations.len(), 1);
    assert_eq!(violations[0].rule, "rust-inline-tokio-test-attr");
    assert_eq!(violations[0].line, 2);
}

#[test]
fn include_of_tests_from_src_is_flagged_and_silent_under_tests() {
    let body = "include!(\"../tests/unit/fixt.rs\");\n";
    let outside = layout::scan_rust_file("xtask/src/main.rs", body);
    assert_eq!(
        outside.len(),
        1,
        "include! vers tests/ hors tests/ doit violer"
    );
    assert_eq!(outside[0].rule, "rust-tests-include-from-src");
    assert!(layout::scan_rust_file("xtask/tests/unit_tests.rs", body).is_empty());
}

#[test]
fn comments_never_trigger_rust_rules() {
    let body = "// #[cfg(test)] mod tests\n/* #[tokio::test] */\n/*\n#[test]\n*/\nlet x = 1;\n";
    assert!(
        layout::scan_rust_file("crates/foo/src/arbitre.rs", body).is_empty(),
        "les commentaires sont neutralisés sans décaler les lignes"
    );
}

#[test]
fn ts_test_files_under_src_are_path_violations() {
    assert_eq!(
        layout::scan_ts_path("apps/web/src/étape.test.ts").map(|v| v.rule),
        Some("ts-test-under-src")
    );
    assert_eq!(
        layout::scan_ts_path("packages/shared/src/schema.spec.tsx").map(|v| v.rule),
        Some("ts-test-under-src")
    );
    assert!(layout::scan_ts_path("apps/server/src/crypto.ts").is_none());
    assert!(layout::scan_ts_path("apps/web/tests/étape.test.ts").is_none());
    assert!(layout::scan_ts_path("packages/shared/scripts/build.ts").is_none());
    assert!(layout::scan_ts_path("xtask/layout-allowlist.json").is_none());
}

#[test]
fn nested_worktrees_and_build_outputs_are_skipped_not_scanned() {
    let paths = vec![
        ".worktrees/other/Cargo.toml".to_string(),
        "target/debug/build.rs".to_string(),
        "node_modules/@x/y/index.ts".to_string(),
        "crates/domain/src/ids.rs".to_string(),
    ];
    let outcome = layout::scan_file_list(Path::new("/nonexistent-root"), &paths);
    assert_eq!(
        outcome.skipped_worktrees, 1,
        ".worktrees/ n'est jamais analysé"
    );
    assert_eq!(
        outcome.skipped_paths, 2,
        "target/node_modules ne sont jamais analysés"
    );
    // crates/domain/src/ids.rs est le seul chemin non sauté; la racine est
    // fictive, donc sa lecture échoue — et le moteur le DIT au lieu de feindre
    // un scan silencieux (honnêteté > confort).
    assert_eq!(outcome.violations.len(), 1);
    assert_eq!(outcome.violations[0].rule, "unreadable-rust-source");
    assert_eq!(outcome.violations[0].path, "crates/domain/src/ids.rs");
}

#[test]
fn allowlist_suppresses_only_listed_ts_paths_and_remains_fail_open() {
    // Entries are exact paths; a Rust violation path that sneaks into the list
    // is NOT forgivable (only the ts historical rule may be exempted).
    let list = Allowlist {
        note: "sondes".to_string(),
        until_task: "T004".to_string(),
        entries: vec![
            "apps/server/src/agents/AgentRegistry.test.ts".to_string(),
            "crates/foo/src/lib.rs".to_string(),
        ],
    };
    let root = Path::new("/nonexistent-root");
    let subject = vec![
        Violation {
            path: "apps/server/src/agents/AgentRegistry.test.ts".to_string(),
            rule: "ts-test-under-src",
            line: 0,
            token: String::new(),
        },
        Violation {
            path: "crates/foo/src/lib.rs".to_string(),
            rule: "rust-cfg-test",
            line: 3,
            token: String::new(),
        },
        Violation {
            path: "apps/server/src/herdr/HerdrClient.test.ts".to_string(),
            rule: "ts-test-under-src",
            line: 0,
            token: String::new(),
        },
    ];
    let verdict = match allowlist::validate(&list, &subject, root) {
        Ok(v) => v,
        Err(e) => panic!("validate doit marcher: {e}"),
    };
    assert_eq!(
        verdict.allowed,
        vec!["apps/server/src/agents/AgentRegistry.test.ts".to_string()]
    );
    assert_eq!(verdict.open.len(), 2, "rust + non-listé restent ouverts");
    assert!(
        verdict.open.iter().any(|v| v.rule == "rust-cfg-test"),
        "une entrée allowlist ne pardonne jamais une règle rust"
    );
    assert!(
        verdict.open.iter().any(|v| v.rule == "ts-test-under-src"),
        "un ts hors liste reste un échec"
    );
}

#[test]
fn allowlist_stale_entries_fail_the_door() {
    // A listed file that disappeared is proof the list was not maintained.
    let list = Allowlist {
        note: "sondes".to_string(),
        until_task: "T004".to_string(),
        entries: vec!["apps/server/src/gone.test.ts".to_string()],
    };
    let verdict = match allowlist::validate(
        &list,
        &[Violation {
            path: "crates/foo/src/lib.rs".to_string(),
            rule: "rust-cfg-test",
            line: 1,
            token: String::new(),
        }],
        Path::new("/nonexistent-root"),
    ) {
        Ok(v) => v,
        Err(e) => panic!("validate doit marcher: {e}"),
    };
    assert_eq!(
        verdict.stale_entries,
        vec!["apps/server/src/gone.test.ts".to_string()]
    );
    assert!(!verdict.stale_entries.is_empty(), "porte prête à échouer");
}

#[test]
fn allowlist_expiry_is_part_of_the_contract() {
    let list = Allowlist {
        note: "sondes".to_string(),
        until_task: "never".to_string(),
        entries: vec![],
    };
    assert!(
        allowlist::validate(&list, &[], Path::new("/nonexistent-root")).is_err(),
        "une exception sans échéance est illégale"
    );
}

#[test]
fn expected_graph_accepts_itself_and_rejects_extra_edge() {
    // 1) The frozen TECH table trivially matches itself.
    let exact: Vec<(String, Vec<String>)> = {
        let raw = graph::expected_internal_edges();
        raw.iter()
            .map(|(k, deps)| {
                (
                    (*k).to_string(),
                    deps.iter().map(|d| d.to_string()).collect::<Vec<String>>(),
                )
            })
            .collect()
    };
    match graph::check_internal_graph(&exact) {
        Ok(order) => assert!(order.len() >= 13, "ordre topologique couvre les membres"),
        Err(e) => panic!("le graphe figé doit passer sa propre porte: {e}"),
    }

    // 2) A forbidden dependency (files → sessions) must be named exactly.
    let mut mutant = exact.clone();
    for (name, deps) in mutant.iter_mut() {
        if name == "files" {
            deps.push("sessions".to_string());
            deps.sort();
        }
    }
    assert!(
        graph::check_internal_graph(&mutant).is_err(),
        "dépendance interdite doit faire échouer la porte"
    );

    // 3) An extra member fails with a legible count.
    let mut mutant2 = exact.clone();
    mutant2.push(("bypass".to_string(), vec![]));
    match graph::check_internal_graph(&mutant2) {
        Ok(_) => panic!("membre surnuméraire doit échouer"),
        Err(e) => assert!(e.contains("nombre de membres inattendu"), "{e}"),
    }

    // 4) A reversed edge (application depends on nothing, domain on
    //    application) must fail even though the edge count matches.
    let mut mutant3 = exact.clone();
    mutant3.retain(|(n, _)| n != "application" && n != "domain");
    mutant3.push(("application".to_string(), vec![]));
    mutant3.push(("domain".to_string(), vec!["application".to_string()]));
    assert!(graph::check_internal_graph(&mutant3).is_err());
}

#[test]
fn cycle_detection_names_the_origin() {
    let cyclic = vec![
        ("a".to_string(), vec!["b".to_string()]),
        ("b".to_string(), vec!["c".to_string()]),
        ("c".to_string(), vec!["a".to_string()]),
    ];
    match graph::assert_acyclic(&cyclic) {
        Ok(_) => panic!("un cycle doit échouer"),
        Err(e) => assert!(e.contains("cyclique"), "{e}"),
    }
    let acyclic = vec![
        ("a".to_string(), vec![]),
        ("b".to_string(), vec!["a".to_string()]),
        ("c".to_string(), vec!["a".to_string(), "b".to_string()]),
    ];
    match graph::assert_acyclic(&acyclic) {
        Ok(order) => assert_eq!(order.first().map(String::as_str), Some("a")),
        Err(e) => panic!("graphe sain doit passer: {e}"),
    }
}

#[test]
fn the_scanner_must_stay_silent_on_its_own_source() {
    // Self-guard: this file is read from its real location; the gate that
    // scans `src/` must not flag the gate itself.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    for name in [
        "src/layout.rs",
        "src/graph.rs",
        "src/allowlist.rs",
        "src/run.rs",
        "src/lib.rs",
        "src/main.rs",
    ] {
        let full = Path::new(manifest_dir).join(name);
        let body = match std::fs::read_to_string(&full) {
            Ok(b) => b,
            Err(e) => panic!("lecture impossible {name}: {e}"),
        };
        let rel = format!("xtask/{name}");
        let violations = layout::scan_rust_file(&rel, &body);
        assert!(violations.is_empty(), "le scanner se drape: {violations:?}");
    }
}

// ─────────────── la porte de couverture (T064) ───────────────
//
// ⚠️ Une porte qu'on n'a jamais vue échouer ne prouve rien : ces cas
// construisent des matrices fautives et exigent le défaut nommé.

/// Un répertoire temporaire unique.
fn répertoire_temporaire() -> std::path::PathBuf {
    let base = std::env::temp_dir();
    for nonce in 0..4096_u32 {
        let chemin = base.join(format!("xtask-couverture-{}-{nonce}", std::process::id()));
        if std::fs::create_dir(&chemin).is_ok() {
            return chemin;
        }
    }
    panic!("aucun répertoire temporaire libre");
}

fn entree(id: &str, statut: xtask::coverage::Statut, preuves: &[&str]) -> xtask::coverage::Entree {
    xtask::coverage::Entree {
        candidats: Vec::new(),
        id: String::from(id),
        preuves: preuves.iter().map(|p| String::from(*p)).collect(),
        preuves_unitaires: Vec::new(),
        ecart: None,
        statut,
        taches: Vec::new(),
    }
}

/// Crée un fichier vide (et ses dossiers) sous la racine.
fn touche(racine: &Path, chemin: &str) {
    let complet = racine.join(chemin);
    if let Some(parent) = complet.parent() {
        std::fs::create_dir_all(parent).unwrap_or_else(|cause| panic!("{cause}"));
    }
    std::fs::write(complet, "").unwrap_or_else(|cause| panic!("{cause}"));
}

#[test]
fn couverture_une_preuve_existante_est_acceptee() {
    let racine = répertoire_temporaire();
    touche(&racine, "crates/http-api/tests/unit/a.rs");
    let rapport = xtask::coverage::verifie(
        &racine,
        &[entree(
            "H01",
            xtask::coverage::Statut::Proven,
            &["crates/http-api/tests/unit/a.rs"],
        )],
    );
    assert!(rapport.est_complete(), "{rapport:?}");
    assert_eq!(rapport.prouvees, 1);
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_une_preuve_sous_src_est_refusee() {
    let racine = répertoire_temporaire();
    std::fs::write(racine.join("a.rs"), "").unwrap_or_else(|cause| panic!("{cause}"));
    std::fs::create_dir_all(racine.join("crates/x/src")).unwrap_or_else(|cause| panic!("{cause}"));
    std::fs::write(racine.join("crates/x/src/a.rs"), "").unwrap_or_else(|cause| panic!("{cause}"));
    let rapport = xtask::coverage::verifie(
        &racine,
        &[entree(
            "H01",
            xtask::coverage::Statut::Proven,
            &["crates/x/src/a.rs"],
        )],
    );
    assert!(!rapport.est_coherent());
    assert!(rapport.defauts[0].contains("src/"), "{:?}", rapport.defauts);
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_une_preuve_introuvable_est_un_defaut() {
    let racine = répertoire_temporaire();
    let rapport = xtask::coverage::verifie(
        &racine,
        &[entree(
            "H01",
            xtask::coverage::Statut::Proven,
            &["crates/x/tests/inexistant.rs"],
        )],
    );
    assert!(!rapport.est_coherent());
    assert!(rapport.defauts[0].contains("introuvable"));
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_une_preuve_annoncee_sans_fichier_est_un_defaut() {
    let racine = répertoire_temporaire();
    let rapport = xtask::coverage::verifie(
        &racine,
        &[entree("H01", xtask::coverage::Statut::Proven, &[])],
    );
    // Le pire cas : un document qui se déclare couvert sans rien nommer.
    assert!(!rapport.est_coherent());
    assert!(rapport.defauts[0].contains("sans fichier"));
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_un_statut_absent_compte_comme_en_attente() {
    let racine = répertoire_temporaire();
    let document = serde_json::json!({
        "capabilities": [{ "id": "H01", "deliverTasks": ["T050"] }],
        "corrections": []
    });
    let rapport = xtask::coverage::verifie_document(&racine, &document)
        .unwrap_or_else(|cause| panic!("document : {cause}"));
    assert_eq!(rapport.en_attente, 1);
    assert_eq!(rapport.prouvees, 0);
    assert!(
        rapport.est_coherent(),
        "l'absence de statut n'est pas un défaut"
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_un_identifiant_en_double_est_refuse() {
    let racine = répertoire_temporaire();
    let document = serde_json::json!({
        "capabilities": [{ "id": "H01" }, { "id": "H01" }],
        "corrections": []
    });
    let erreur = xtask::coverage::verifie_document(&racine, &document)
        .err()
        .unwrap_or_else(|| panic!("un doublon doit être refusé"));
    assert!(erreur.contains("double"), "{erreur}");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_une_liste_absente_est_refusee() {
    let racine = répertoire_temporaire();
    let document = serde_json::json!({ "capabilities": [] });
    let erreur = xtask::coverage::verifie_document(&racine, &document)
        .err()
        .unwrap_or_else(|| panic!("une liste absente doit être refusée"));
    assert!(erreur.contains("corrections"), "{erreur}");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_les_candidats_ne_sont_pas_des_preuves() {
    let racine = répertoire_temporaire();
    let document = serde_json::json!({
        "capabilities": [
            { "id": "H01", "candidateTests": ["crates/x/tests/a.rs"] },
            { "id": "H02" }
        ],
        "corrections": []
    });
    let rapport = xtask::coverage::verifie_document(&racine, &document)
        .unwrap_or_else(|cause| panic!("document : {cause}"));
    // Un candidat n'est PAS une preuve : la capacité reste en attente.
    assert_eq!(rapport.en_attente, 2);
    assert_eq!(rapport.prouvees, 0);
    assert_eq!(rapport.avec_candidats, 1);
    let _ = std::fs::remove_dir_all(&racine);
}

// ── Le modèle « prouvé par composition » (audit T064) ──

#[test]
fn couverture_proven_sur_un_seul_test_de_composant_est_un_defaut() {
    // Le cas exact de l'audit : un composant testé seul (livraison push) que
    // le démon n'appelle pas ne peut pas être « proven ».
    let racine = répertoire_temporaire();
    touche(&racine, "crates/notifications/tests/unit/delivery.rs");
    let rapport = xtask::coverage::verifie(
        &racine,
        &[entree(
            "E09",
            xtask::coverage::Statut::Proven,
            &["crates/notifications/tests/unit/delivery.rs"],
        )],
    );
    assert!(!rapport.est_coherent(), "{rapport:?}");
    assert!(
        rapport.defauts[0].contains("sans preuve composée"),
        "{:?}",
        rapport.defauts
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_unit_only_et_not_wired_exigent_un_ecart_decrit() {
    let racine = répertoire_temporaire();
    touche(&racine, "crates/sessions/tests/unit/cursor.rs");
    let mut sans_ecart = entree("C12", xtask::coverage::Statut::UnitOnly, &[]);
    sans_ecart.preuves_unitaires = vec![String::from("crates/sessions/tests/unit/cursor.rs")];
    let mut non_branchee = entree("E09", xtask::coverage::Statut::NotWired, &[]);
    non_branchee.ecart = Some(String::from("delivery jamais appelée par le démon"));
    let rapport = xtask::coverage::verifie(&racine, &[sans_ecart.clone(), non_branchee]);
    assert_eq!(rapport.defauts.len(), 1, "{:?}", rapport.defauts);
    assert!(rapport.defauts[0].contains("C12") && rapport.defauts[0].contains("gap"));
    assert_eq!(rapport.unitaires, 1);
    assert_eq!(rapport.non_branchees, 1);

    // Avec l'écart décrit : cohérente, mais jamais complète.
    sans_ecart.ecart = Some(String::from("le curseur n'est pas validé par la route"));
    let rapport = xtask::coverage::verifie(&racine, &[sans_ecart]);
    assert!(rapport.est_coherent(), "{rapport:?}");
    assert!(!rapport.est_complete());
    assert_eq!(rapport.restantes[0].1, "unit-only");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_une_reference_unitaire_cassee_est_un_defaut() {
    // C21/C22/C24 pointaient des fichiers disparus : une référence cassée est
    // un défaut quel que soit le statut.
    let racine = répertoire_temporaire();
    let mut cassee = entree("C21", xtask::coverage::Statut::UnitOnly, &[]);
    cassee.ecart = Some(String::from("test à écrire"));
    cassee.preuves_unitaires = vec![String::from("apps/web/tests/mise-a-jour.test.ts")];
    let rapport = xtask::coverage::verifie(&racine, &[cassee]);
    assert!(!rapport.est_coherent());
    assert!(
        rapport.defauts[0].contains("introuvable"),
        "{:?}",
        rapport.defauts
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_un_statut_inconnu_est_un_defaut() {
    let racine = répertoire_temporaire();
    let document = serde_json::json!({
        "capabilities": [{ "id": "H01", "status": "prouvé-en-gros" }],
        "corrections": []
    });
    let rapport = xtask::coverage::verifie_document(&racine, &document)
        .unwrap_or_else(|cause| panic!("document : {cause}"));
    assert!(!rapport.est_coherent());
    assert!(rapport.defauts[0].contains("statut inconnu"));
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_l_inventaire_complet_est_exige_pour_le_document_reel() {
    let racine = répertoire_temporaire();
    let document = serde_json::json!({
        "capabilities": [{ "id": "H01" }, { "id": "Z99" }],
        "corrections": [{ "id": "C01" }]
    });
    let rapport = xtask::coverage::verifie_document_avec(&racine, &document, true)
        .unwrap_or_else(|cause| panic!("document : {cause}"));
    // 91 capacités (H01–H21…) et 26 corrections manquent, et Z99 est inconnu.
    assert!(
        rapport
            .defauts
            .iter()
            .any(|d| d.starts_with("H02 : identifiant absent"))
    );
    assert!(
        rapport
            .defauts
            .iter()
            .any(|d| d.starts_with("C27 : identifiant absent"))
    );
    assert!(
        rapport
            .defauts
            .iter()
            .any(|d| d.starts_with("Z99 : identifiant inconnu"))
    );
    assert_eq!(rapport.defauts.len(), 91 + 26 + 1, "{:?}", rapport.defauts);
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn couverture_la_matrice_du_depot_est_coherente() {
    // La porte réelle sur le document réel — la même que `xtask verify`.
    let racine = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let rapport =
        xtask::coverage::porte(&racine).unwrap_or_else(|cause| panic!("coverage.json : {cause}"));
    assert!(rapport.est_coherent(), "{:#?}", rapport.defauts);
}
