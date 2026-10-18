# Rust backend proposal

Status: **plan prêt à attribuer — développement non commencé**, mis à jour le 2026-10-18. Worktree `.worktrees/rust-backend`, branche `plan/rust-backend`. Le développeur sera choisi par l’utilisateur. Le plan inclut les corrections et les contraintes de composition et de tests.

Baseline: [`576bbf4902a00d3ef9702b4df315c943c7ac5680`](https://github.com/xDelph/herdr-chat/tree/576bbf4902a00d3ef9702b4df315c943c7ac5680), inspected 2026-10-17. Source was clean before documentation work. Comments and older design documents are treated as context; executable routes and declarations determine the inventory.

La base d’exécution du worktree est désormais `d19f98d23b02cacf7d6d9d97facf8d6360b0546b`, après intégration en avance rapide de la correction Codex présente sur main. [BASELINE-DELTA.md](BASELINE-DELTA.md) précise le comportement supplémentaire à conserver ; l’inventaire historique ci-dessus reste figé.

Coverage: **89 tracked capability IDs**, including **18 endpoints**; **17 explicit environment keys**; **48 server/shared source modules**; **171 declaration snapshots and 11 inline schemas**. The source map includes shared declarations that serve browser consumers as well as the backend; browser-only UI constants do not become Rust backend policy just because they share a file.

Read in this order:

1. [TASKS.md](TASKS.md) — **70 tâches en ordre strict**, périmètre, livrable et preuve de fin ; les 89 capacités et 27 corrections ont un propriétaire.
2. [ADAPTERS.md](ADAPTERS.md) — socles de stockage/famille, adaptations par agent, moteur commun des interactions et règles d’évolution.
3. [CURRENT.md](CURRENT.md) — complete capability inventory, all 18 HTTP endpoints, non-HTTP contracts, configuration, limits, persistence and operational behavior; implementation/contract discrepancies are explicit.
4. [TECH.md](TECH.md) — 13-member Cargo workspace, dependency graph, ownership, data flow, concurrency, security, error semantics, packaging and acceptance criteria.
5. [CONTRACTS.md](CONTRACTS.md) — static appendix of 171 schema/interface/type/error/constant declarations and 11 inline schemas, including exact optional/null distinctions. These are review snapshots, not a new executable contract.
6. [SOURCE-MAP.md](SOURCE-MAP.md) — all 48 non-test server/shared modules and their proposed Rust owners, with commit-pinned source links and exported symbols.

The scope includes backend features used by the webapp, even when they are private helpers or have no dedicated endpoint. Browser-only rendering, draft storage, service-worker behavior, and frontend routing stay in the existing web application; their backend compatibility requirements are included. The concrete frontend safety, rendering, focus and accessibility corrections are included in TASKS; a visual redesign, search and unread counters are not included.

## Proposed decisions to review

| Decision | Proposed default |
|---|---|
| Process model | One Rust daemon; multiple library crates, no microservices |
| Runtime / HTTP | Tokio + Axum |
| Workspace | 11 production members, one test-support member, one `xtask` member |
| Session adapters | Common JSONL/SQLite engines + family codecs + five agent profiles; no inherited agent-specific fallback |
| Contract authority | Rust wire DTOs and a typed endpoint registry; generated JSON Schema/OpenAPI and TypeScript runtime validators/types |
| Source storage | Read-only external JSONL/SQLite; no agent-session rewriting or schema migrations |
| State | Shared in-memory snapshots, source indexes and event journal; existing push JSON is the only durable application state required for parity |
| Compatibility | Existing URLs, fields, status unions, file behavior, push keys and configuration retained; defects are tracked separately |
| Control | All writes still go through Herdr; no direct process management or agent bus |
| Packaging | `herdrchat` native binary with embedded, version-matched PWA assets; preserve Homebrew service integration |
| Interactions | Separate `interactions` crate: common engine + numbered/selection/free-text families + explicit agent profiles |
| Tests | All Rust/TS tests outside src; existing TS tests moved at T004; structural gate enforced |
| Migration execution | T001→T070 on this worktree; developer assignment by user; deployment requires a distinct instruction |

No live agent received input. No agent or subagent was launched for this inventory. No backend code, workspace manifest, dependencies, service configuration, or frontend code was changed. The packet was checked by static source enumeration and cross-referencing; no tests or live capability probes were needed for this documentation task.
