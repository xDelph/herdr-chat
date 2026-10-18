//! Historical layout allowlist (TS tests under `src/` until T004).
//!
//! The door must be able to fail; the historical state of the TS baseline
//! must be listed explicitly instead of weakening the rule itself. Entries
//! expire at T004 by contract:
//! - a violation whose path is listed → counted as allowed, published in the
//!   report (never silently swallowed);
//! - an entry whose file no longer exists → `allowlist-stale` violation, so
//!   dead exemptions cannot linger;
//! - a violation not listed → immediate failure.

use std::fs;
use std::path::Path;

use serde_json::Value;

/// The parsed allowlist document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Allowlist {
    pub note: String,
    pub until_task: String,
    pub entries: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidateResult {
    /// Violations that survived (not covered by any entry).
    pub open: Vec<crate::layout::Violation>,
    /// Violation paths covered by an entry (counted, reported openly).
    pub allowed: Vec<String>,
    /// Entries pointing at files that no longer exist.
    pub stale_entries: Vec<String>,
}

/// Default location inside the worktree, as seen from the repo root.
pub const DEFAULT_CONFIG_PATH: &str = "xtask/layout-allowlist.json";

/// Load and validate the allowlist document. Structural errors are reported,
/// never papered over.
pub fn load(root: &Path, config_path: &str) -> Result<Allowlist, String> {
    let full = root.join(config_path);
    let text = fs::read_to_string(&full)
        .map_err(|e| format!("allowlist illisible ({config_path}): {e}"))?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|e| format!("allowlist invalide ({config_path}): {e}"))?;
    let obj = match value.as_object() {
        Some(o) => o,
        None => {
            return Err(format!(
                "allowlist inattendue ({config_path}): document non-objet"
            ));
        }
    };
    let note = match obj.get("note").and_then(Value::as_str) {
        Some(n) => n.to_string(),
        None => return Err("allowlist: champ «note» absente".to_string()),
    };
    let until = match obj.get("untilTask").and_then(Value::as_str) {
        Some(t) => t.to_string(),
        None => return Err("allowlist: champ «untilTask» absente".to_string()),
    };
    let entries = match obj.get("entries").and_then(Value::as_array) {
        Some(list) => list
            .iter()
            .map(|v| match v.as_str() {
                Some(s) => Ok(s.to_string()),
                None => Err("allowlist: entrée non-textuelle".to_string()),
            })
            .collect::<Result<Vec<String>, String>>()?,
        None => return Err("allowlist: champ «entries» absente".to_string()),
    };
    Ok(Allowlist {
        note,
        until_task: until,
        entries,
    })
}

/// Match a violation subject to the allowlist: only the TS historical rule is
/// forgivable; Rust structurals and path pollution never are.
pub fn validate(
    allowlisted: &Allowlist,
    violations: &[crate::layout::Violation],
    root: &Path,
) -> Result<ValidateResult, String> {
    if allowlisted.until_task != "T004" {
        // Honesty: the exception has an expiry by construction; anything else
        // means someone bypassed the contract rather than listing reality.
        return Err(format!(
            "allowlist: expiration inattendue «{}» (contrat: T004)",
            allowlisted.until_task
        ));
    }
    let mut open = Vec::new();
    let mut allowed = Vec::new();
    for v in violations {
        if v.rule == "ts-test-under-src" && allowlisted.entries.iter().any(|e| e == &v.path) {
            allowed.push(v.path.clone());
        } else {
            open.push(v.clone());
        }
    }
    let mut stale_entries = Vec::new();
    for entry in &allowlisted.entries {
        if !root.join(entry).exists() {
            stale_entries.push(entry.clone());
        }
    }
    Ok(ValidateResult {
        open,
        allowed,
        stale_entries,
    })
}
