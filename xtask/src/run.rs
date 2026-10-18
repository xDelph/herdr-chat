//! Gate orchestration — spawns cargo/git, reports honest results.
//!
//! `verify` runs all doors in a stable order and stops at the first failure
//! with a diagnosable message. `verify-layout` and `graph` are individually
//! callable. These functions exist only for the command surface; the pure
//! analysis lives in `layout`, `graph` and `allowlist` modules.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

use crate::allowlist;
use crate::graph;
use crate::layout::{self, Violation};

fn spawn_checked(cmd: &mut Command, what: &str) -> Result<(), String> {
    let status = cmd
        .status()
        .map_err(|e| format!("{what}: échec du processus: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{what}: a échoué ({status})"))
    }
}

fn cargo(root: &Path, args: &[&str], what: &str) -> Result<(), String> {
    let mut c = Command::new("cargo");
    c.current_dir(root).args(args);
    spawn_checked(&mut c, what)
}

/// `cargo fmt --all -- --check`
pub fn fmt_check(root: &Path) -> Result<(), String> {
    cargo(
        root,
        &["fmt", "--all", "--", "--check"],
        "format (cargo fmt --check)",
    )
}

/// `cargo clippy --workspace --all-targets --locked -- --deny warnings`
pub fn clippy(root: &Path) -> Result<(), String> {
    cargo(
        root,
        &[
            "clippy",
            "--workspace",
            "--all-targets",
            "--locked",
            "--",
            "--deny",
            "warnings",
        ],
        "clippy (deny warnings)",
    )
}

/// `cargo test --workspace --locked` — only external `tests/` targets exist;
/// the layout gate guarantees no inline tests anywhere under `src/`.
pub fn tests(root: &Path) -> Result<(), String> {
    cargo(
        root,
        &["test", "--workspace", "--locked"],
        "tests (cwd tests/ only)",
    )
}

