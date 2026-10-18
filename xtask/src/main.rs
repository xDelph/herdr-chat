//! xtask binary — thin CLI over the library. Subcommands:
//!
//!   cargo run --locked -p xtask -- verify            # all doors
//!   cargo run --locked -p xtask -- verify-layout     # structure door only
//!   cargo run --locked -p xtask -- graph             # member graph door only
//!
//! Optional `--root <dir>` runs the doors against another checkout (used by
//! synthetic probes that prove each door fails; probes are removed after).

const USAGE: &str = "usage: cargo xtask [--root <dir>] <verify|verify-layout|graph>";

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
        "graph" => match xtask::run::graph_check(&root) {
            Ok(order) => {
                println!("graphe conforme (ordre: {})", order.join(" "));
                Ok(())
            }
            Err(e) => Err(e),
        },
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
