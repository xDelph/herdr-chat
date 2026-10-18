//! Internal member graph gate — the TECH §2 arrow set, frozen as data.
//!
//! `xtask graph` compares the live workspace (via `cargo metadata --no-deps`)
//! against exactly this table. A missing, extra or reversed edge is a failure:
//! the plan forbids both silent new edges and silent removals. The table
//! mirrors `specs/rust-backend/TECH.md` §2; that document remains the
//! reference, this function is only its executable restatement.
//!
//! ⚠️ The collected graph counts **production** edges only: `run.rs` skips
//! `kind=dev` dependencies because TECH §2 explicitly allows `test-support`
//! as a dev-dependency without inducing production dependency cycles.

/// The expected internal dependency set per member name, sorted.
pub fn expected_internal_edges() -> Vec<(&'static str, Vec<&'static str>)> {
    vec![
        ("application", vec!["domain", "interactions"]),
        ("catalog", vec!["domain"]),
        ("contracts", vec!["domain"]),
        ("domain", vec![]),
        ("files", vec!["domain"]),
        ("herdr-client", vec!["domain"]),
        (
            "herdrchat",
            vec![
                "application",
                "catalog",
                "files",
                "herdr-client",
                "http-api",
                "interactions",
                "notifications",
                "sessions",
            ],
        ),
        ("http-api", vec!["application", "contracts", "domain"]),
        ("interactions", vec!["domain"]),
        ("notifications", vec!["domain", "files"]),
        ("sessions", vec!["domain", "files"]),
        ("test-support", vec!["domain"]),
        ("xtask", vec!["contracts"]),
    ]
}

/// Depth-first cycle detection over a member graph (nodes of which belong to
/// the same set). `Err` names the cycle origin, `Ok` gives a topological order
/// as further evidence of acyclicity.
pub fn assert_acyclic(edges: &[(String, Vec<String>)]) -> Result<Vec<String>, String> {
    let mut permanent: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut temporary: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut order: Vec<String> = Vec::new();

    for (name, _) in edges {
        visit(name, edges, &mut permanent, &mut temporary, &mut order)?;
    }
    Ok(order)
}

fn visit(
    name: &str,
    edges: &[(String, Vec<String>)],
    permanent: &mut std::collections::HashSet<String>,
    temporary: &mut std::collections::HashSet<String>,
    order: &mut Vec<String>,
) -> Result<(), String> {
    if permanent.contains(name) {
        return Ok(());
    }
    if temporary.contains(name) {
        return Err(format!("dépendance cyclique détectée via «{name}»"));
    }
    temporary.insert(name.to_string());
    let deps: Vec<String> = edges
        .iter()
        .find(|(n, _)| n == name)
        .map(|(_, d)| d.clone())
        .unwrap_or_default();
    for dep in &deps {
        visit(dep, edges, permanent, temporary, order)?;
    }
    temporary.remove(name);
    permanent.insert(name.to_string());
    order.push(name.to_string());
    Ok(())
}

/// Compare the live internal graph with the expected one: exact equality,
/// sorted members and deps, then a cycle pass. Any divergence is named.
pub fn check_internal_graph(live: &[(String, Vec<String>)]) -> Result<Vec<String>, String> {
    let expected: Vec<(String, Vec<String>)> = expected_internal_edges()
        .into_iter()
        .map(|(k, deps)| {
            (
                k.to_string(),
                deps.into_iter()
                    .map(str::to_string)
                    .collect::<Vec<String>>(),
            )
        })
        .collect();

    let mut live_sorted: Vec<(String, Vec<String>)> = live
        .iter()
        .map(|(k, deps)| {
            let mut sorted = deps.clone();
            sorted.sort();
            (k.clone(), sorted)
        })
        .collect();
    live_sorted.sort();

    if live_sorted.len() != expected.len() {
        return Err(format!(
            "graphe: nombre de membres inattendu ({} au lieu de {})",
            live_sorted.len(),
            expected.len()
        ));
    }
    for (got, want) in live_sorted.iter().zip(expected.iter()) {
        if got.0 != want.0 {
            return Err(format!(
                "graphe: membre inattendu «{}» (attendu «{}»)",
                got.0, want.0
            ));
        }
        if got.1 != want.1 {
            return Err(format!(
                "graphe: arêtes internes de «{}» divergent: {:?} ≠ {:?} (TECH §2)",
                got.0, got.1, want.1
            ));
        }
    }
    assert_acyclic(&live_sorted)
}
