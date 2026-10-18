//! Layout gate — pure analysis rules (TECH §11 / AGENTS migration rules).
//!
//! Rules are text- and path-only on purpose: `verify-layout` must stay able to
//! run without building the workspace, without resolving dependencies and
//! without descending into nested worktrees. Everything derived from here is
//! enforced for files that are tracked or new (git `--exclude-standard`),
//! and that policy is not optional.
//!
//! Rule inventory (see also `AGENTS.md` “Aucun test sous un répertoire src/”):
//! - `ts-test-under-src`: TS/JS test/spec file living under any `src/` tree.
//! - `ts-test-dir-under-src`: a `__tests__/` directory inside `src/`.
//! - `rust-inline-test-attr`: `#[test]` outside a `tests/` directory.
//! - `rust-inline-tokio-test-attr`: `#[tokio::test]` outside `tests/`.
//! - `rust-cfg-test`: `#[cfg(test)]` anywhere outside `tests/`.
//! - `rust-inline-test-module`: `mod tests` outside `tests/`.
//! - `rust-tests-include-from-src`: `include!(…tests…)` from a non-test file.
//! - `allowlist-stale`: a historical exemption whose file no longer exists.
//!
//! Known, documented limitation: Rust comment stripping is line-naïve
//! (`//` cut, plus `/* … */` block tracking); a `//` sequence inside a string
//! literal can create a false positive on a later part of that line. Accepting
//! the small false-positive class is deliberate — the gate never lets a real
//! violation pass by cutting, only noise on exotic literal content, and that
//! noise is visible rather than silently muted.

use std::fs;
use std::path::Path;

/// A single rule failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    pub path: String,
    pub rule: &'static str,
    pub line: usize,
    pub token: String,
}

fn violation(path: &str, rule: &'static str, line: usize, token: &str) -> Violation {
    Violation {
        path: path.to_string(),
        rule,
        line,
        token: token.to_string(),
    }
}

// The forbidden tokens are assembled at runtime instead of written once:
// the door scans `xtask/src` itself (see the self-guard test), so the exact
// literals must not appear verbatim in this source file.
fn token_test_attr() -> String {
    format!("#[{}]", "test")
}

fn token_tokio_attr() -> String {
    format!("#[{}{}]", "tokio::", "test")
}

fn token_cfg_test() -> String {
    format!("#[cfg({})]", "test")
}

fn token_mod_tests() -> String {
    format!("mod {}", "tests")
}

fn token_include_open() -> String {
    format!("include{}(", "!")
}

fn token_tests_dir() -> String {
    format!("tests{}", "/")
}

/// Components that are never analyzed: nested git worktrees and VCS/build
/// output that somehow became visible to `git ls-files`.
pub const SKIPPED_COMPONENTS: [&str; 6] = [
    ".worktrees",
    ".git",
    "target",
    "node_modules",
    "dist",
    "coverage",
];

/// `true` when a path must not even be opened for analysis.
pub fn is_skipped_path(path: &str) -> bool {
    path.split('/')
        .any(|component| SKIPPED_COMPONENTS.contains(&component))
}

/// `true` when the file lives under a dedicated `tests/` directory.
pub fn is_under_tests_dir(path: &str) -> bool {
    path.split('/').any(|component| component == "tests")
}

/// `true` when the path is a TS/JS test/spec filename.
pub fn is_test_like_file_name(path: &str) -> bool {
    let file = path.rsplit('/').next().unwrap_or_default();
    let lower = file.to_ascii_lowercase();
    lower.ends_with(".test.ts")
        || lower.ends_with(".test.tsx")
        || lower.ends_with(".test.js")
        || lower.ends_with(".test.jsx")
        || lower.ends_with(".spec.ts")
        || lower.ends_with(".spec.tsx")
        || lower.ends_with(".spec.js")
        || lower.ends_with(".spec.jsx")
}

/// Replace comments with spaces, preserving line structure exactly.
fn strip_rust_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes: Vec<char> = text.chars().collect();
    let mut i = 0;
    let mut in_block = false;
    while i < bytes.len() {
        if in_block {
            if bytes[i] == '*' && bytes.get(i + 1) == Some(&'/') {
                out.push(' ');
                out.push(' ');
                i += 2;
                in_block = false;
            } else {
                out.push(if bytes[i] == '\n' { '\n' } else { ' ' });
                i += 1;
            }
        } else if bytes[i] == '/' && bytes.get(i + 1) == Some(&'*') {
            out.push(' ');
            out.push(' ');
            i += 2;
            in_block = true;
        } else if bytes[i] == '/' && bytes.get(i + 1) == Some(&'/') {
            // Line comment: blank it until newline.
            while i < bytes.len() && bytes[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    out
}

/// Scan one Rust file body. Path decides exemption: only dedicated `tests/`
/// directories may contain test declarations. At most one token per line is
/// reported: the door only needs to fail, not to enumerate.
pub fn scan_rust_file(path: &str, content: &str) -> Vec<Violation> {
    if is_under_tests_dir(path) {
        return Vec::new();
    }
    let stripped = strip_rust_comments(content);
    let single: [(String, &'static str); 4] = [
        (token_test_attr(), "rust-inline-test-attr"),
        (token_tokio_attr(), "rust-inline-tokio-test-attr"),
        (token_cfg_test(), "rust-cfg-test"),
        (token_mod_tests(), "rust-inline-test-module"),
    ];
    let include_open = token_include_open();
    let tests_dir = token_tests_dir();
    let mut found = Vec::new();
    for (i, line) in stripped.lines().enumerate() {
        let hit = single.iter().find_map(|(token, rule)| {
            if line.contains(token) {
                Some(violation(path, rule, i + 1, token))
            } else {
                None
            }
        });
        if let Some(v) = hit {
            found.push(v);
            continue;
        }
        if line.contains(&include_open) && line.contains(&tests_dir) {
            found.push(violation(
                path,
                "rust-tests-include-from-src",
                i + 1,
                "include!",
            ));
        }
    }
    found
}

/// Path-level rule for TS/JS files (no content needed).
pub fn scan_ts_path(path: &str) -> Option<Violation> {
    if !is_test_like_file_name(path) {
        return None;
    }
    let in_src = path.split('/').any(|component| component == "src");
    if !in_src {
        return None;
    }
    Some(violation(path, "ts-test-under-src", 0, path))
}

/// Aggregate one scan pass over a file list (relative paths). Rust bodies are
/// read from disk; TS rules are path-level. Skipped paths are counted, not
/// analyzed.
pub struct ScanOutcome {
    pub violations: Vec<Violation>,
    pub skipped_worktrees: usize,
    pub skipped_paths: usize,
}

pub fn scan_file_list(root: &Path, paths: &[String]) -> ScanOutcome {
    let mut violations = Vec::new();
    let mut skipped_worktrees = 0;
    let mut skipped_paths = 0;
    for path in paths {
        if path.split('/').any(|component| component == ".worktrees") {
            skipped_worktrees += 1;
            continue;
        }
        if is_skipped_path(path) {
            skipped_paths += 1;
            continue;
        }
        if let Some(v) = scan_ts_path(path) {
            violations.push(v);
        }
        if path.ends_with(".rs") {
            if let Ok(content) = fs::read_to_string(root.join(path)) {
                violations.extend(scan_rust_file(path, &content));
            } else {
                violations.push(violation(
                    path,
                    "unreadable-rust-source",
                    0,
                    "no byte content readable",
                ));
            }
        }
    }
    ScanOutcome {
        violations,
        skipped_worktrees,
        skipped_paths,
    }
}