/// Collect member→member dependencies from `cargo metadata --no-deps`.
pub fn collect_internal_graph(root: &Path) -> Result<Vec<(String, Vec<String>)>, String> {
    let out = Command::new("cargo")
        .current_dir(root)
        .args(["metadata", "--no-deps", "--format-version=1"])
        .output()
        .map_err(|e| format!("cargo metadata: échec du processus: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "cargo metadata: a échoué ({})",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let value: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("cargo metadata: JSON illisible: {e}"))?;
    let packages = match value.get("packages").and_then(Value::as_array) {
        Some(p) => p.clone(),
        None => return Err("cargo metadata: champ «packages» absente".to_string()),
    };
    let member_names: Vec<String> = packages
        .iter()
        .filter_map(|p| p.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect();
    let mut result = Vec::new();
    for pkg in packages {
        let name = match pkg.get("name").and_then(Value::as_str) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let mut member_deps: Vec<String> = Vec::new();
        if let Some(deps) = pkg.get("dependencies").and_then(Value::as_array) {
            for dep in deps {
                let dep_name = match dep.get("name").and_then(Value::as_str) {
                    Some(d) => d,
                    None => continue,
                };
                if member_names.contains(&dep_name.to_string()) {
                    member_deps.push(dep_name.to_string());
                }
            }
        }
        result.push((name, member_deps));
    }
    Ok(result)
}

/// The graph door.
pub fn graph_check(root: &Path) -> Result<Vec<String>, String> {
    let live = collect_internal_graph(root)?;
    graph::check_internal_graph(&live)
}

/// Read the worktree file set: tracked + new (untracked, non-ignored).
pub fn list_worktree_files(root: &Path) -> Result<Vec<String>, String> {
    let out = Command::new("git")
        .current_dir(root)
        .args([
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .output()
        .map_err(|e| format!("git ls-files: échec du processus: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git ls-files: a échoué ({})",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let chunks: Vec<String> = out
        .stdout
        .split(|byte: &u8| *byte == 0)
        .filter(|chunk| !chunk.is_empty())
        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
        .collect();
    Ok(chunks)
}

/// The layout door. Loads the allowlist, scans, and decides.
pub fn verify_layout(root: &Path) -> Result<LayoutReport, String> {
    let paths = list_worktree_files(root)?;
    let outcome = layout::scan_file_list(root, &paths);
    let config = allowlist::load(root, allowlist::DEFAULT_CONFIG_PATH)?;
    let verdict = allowlist::validate(&config, &outcome.violations, root)?;
    Ok(LayoutReport {
        scanned: paths.len() - outcome.skipped_worktrees - outcome.skipped_paths,
        skipped_worktrees: outcome.skipped_worktrees,
        skipped_paths: outcome.skipped_paths,
        open: verdict.open,
        allowed: verdict.allowed,
        stale_entries: verdict.stale_entries,
    })
}

/// The layout verdict, printable without losing information.
pub struct LayoutReport {
    pub scanned: usize,
    pub skipped_worktrees: usize,
    pub skipped_paths: usize,
    pub open: Vec<Violation>,
    pub allowed: Vec<String>,
    pub stale_entries: Vec<String>,
}

impl LayoutReport {
    pub fn exit_details(&self) -> String {
        let mut text = format!(
            "verify-layout: {} fichiers analysés ({}, worktrees imbriqués ignorés, sortis de l'analyse), {} autorisés (historique T004), {} ouverts",
            self.scanned,
            self.skipped_worktrees + self.skipped_paths,
            self.allowed.len(),
            self.open.len() + self.stale_entries.len()
        );
        for v in &self.open {
            if v.line == 0 {
                text.push_str(&format!(
                    "\n  violation {} {} ({})",
                    v.rule, v.path, v.token
                ));
            } else {
                text.push_str(&format!(
                    "\n  violation {} {}:{} ({})",
                    v.rule, v.path, v.line, v.token
                ));
            }
        }
        for entry in &self.stale_entries {
            text.push_str(&format!(
                "\n  violation allowlist-stale {entry} (fichier disparu — purger l'entrée)"
            ));
        }
        text
    }

    pub fn is_clean(&self) -> bool {
        self.open.is_empty() && self.stale_entries.is_empty()
    }
}

/// Run a step with its header, stop on first failure, return the failure text.
fn step(name: &str, root: &Path, door: fn(&Path) -> Result<(), String>) -> Result<(), String> {
    println!("[verify] {name} ...");
    match door(root) {
        Ok(()) => {
            println!("[verify] {name} — ok");
            Ok(())
        }
        Err(e) => {
            eprintln!("[verify] {name} — ÉCHEC: {e}");
            Err(format!("{name} en échec"))
        }
    }
}

/// `xtask verify` — all doors, layout first (no build needed to fail fast on
/// structure), then graph, format, clippy, external tests.
pub fn verify(root: &Path) -> Result<(), String> {
    let layout_report = verify_layout(root)?;
    if layout_report.is_clean() {
        println!(
            "[verify] verify-layout — ok ({})",
            layout_report
                .exit_details()
                .lines()
                .next()
                .unwrap_or_default()
        );
    } else {
        eprintln!(
            "[verify] verify-layout — ÉCHEC:{}",
            layout_report.exit_details()
        );
        return Err("verify-layout en échec".to_string());
    }

    let order = graph_check(root)?;
    println!(
        "[verify] graph — ok (ordre topologique: {})",
        order.join(" ")
    );

    step("format", root, fmt_check)?;
    step("clippy", root, clippy)?;
    step("tests", root, tests)?;
    Ok(())
}

/// Resolve the worktree root: current directory minus a probing search.
pub fn repo_root(argv_root: Option<PathBuf>) -> Result<PathBuf, String> {
    let cwd = match argv_root {
        Some(p) => p,
        None => std::env::current_dir().map_err(|e| format!("cwd illisible: {e}"))?,
    };
    let manifest = cwd.join("Cargo.toml");
    if fs::read_to_string(&manifest)
        .map(|t| t.contains("[workspace]"))
        .unwrap_or(false)
    {
        return Ok(cwd);
    }
    Err(format!(
        "racine du workspace introuvable depuis {} (Cargo.toml workspace absent)",
        cwd.display()
    ))
}
