//! xtask binary — thin CLI over the library. Subcommands:
//!
//!   cargo run --locked -p xtask -- verify            # all doors
//!   cargo run --locked -p xtask -- verify-layout     # structure door only
//!   cargo run --locked -p xtask -- graph             # member graph door only
//!   cargo run --locked -p xtask -- coverage          # parity matrix (T064)
//!   cargo run --locked -p xtask -- final-gate        # verify + bun + release build (T069)
//!   cargo run --locked -p xtask -- fixture-daemon    # herdrchat on fake Herdr (T067)
//!   cargo run --locked -p xtask -- release [--target <triple>]   # T066
//!
//! Optional `--root <dir>` runs the doors against another checkout (used by
//! synthetic probes that prove each door fails; probes are removed after).

const USAGE: &str = "usage: cargo xtask [--root <dir>] <verify|verify-layout|graph|coverage|contracts|bench|fixture-daemon|release|final-gate>";

/// Lit `compatibility/coverage.json`, vérifie les preuves (T064) et imprime
/// le rapport : résumé, défauts, entrées non prouvées avec leur écart, et les
/// items à re-marquer après intégration des autres lots.
fn coverage_report(root: &std::path::Path) -> Result<(), String> {
    let rapport = xtask::coverage::porte(root)?;
    println!("{}", rapport.resume());
    for defaut in &rapport.defauts {
        eprintln!("  défaut : {defaut}");
    }
    for (id, statut, taches, ecart) in &rapport.restantes {
        println!("  {statut} : {id} (tâches {}) — {ecart}", taches.join(", "));
    }
    let texte = std::fs::read_to_string(root.join("compatibility/coverage.json"))
        .map_err(|cause| format!("coverage.json : {cause}"))?;
    let document: serde_json::Value =
        serde_json::from_str(&texte).map_err(|cause| format!("coverage.json : {cause}"))?;
    for item in xtask::coverage::a_remarquer(&document) {
        println!("  à re-marquer après intégration : {item}");
    }
    if rapport.est_coherent() {
        Ok(())
    } else {
        Err(String::from("couverture : preuves incohérentes"))
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut positional: Vec<String> = Vec::new();
    let mut explicit_root: Option<std::path::PathBuf> = None;
    let mut index = 0;
    while index < args.len() {
        let arg = args[index].clone();
        if arg == "--root" {
            let next = args.get(index + 1);
            match next {
                Some(dir) => {
                    explicit_root = Some(std::path::PathBuf::from(dir));
                    index += 2;
                }
                None => {
                    eprintln!("--root exige un répertoire\n{USAGE}");
                    std::process::exit(2);
                }
            }
        } else {
            positional.push(arg);
            index += 1;
        }
    }
    let root = match explicit_root {
        Some(p) => p,
        None => match xtask::run::repo_root(None) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(2);
            }
        },
    };
    let command = match positional.first() {
        Some(c) => c.clone(),
        None => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    };
    let outcome = match command.as_str() {
        "verify" => xtask::run::verify(&root).map(|_| ()),
        "final-gate" => xtask::run::final_gate(&root),
        "verify-layout" => match xtask::run::verify_layout(&root) {
            Ok(report) => {
                println!("{}", report.exit_details());
                if report.is_clean() {
                    Ok(())
                } else {
                    Err("verify-layout en échec".to_string())
                }
            }
            Err(e) => Err(e),
        },
        "coverage" => coverage_report(&root),
        "graph" => match xtask::run::graph_check(&root) {
            Ok(order) => {
                println!("graphe conforme (ordre: {})", order.join(" "));
                Ok(())
            }
            Err(e) => Err(e),
        },
        "contracts" => match positional.get(1).map(String::as_str) {
            Some("export") => {
                xtask::contracts::exporter(&root, &root.join("packages/shared/generated"))
            }
            Some("check") => xtask::contracts::verifier(&root),
            Some(other) => {
                eprintln!(
                    "sous-commande contracts inconnue: {other}\nusage: cargo xtask contracts <export|check>"
                );
                std::process::exit(2);
            }
            None => {
                eprintln!("usage: cargo xtask contracts <export|check>");
                std::process::exit(2);
            }
        },
        "bench" => xtask::bench::entree(&root, &positional[1..]),
        "fixture-daemon" => xtask::bench::sert_fixture(&root, &positional[1..]),
        "release" => xtask::release::entree(&root, &positional[1..]),
        other => {
            eprintln!("sous-commande inconnue: {other}\n{USAGE}");
            std::process::exit(2);
        }
    };
    if let Err(e) = outcome {
        eprintln!("xtask: {e}");
        std::process::exit(1);
    }
}
