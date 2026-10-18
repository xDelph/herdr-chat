#!/usr/bin/env python3
"""Build compatibility/baseline.json and compatibility/coverage.json (task T001).

Reproducible derivation of the frozen reference inventory. The capability
expectations are embedded as data (they describe CURRENT.md's frozen
inventory at commit 576bbf4 + BASELINE-DELTA at d19f98d); the declaration
index and the source-module map are parsed from the pinned spec documents so
no entry can be silently omitted.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "specs" / "rust-backend"
OUT = ROOT / "compatibility"

HISTORICAL_BASELINE = "576bbf4902a00d3ef9702b4df315c943c7ac5680"
EXECUTION_BASE = "d19f98d23b02cacf7d6d9d97facf8d6360b0546b"

# ---------------------------------------------------------------------------
# Capabilities: 89 IDs from CURRENT.md. expectation = behavior to preserve
# (with corrected expectation when a change ledger defect applies).
# target = future Rust/TS test home; tasks = delivering tasks per TASKS.md.
# ---------------------------------------------------------------------------

CAPS = [
    # (id, title, expectation, tasks, target)
    ("O01", "Runtime: single Bun HTTP process, Effect services, scoped watcher",
     "Execution test target maps service ownership; parity claims come from behavior tests, not this documentation.",
     ["T056"], "crates/herdrchat/tests"),
    ("O02", "Bind 127.0.0.1:8791 default; tailnet bind; reject public/wildcard",
     "Default bind 127.0.0.1; strict IpAddr parse; correction C10 narrows tailnet to 100.64.0.0/10 + fd7a:115c:a1e0::/48 and forbids wildcard/public; port strict 1..65535.",
     ["T048"], "crates/herdrchat/tests (config matrix)"),
    ("O03", "Herdr startup ping; Herdr unavailable = warning, HTTP stays up",
     "Ping result drives health warning only; backend must serve even when Herdr is unreachable.",
     ["T056"], "crates/herdrchat/tests (composition)"),
    ("O04", "Polling watcher starts with service; SIGINT/SIGTERM shutdown",
     "Watcher lifecycle owns no process outside its own; shutdown stops watcher, poller, subscriptions; no user agent touched.",
     ["T056"], "crates/herdrchat/tests (shutdown) + crates/application/tests"),
    ("O05", "Compiled PWA served relative to server source location",
     "Assets embedded at build time; binary serves from any cwd; no arbitrary disk path exposure.",
     ["T054"], "crates/herdrchat/tests + crates/http-api/tests"),
    ("O06", "Static traversal/symlink confinement; SPA fallback; JSON 503 if build absent",
     "Bad encoding/escapes/missing assets fall back to index; missing build yields JSON 503 {error,hint}; unknown /api stays JSON 404 (C08).",
     ["T054"], "crates/http-api/tests + crates/herdrchat/tests"),
    ("O07", "no-cache/no-store for index, worker, manifest; API JSON no-store",
     "Headers retained: index/sw.js/push-sw.js/manifest + fallback HTML no-cache,no-store,must-revalidate; API JSON no-store.",
     ["T054", "T049"], "crates/http-api/tests"),
    ("O08", "herdrchat launcher + release tarball with built PWA and sources",
     "Native release path: herdrchat binary with embedded PWA; no Bun/Node requirement; archives/checksums prepared at T066.",
     ["T066", "T068"], "crates/xtask/tests + release workflow (CI)"),
    ("O09", "Homebrew service + Tailscale Serve documented deployment",
     "Service integration retained conceptually; tap/service changes remain separate deployment work requiring explicit user instruction.",
     ["T066", "T070"], "review docs only"),
    ("O10", "verify = format, lint, typecheck, tests; pre-commit + tag release",
     "Rust gates (fmt/clippy/test/layout/coverage) compose with TS gates during transition; xtask verify enforces them.",
     ["T003", "T069"], "crates/xtask/tests + workspace gates"),

    ("H01", "GET /api/health",
     "200 HealthResponse; 503 same schema ok:false herdr.reachable:false; 500 unreadable result.",
     ["T050", "T010"], "crates/http-api/tests/contract_tests.rs"),
    ("H02", "GET /api/overview",
     "200 OverviewResponse; failures map to explicit endpoint errors, never stale-as-fresh (C23).",
     ["T050", "T010"], "crates/http-api/tests/contract_tests.rs"),
    ("H03", "GET /api/conversations",
     "200 ConversationsResponse; 503 {conversations:[]} snapshot failure; 502 same empty shape unreadable snapshot.",
     ["T050", "T010"], "crates/http-api/tests/contract_tests.rs"),
    ("H04", "GET /api/agents/:paneId/session",
     "Query tail,cursor,before; 200 SessionResponse; 400 bad/exclusive cursors; 403 rejected path; 404 no usable source; 409 stale history; 422 oversized record (C18); 502 read/control failure; 503 missing SQLite DB; caughtUp added (C18).",
     ["T050", "T010"], "crates/http-api/tests/contract_tests.rs (session matrix)"),
    ("H05", "POST /api/agents/:paneId/prompt",
     "200 PromptSentResponse | PromptSuppressedResponse; 400 malformed body; 413 text>32KiB UTF-8; 502 PromptFailedResponse; 500 unreadable result; success requires discriminator proof (C05).",
     ["T051"], "crates/http-api/tests/contract_tests.rs (commands)"),
    ("H06", "POST /api/agents/:paneId/stop",
     "200 StopAgentResponse (sent|not-running); 404 no agent; 502 snapshot/decode/key-send failure.",
     ["T051"], "crates/http-api/tests/contract_tests.rs (commands)"),
    ("H07", "POST /api/workspaces/:workspaceId/agents",
     "201 LaunchAgentResponse; 409 TrustRequiredResponse; 400 invalid body/unavailable kind; 503 installed-kind discovery failed; 502 validation/tab/launch; 500 unreadable; C07 validate-before-tab, deadline, owned cleanup.",
     ["T051"], "crates/http-api/tests/contract_tests.rs (launch)"),
    ("H08", "GET /api/agents/kinds",
     "200 InstalledKindsResponse; 502 integration lookup/decode failure; C16 one measured launchable/readable policy.",
     ["T052"], "crates/http-api/tests/contract_tests.rs"),
    ("H09", "GET /api/agents/:kind/models",
     "200 ModelCatalogResponse incl. unsupported kind + unavailable catalog as values; no separate non-200 catalog branch.",
     ["T052"], "crates/http-api/tests/contract_tests.rs"),
    ("H10", "POST /api/agents/:paneId/answer",
     "200 QuestionAnsweredResponse incl. refusee value; 400 body shape; 502 Herdr failure; 500 unreadable result; C03/C17 no invented acceptance proof.",
     ["T051"], "crates/http-api/tests/contract_tests.rs (interactive)"),
    ("H11", "POST /api/agents/:paneId/focus",
     "200 AgentFocusedResponse with focused:false on Herdr failure; body ignored after guard.",
     ["T051"], "crates/http-api/tests/contract_tests.rs (commands)"),
    ("H12", "POST /api/agents/:paneId/trust",
     "200 TrustResolvedResponse with complete state field (C03 fixes current 500-on-service-outcome); 400 invalid body; 502 Herdr failure.",
     ["T051"], "crates/http-api/tests/contract_tests.rs (interactive)"),
    ("H13", "POST /api/log",
     "200 {ok:true}; 400 {ok:false} malformed log body; diagnostic sink wired (T055).",
     ["T052"], "crates/http-api/tests/contract_tests.rs"),
    ("H14", "GET /api/events",
     "200 text/event-stream; Last-Event-ID; 503 {error} when 8 streams open; ready/resync + 5 journal kinds + session_changed (T053/C11/C26).",
     ["T053"], "crates/http-api/tests/contract_tests.rs (SSE)"),
    ("H15", "GET /api/notifications/vapid-key",
     "200 plain-text base64url key no-store; 503 plain text service absent; 500 JSON {error} setup failure.",
     ["T052"], "crates/http-api/tests/contract_tests.rs"),
    ("H16", "POST /api/notifications/subscriptions",
     "204 empty no-store; 400 invalid subscription; 503 JSON {error} service absent; 500 JSON {error} read/write/key failure; unsubscribe takes precedence.",
     ["T052"], "crates/http-api/tests/contract_tests.rs"),
    ("H17", "GET /api/file",
     "200 binary/text with type,length,disposition,no-store; 403 {error} missing param/rejected file/failed lookup; 500 unreadable internal result; 12 MiB cap.",
     ["T052"], "crates/http-api/tests/contract_tests.rs (files)"),
    ("H18", "GET /api/images",
     "200 RecentImagesResponse; 502 {error} snapshot/scan failure.",
     ["T052"], "crates/http-api/tests/contract_tests.rs"),

    ("D01", "Read Herdr snapshot",
     "Snapshot nested under result.snapshot; agents, workspace metadata, optional panes/tabs/layouts.",
     ["T005", "T023", "T038", "T039"], "crates/application/tests + crates/domene→domain/tests"),
    ("D02", "Compose workspace view",
     "Worktree checkout wins over pane cwd match; project counts/focus/status preserved, even without agents.",
     ["T005", "T023", "T039"], "crates/application/tests (overview)"),
    ("D03", "Compose agent view",
     "Agent type/title/status/cwd/focus; session kind/ID/header cwd/parent session; tri-state cwd match (null distinct from false).",
     ["T005", "T039"], "crates/application/tests (overview)"),
    ("D04", "Human naming and pane ranks",
     "Numeric default labels suppressed; rank rect y,x,paneId; missing rect unranked; multi-pane label name+rank non-repeating; single pane omits rank; same policy for notifications.",
     ["T005"], "crates/domain/tests (naming) + application tests"),
    ("D05", "Visibility rule",
     "Show if source path exists, working/blocked, multiple panes in tab, or readable family; withoutSession counts filtered agents, not every missing file.",
     ["T039"], "crates/application/tests (conversations/overview)"),
    ("D06", "Supported session families",
     "Pi, Codex, Claude Code, opencode, Devin readable; installed ≠ readable; Cursor catalog support ≠ Cursor session reader.",
     ["T011", "T014", "T015", "T017", "T023", "T024"], "crates/sessions/tests (registry)"),
    ("D07", "Source reference resolution",
     "path uses advertised file; Codex/Claude IDs search JSONL filenames; opencode/Devin IDs select read-only SQLite stores; empty IDs refused.",
     ["T023"], "crates/sessions/tests/integration (discovery)"),
    ("D08", "Codex missing-reference fallback",
     "Title 'name | cwd-basename'; versioned state_*.sqlite threads by exact name+cwd, unarchived, latest update; rollout file must exist; C15 numeric version order.",
     ["T023"], "crates/sessions/tests/integration (discovery)"),
    ("D09", "Header reads",
     "Bounded 64 KiB first line; cwd/id/parentSession/version; version fallback 1; header failure currently ignored by enrichment (documented).",
     ["T014", "T026"], "crates/sessions/tests/unit (jsonl) + metadata"),
    ("D10", "JSONL reading",
     "Header, full/forward/tail/backward, file-size identity, partial trailing records, unknown entries preserved; never write source files; C02 offset convention.",
     ["T014"], "crates/sessions/tests/unit (jsonl) + property_tests"),
    ("D11", "Pi compatibility",
     "Original JSONL retained; 8 message roles; settings/usage/context/compaction/custom entries; parentId = conversation ancestry, parentSession = session lineage.",
     ["T018"], "crates/sessions/tests/contracts (agent_matrix: pi)"),
    ("D12", "Codex normalization",
     "response_item messages/function/custom tools/results/redacted reasoning; event_msg.item_completed kinds; command outcome/diff; settings turn_context/thread_settings_applied; long prompts preserved; encrypted reasoning never invented.",
     ["T019"], "crates/sessions/tests/contracts (agent_matrix: codex)"),
    ("D13", "Codex context filtering",
     "Exclude developer/system prose and user content entirely made of injected AGENTS.md/INSTRUCTIONS/environment context; no size heuristic.",
     ["T019"], "crates/sessions/tests/contracts (agent_matrix: codex)"),
    ("D14", "Claude normalization",
     "user/assistant lines; text and tool_use/tool_result incl. error; model from message; slash-command XML decoded; app notices/interrupt/compaction/system wrappers excluded; refused lines stripped before raw fallback.",
     ["T020"], "crates/sessions/tests/contracts (agent_matrix: claude)"),
    ("D15", "opencode normalization",
     "user text; assistant text, clear reasoning, tool calls/results/error/images, data-URI images; model.id/providerID/variant; default variant omitted; unsupported row types remain raw.",
     ["T021"], "crates/sessions/tests/contracts (agent_matrix: opencode)"),
    ("D16", "Devin normalization",
     "user/assistant text and clear thinking; metadata.created_at/generation_model; system excluded; OpenAI-like tool conversion guarded — real tool-call shape unmeasured and stays marked unverified.",
     ["T022"], "crates/sessions/tests/contracts (agent_matrix: devin)"),
    ("D17", "SQLite paging",
     "opencode session_v2/session_message by seq; Devin sessions/message_nodes by row_id; latest ascending after reverse; inclusive boundary replay; backward cursor; read-only queries; 3 s busy timeout.",
     ["T015", "T021", "T022"], "crates/sessions/tests/unit (sqlite)"),
    ("D18", "Conversation summary",
     "One row per visible agent pane; last user text, assistant text or last tool+argument preview; known timestamp; model/provider/thinking; branch; source availability/cause; optional question/trust/waiting.",
     ["T026", "T027", "T039"], "crates/application/tests + sessions metadata"),
    ("D19", "Summary cache",
     "File identity+size/offset+pending; 256 entries oldest eviction; 64 KiB tail; up to 32 older windows (~2 MiB); incremental update preserves prior metadata unless replaced.",
     ["T026"], "crates/sessions/tests (metadata reducer)"),
    ("D20", "Summary isolation",
     "Four concurrent session reads; one bad session keeps other lines; snapshot failure = aggregate failure; question-screen enrichment measured per line.",
     ["T027", "T039"], "crates/application/tests"),
    ("D21", "Git branch metadata",
     "git -C <cwd> rev-parse --abbrev-ref HEAD; 3 s timeout; 30 s cache; detached/empty/missing git/error = absent branch; one job per cwd.",
     ["T040"], "crates/application/tests (git)"),
    ("D22", "Conservative metadata",
     "Placeholder models in angle brackets excluded; model/provider selected as pair; timestamps never fabricated; summaries are extracted data, no LLM generation.",
     ["T026"], "crates/sessions/tests/contracts (normalization) "),

    ("A01", "Submit prompt",
     "Read current status; ordinary path agent.prompt; blocked path literal text then Enter; specific interactive-input refusal triggers same fallback; never on timeout/unknown state.",
     ["T035"], "crates/application/tests (prompt)"),
    ("A02", "Local duplicate suppression",
     "SHA256(target + NUL + text)[:32hex]; 60 s window; correction C06: last-confirmed per-pane semantics, concurrency serialized; A→B→A allowed; unknown/unconfirmed never suppresses.",
     ["T035"], "crates/application/tests (prompt dedup)"),
    ("A03", "Action uncertainty treatment",
     "Ordinary protocol success confirmed only when discriminator matches (C05); literal-input path unknown; transport failures classified timeout/refusal/unknown.",
     ["T035", "T013"], "crates/herdr-client/tests + application tests"),
    ("A04", "Stop working agent",
     "Fresh snapshot; absent → 404; nonworking no-op; working sends Ctrl+C via Herdr; interrupt-sent is not termination proof.",
     ["T036"], "crates/application/tests (stop)"),
    ("A05", "Focus/acknowledgement",
     "agent.focus real desktop effect; focused boolean, failure as 200 value; logged explicitly.",
     ["T036"], "crates/application/tests (focus)"),
    ("A06", "Installed integrations",
     "integration.list; mapping command vs target; readable-family filter; launch excludes state not_installed.",
     ["T013", "T031"], "crates/herdr-client/tests + application"),
    ("A07", "Explicit agent launch",
     "Workspace validation/cwd; unique generated <label>-1..99 name or provided; new unfocused tab; root pane; start agent with model args; no automatic second agent.",
     ["T037"], "crates/application/tests (launch)"),
    ("A08", "Shell readiness and launch failure",
     "Retry only explicit 'not an available shell' refusal; 3 s spacing ×10; 120 s upstream detection; start deadline 125 s; overall 160 s; close only owned tab on validation failure; blocked pane retained for trust; C07.",
     ["T037"], "crates/application/tests (launch)"),
    ("A09", "Trust detection / response",
     "Actual screen marker required; kind-specific keys (Codex accept [1,enter]/deny [2]; Claude accept [down,enter]/deny [enter]); no fallback for unknown kind.",
     ["T032", "T033"], "crates/interactions/tests"),
    ("A10", "Trust verification",
     "Read before; send keys; verify agent existence; reread; disappeared/persistent prompt ⇒ transmise; refusal may quit agent; no config editing.",
     ["T033"], "crates/interactions/tests"),
    ("A11", "Question parser",
     "Last coherent numbered list from 1, ≥2 choices; selected › marker; same-line/two-space/indented detail; gutters stripped; context + Enter/arrow help parsed.",
     ["T032"], "crates/interactions/tests (recognition)"),
    ("A12", "Answer question",
     "Fresh visible screen; offered integer choice only; number+Enter; optional trimmed free text+Enter; reread distinguishes remaining/disappearing; unreadable question → refusee value.",
     ["T033"], "crates/interactions/tests (planning/verification)"),
    ("A13", "Model catalog lookup",
     "Five adapters; successful-result 60 s cache + in-flight reuse; provenance + explicit unavailable reason; no catalog from installed family.",
     ["T028", "T029", "T031"], "crates/catalog/tests"),
    ("A14", "Launch model/level args",
     "Pi --model/--thinking; Claude --model/--effort (effort-only allowed); Codex -m/--config model_reasoning_effort; Cursor --model (thinking rejected); others reject overrides.",
     ["T029", "T030"], "crates/catalog/tests (args)"),
    ("A15", "Model-level validation",
     "Validate declared levels only when model+thinking supplied; absent model/catalog levels do not establish unsupported; absent requested model = no invented default.",
     ["T030"], "crates/catalog/tests (args)"),

    ("E01", "Polling state watcher",
     "2 s after completed iteration; cached agents/last-success/error count; failures keep loop running.",
     ["T041"], "crates/application/tests (watcher, fake clock)"),
    ("E02", "State diff",
     "Signature status/title/cwd/type/sessionPath; appeared/status/disappeared; metadata changes may emit status same from/to.",
     ["T041"], "crates/application/tests (watcher)"),
    ("E03", "Initial observation",
     "Suppress appeared while previous map empty; disappearance retains last identity for notification.",
     ["T041"], "crates/application/tests (watcher)"),
    ("E04", "Event journal",
     "Memory only; monotonic IDs from 1; capacity 500; oldest evicted; restart loses journal; C11 adds byte cap + heartbeat.",
     ["T042"], "crates/application/tests (journal)"),
    ("E05", "SSE catch-up",
     "Last-Event-ID replay; unknown/future/legacy → resync at current boundary; max 8 streams; C11 epoch IDs.",
     ["T043", "T053"], "crates/application/tests + http-api SSE tests"),
    ("E06", "Push trigger",
     "working→any other status; working/blocked→gone; idle/done disappearance ignored; watcher failure ≠ mass disappearance.",
     ["T041"], "crates/application/tests (watcher)"),
    ("E07", "Push wording and deep links",
     "'Agent needs you' / 'Agent finished' / 'Agent stopped'; grounded identity; waiting/done/gone tags; /#/agent/<encoded paneId>.",
     ["T045"], "crates/notifications/tests (payload)"),
    ("E08", "Subscription lifecycle",
     "Endpoint-keyed upsert; remove endpoint; persistent VAPID key generation or env override; serialized store ops; C14 atomic store.",
     ["T044"], "crates/notifications/tests (store/vapid)"),
    ("E09", "Delivery",
     "Encrypted Web Push; TTL 60 s; 404/410 prune expired; other failures logged; push failure never fails watcher.",
     ["T045"], "crates/notifications/tests (delivery)"),
    ("E10", "Legacy-store migration",
     "On startup copy old cwd .herdr-remote/push.json incl. keys when old has subscriptions and destination absent/empty; never overwrite populated destination.",
     ["T044"], "crates/notifications/tests (store)"),

    ("S01", "Personal tailnet trust boundary",
     "No app auth/cookies/per-device permissions; network ACLs/Serve remain the access boundary.",
     ["T048", "T049"], "crates/herdrchat/tests + http-api origin tests"),
    ("S02", "Mutation origin policy",
     "Exact configured origins + loopback localhost/127.0.0.1/::1 any port; missing Origin rejected; no general CORS middleware.",
     ["T049"], "crates/http-api/tests (origin matrix)"),
    ("S03", "Body guards",
     "JSON Content-Type; declared Content-Length >64 KiB rejected pre-parse (kept) AND streamed byte limit enforced (C09); prompt ≤32 KiB UTF-8.",
     ["T049"], "crates/http-api/tests (body limits)"),
    ("S04", "Session confinement",
     "Canonical configured roots; path segment checks; symlink escape rejection; missing root/file vs outside-root/link distinguished; C13 descriptor-based confinement.",
     ["T011", "T014", "T015"], "crates/files/tests (confined) + sessions path_policy"),
    ("S05", "File roots",
     "Project roots from fresh Herdr snapshot + configured extra roots per request; no implicit Desktop/Downloads/Pictures.",
     ["T046"], "crates/files/tests + application authorization"),
    ("S06", "File descriptor checks",
     "Canonicalize roots/target; open resolved; fstat regular+size; read same descriptor; close; 12 MiB max; C13 revalidation.",
     ["T046"], "crates/files/tests (authorized_file)"),
    ("S07", "Inline/download policy",
     "Inline .avif .gif .jpeg .jpg .png .webp .pdf; text/plain for .txt .log .json .jsonl .md .diff .patch; others octet-stream attachment; SVG never inline.",
     ["T046"], "crates/files/tests (mime)"),
    ("S08", "Recent-image discovery",
     "png/jpg/jpeg/gif/webp/avif; recursive depth 3; cap 400 collected; 120 per directory; 4 roots concurrently; most-recent first; return 60; C13 global budget ownership.",
     ["T047"], "crates/files/tests (scan)"),
    ("S09", "Scan exclusions/degradation",
     "Dot entries and dependency/build dirs skipped; unreadable/disappeared ignored; stat follows links; partial scan normal without completeness field.",
     ["T047"], "crates/files/tests (scan)"),
    ("S10", "Error response contract",
     "Named cause/hint; structured response validation before emission; outgoing ≥400 logged; C04 removes error swallows.",
     ["T010", "T055"], "crates/domain/tests + http-api error tests"),
    ("S11", "Log format",
     "ISO time [LEVEL] [source] message + optional JSON detail truncated 2000 chars; server/client origins; file path injectable.",
     ["T055"], "crates/herdrchat/tests (logging)"),
    ("S12", "Log bounds",
     "Rotate >4 MiB current to .1; suppress repeats key path/source/level/message in rolling 60 s; repeat counter made truthful (was promised, not emitted); sink failure surfaces to stderr.",
     ["T055"], "crates/herdrchat/tests (logging)"),
    ("S13", "Display error sanitization",
     "Human detail preferred; replace pane/tab IDs in suitable strings; fallback serialization ≤300 chars.",
     ["T010"], "crates/domain/tests (errors) + http-api"),
    ("S14", "Read-only upstream data",
     "No prompt experiments on user agents; fake socket transport/temp stores only; service mutations only from explicit product actions.",
     ["T003", "T004", "T006", "T064"], "crates/test-support/tests + xtask layout gate"),
]

# ---------------------------------------------------------------------------
# Corrections C01–C27 (TECH §10). (id, label, current, proposed, tasks)
# ---------------------------------------------------------------------------
CORRECTIONS = [
    ("C01", "Single contract authority", "Shared api.ts authority",
     "Rust DTO/registry authority; generated TS types/validators", ["T007", "T008", "T009", "T057", "T068"]),
    ("C02", "Partial-line/offset convention", "Partial JSONL bytes double-counted in summary cache",
     "Single byte-position convention", ["T014", "T025", "T026", "T027"]),
    ("C03", "Trust response complete", "State discarded; response fails contract (500 on service outcome)",
     "Return complete TrustResolvedResponse", ["T033", "T051"]),
    ("C04", "Read errors not swallowed", "Some incremental errors replaced by empty success; SQLite exceptions may escape",
     "Preserve typed failure/cause/status", ["T010", "T050"]),
    ("C05", "Prompt success proof", "Success record confirmed without discriminator check",
     "Validate expected success evidence before confirmed", ["T013", "T035", "T051"]),
    ("C06", "Per-pane dedup atomic", "Any recent identical text; unknown path recorded; concurrent race",
     "Last-confirmed per-pane dedup + serialized admission", ["T034", "T035"]),
    ("C07", "Launch validation order", "Tab created before args validation; 15 s socket vs 120 s detection",
     "Validate first; reserve names; method deadline; cleanup owned only", ["T030", "T037", "T051"]),
    ("C08", "Methods and unknown /api", "Read routes accept unintended methods; unknown API path returns HTML",
     "GET/HEAD read policy; POST commands; 405+Allow; JSON404", ["T049", "T054"]),
    ("C09", "Real body size", "Content-Length-only guard",
     "Enforce actual 64 KiB during streamed read", ["T049"]),
    ("C10", "Bind/origin/port strictness", "Prefix-only tailnet check; parseInt permissive ports",
     "Parsed tailnet ranges + strict port decimal", ["T048"]),
    ("C11", "SSE cancellation/replay", "Idle canceled loop persists; no heartbeat; journal restart ambiguity",
     "Owned cancellation, heartbeats, epoch IDs/resync", ["T042", "T043", "T053"]),
    ("C12", "Cursor bound to source", "SQLite cursors can refer to another source",
     "Source-bound versioned cursor; legacy reset/409 rules", ["T024", "T025", "T050"]),
    ("C13", "Confined paths/descriptors/scan", "Path races; scanning can list outside roots",
     "Descriptor-based confinement + bounded scan", ["T011", "T046", "T047"]),
    ("C14", "Push store atomic", "Direct rewrite; network sends hold serialized access",
     "Atomic compatible store; independent bounded delivery", ["T044", "T045"]),
    ("C15", "Codex numeric versions", "DB versions ordered lexically; fallback evidence in comments",
     "Numeric order; exact name/cwd/file existence checks; source generation", ["T023"]),
    ("C16", "Integration policy consistent", "List/launch filters disagree",
     "One measured launchable/readable policy", ["T031", "T037"]),
    ("C17", "Question/trust uncertainty", "Disappearance can be overinterpreted",
     "Retain uncertainty until agent/prompt evidence suffices", ["T032", "T033", "T034"]),
    ("C18", "Bounded forward + caughtUp", "Forward allocates entire remainder; hasMore overloaded for SQLite",
     "Optional caughtUp; bounded serialized pages; watermark; oversized-record failure", ["T025", "T050", "T057", "T059"]),
    ("C19", "UI target isolation", "Pending/failed message state crosses panes; retry targets current pane",
     "Per-pane+session state; immutable action destination", ["T058"]),
    ("C20", "Stale async UI guard", "Late session response can overwrite another pane or newer refresh",
     "Abort/generation guards; source identity ownership", ["T058", "T059"]),
    ("C21", "Deferred PWA update", "Controllerchange reload loses drafts/action state",
     "Deferred activation at safe boundary; explicit update action", ["T060"]),
    ("C22", "Markdown/status correctness", "Tables empty; nested lists flattened; blocked says working; idle implies finished",
     "Shape-correct renderer; exhaustive truthful status labels", ["T061"]),
    ("C23", "Refresh dedup/isolation", "Duplicate refreshes; all-or-nothing Promise.all",
     "Shared in-flight reads; generation; independent failures", ["T038", "T039", "T059"]),
    ("C24", "Desktop focus on read", "Reading/status change automatically changes real desktop focus",
     "Explicit UI action only; endpoint preserved", ["T036", "T062"]),
    ("C25", "Sheet accessibility", "aria-modal sheet leaves background interactive",
     "Background inertness + keyboard/pointer/focus restoration", ["T062", "T067"]),
    ("C26", "Chat invalidation + recovery", "Chat polls every 400 ms per client",
     "Shared leased observations; session_changed; visible/hidden recovery", ["T027", "T053", "T057", "T059"]),
    ("C27", "Typing work isolation", "Typing recalculates whole history metadata/items",
     "Isolated composer; stable derived values/scroll anchor", ["T063", "T065"]),
]

# ---------------------------------------------------------------------------
# Known implementation facts (historical inventory) whose corrected form the
# migration must implement (they stay recorded here, never erased).
# ---------------------------------------------------------------------------
KNOWN_DEFECTS = [
    {"capability": "D08", "fact": "Codex fallback state DBs sorted reverse-lexically while comments claim highest version first",
     "correction": "C15"},
    {"capability": "D08", "fact": "Unresolvable published slot falls through to title fallback without evidence trail",
     "correction": "C15"},
    {"capability": "A02", "fact": "Dedup matches any retained fingerprint inside the window (A→B→A suppressed), comment says consecutive",
     "correction": "C06"},
    {"capability": "A02", "fact": "Concurrent check/send/update not atomic; unknown transport reported as sent",
     "correction": "C06"},
    {"capability": "A03", "fact": "agent_prompted discriminator not checked: success record confirms without evidence",
     "correction": "C05"},
    {"capability": "H12", "fact": "Trust service state omitted from response; contract failure turns service outcomes into 500",
     "correction": "C03"},
    {"capability": "H07", "fact": "Args validated after tab creation; LaunchFailed phase/pane flattened into error string",
     "correction": "C07"},
    {"capability": "A07", "fact": "Generated-name fallback after 99 tries can return a taken -1 name",
     "correction": "C07"},
    {"capability": "A06", "fact": "'available' decoded but never used; list endpoint does not mirror launch state filter",
     "correction": "C16"},
    {"capability": "H04", "fact": "SQLite cursor identifies neither database, agent nor session; never reports rotation reset",
     "correction": "C12"},
    {"capability": "D10", "fact": "Partial trailing bytes double-counted in summary cache identity",
     "correction": "C02"},
    {"capability": "E04", "fact": "Resync construction may replay retained events in the same iteration; future cursor after restart not a discontinuity",
     "correction": "C11"},
    {"capability": "E05", "fact": "Idle canceled SSE loop stays alive; stream count freed but loop persists",
     "correction": "C11"},
    {"capability": "S12", "fact": "Repeat suppression advertises counts it never emits",
     "correction": "S12 corrected expectation (truthful counters)"},
    {"capability": "S03", "fact": "Only declared Content-Length enforced; streamed chunked bodies unlimited",
     "correction": "C09"},
    {"capability": "S08", "fact": "Shared 400-array across concurrent collectors; per-directory counter per walk invocation, no atomic budget",
     "correction": "C13"},
    {"capability": "S06", "fact": "Canonicalize-then-open is not descriptor-relative; concurrent symlink swap unguarded",
     "correction": "C13"},
    {"capability": "S10", "fact": "Some handlers collapse detailed causes; incremental read errors can become empty success",
     "correction": "C04"},
    {"capability": "O02", "fact": "Tailnet check accepts '100.'/'fd7a:' string prefixes instead of parsed ranges",
     "correction": "C10"},
    {"capability": "E07", "fact": "Notification text generation has no unmeasured fallback; identity may be lost on push race",
     "correction": "C14"},
    {"capability": "D19", "fact": "Summary timestamps numeric milliseconds; message timestamps may be source ISO strings",
     "correction": "kept as compatibility note (no change)"},
    {"capability": "A14", "fact": "provider accepted in LaunchAgentRequest but never consumed — must remain explicitly not applied",
     "correction": "no change (explicit non-application)"},
]

# ---------------------------------------------------------------------------
# Env keys (17) from CURRENT §8: (key, default, consumer)
# ---------------------------------------------------------------------------
ENV_KEYS = [
    ("HERDR_SOCKET_PATH", "~/.config/herdr/herdr.sock", "Control socket; HERDR_SOCKET deliberately unused"),
    ("HERDR_REMOTE_BIND", "127.0.0.1", "Backend bind; legacy prefix check replaced by parsed ranges (C10)"),
    ("HERDR_REMOTE_PORT", "8791", "Backend port; strict parse replaced parseInt (C10)"),
    ("HERDR_REMOTE_PUBLIC_ORIGINS", "comma-separated, preferred over singular", "Mutation origins / VAPID subject fallback"),
    ("HERDR_REMOTE_PUBLIC_ORIGIN", "legacy fallback if plural unset", "Explicit origins only"),
    ("HERDR_REMOTE_FILES_ROOTS", "empty", "Colon-separated existing paths; extra file/image roots"),
    ("PI_SESSIONS_ROOT", "~/.pi/agent/sessions", "Pi JSONL root"),
    ("CODEX_SESSION_ROOT", "~/.codex/sessions", "Codex JSONL root/search"),
    ("CLAUDE_PROJECTS_ROOT", "~/.claude/projects", "Claude JSONL root/search"),
    ("CODEX_HOME", "~/.codex", "Codex state DB fallback; independent of CODEX_SESSION_ROOT"),
    ("OPENCODE_DB", "~/.local/share/opencode/opencode.db", "opencode source DB"),
    ("DEVIN_DB", "~/.local/share/devin/cli/sessions.db", "Devin source DB"),
    ("HERDR_REMOTE_LOG_PATH", "~/.herdr-remote/herdr-remote.log", "Application journal"),
    ("HERDR_REMOTE_PUSH_STORE", "~/.herdr-remote/push.json", "Keys/subscriptions; independent of log path"),
    ("HERDR_REMOTE_VAPID_SUBJECT", "HTTPS origin, then mailto fallback", "Push claims"),
    ("HERDR_REMOTE_VAPID_PUBLIC_KEY", "persisted/generated when pair absent", "Public half; both overrides required together"),
    ("HERDR_PRIVATE_KEY_PLACEHOLDER", "", "__REMOVE__"),
]
ENV_KEYS[16] = ("HERDR_REMOTE_VAPID_PRIVATE_KEY", "persisted/generated when pair absent", "Private half; partial override is an error")

# ---------------------------------------------------------------------------
# Resource budget table (CURRENT §8): fixed reference values T065 checks.
# ---------------------------------------------------------------------------
BUDGETS = [
    {"name": "json_request_body", "value": "64 KiB declared + streamed enforced (C09)"},
    {"name": "prompt_utf8", "value": "32 KiB"},
    {"name": "jsonl_initial_window", "value": "512 KiB"},
    {"name": "jsonl_delta", "value": "entire remainder today; bounded 2 MiB target / 16 MiB max + caughtUp from T025 (C18)"},
    {"name": "summary_tail", "value": "64 KiB"},
    {"name": "metadata_search_windows", "value": "32"},
    {"name": "summary_cache_entries", "value": "256"},
    {"name": "header_read", "value": "64 KiB"},
    {"name": "sqlite_chat_window", "value": "400 rows"},
    {"name": "sqlite_list_window", "value": "200 rows"},
    {"name": "sqlite_busy_timeout_ms", "value": "3000"},
    {"name": "concurrent_session_reads", "value": "4 per request"},
    {"name": "herdr_transport_timeout_s", "value": "15"},
    {"name": "watcher_interval_s", "value": "2"},
    {"name": "overview_cache_freshness_s", "value": "15 and nonempty cache"},
    {"name": "sse_streams", "value": "8"},
    {"name": "sse_journal_events", "value": "500"},
    {"name": "sse_scan_cadence_ms", "value": "300"},
    {"name": "prompt_duplicate_window_s", "value": "60"},
    {"name": "catalog_timeout_s", "value": "20"},
    {"name": "catalog_stdout_bytes", "value": "2 MiB"},
    {"name": "catalog_stderr_bytes", "value": "64 KiB"},
    {"name": "catalog_cache_ms", "value": "60000"},
    {"name": "branch_timeout_s", "value": "3"},
    {"name": "branch_cache_s", "value": "30"},
    {"name": "branch_text_cap_chars", "value": "4096"},
    {"name": "launch_shell_retries", "value": "10 × 3 s; detection 120 s; start deadline 125 s; launch overall 160 s"},
    {"name": "image_depth", "value": "3"},
    {"name": "image_collect_cap", "value": "400 (global from C13)"},
    {"name": "image_return_cap", "value": "60"},
    {"name": "push_ttl_s", "value": "60"},
    {"name": "log_rotate_bytes", "value": "4 MiB → .1, 1 retained generation, repeat window 60 s"},
    {"name": "file_max_bytes", "value": "12 MiB"},
]

# Task → primary test target for coverage.json
TASK_TARGETS = {
    "T003": "crates/xtask/tests/verify_layout_tests.rs",
    "T004": "apps/*/tests + packages/shared/tests (TS moves) + xtask verify-layout",
    "T005": "crates/domain/tests/",
    "T006": "crates/test-support/tests/",
    "T007": "crates/contracts/tests/contract_tests.rs",
    "T008": "crates/contracts/tests/contract_tests.rs (registry)",
    "T009": "crates/xtask/tests/contract_export_tests.rs",
    "T010": "crates/domain/tests/ + crates/http-api/tests/",
    "T011": "crates/files/tests/ + crates/sessions/tests/unit/",
    "T012": "crates/herdr-client/tests/contract_tests.rs",
    "T013": "crates/herdr-client/tests/unit_tests.rs",
    "T014": "crates/sessions/tests/unit_tests.rs (jsonl) + property_tests.rs",
    "T015": "crates/sessions/tests/unit_tests.rs (sqlite)",
    "T016": "crates/sessions/tests/unit_tests.rs (openai_arguments/_chat/_responses)",
    "T017": "crates/sessions/tests/integration_tests.rs (pipeline)",
    "T018": "crates/sessions/tests/contract_tests.rs (agent_matrix: pi)",
    "T019": "crates/sessions/tests/contract_tests.rs (agent_matrix: codex)",
    "T020": "crates/sessions/tests/contract_tests.rs (agent_matrix: claude)",
    "T021": "crates/sessions/tests/contract_tests.rs (agent_matrix: opencode)",
    "T022": "crates/sessions/tests/contract_tests.rs (agent_matrix: devin)",
    "T023": "crates/sessions/tests/integration_tests.rs (discovery)",
    "T024": "crates/sessions/tests/integration_tests.rs (cursors)",
    "T025": "crates/sessions/tests/ + crates/http-api/tests/",
    "T026": "crates/sessions/tests/contract_tests.rs (normalization/metadata)",
    "T027": "crates/sessions/tests/integration_tests.rs (index)",
    "T028": "crates/catalog/tests/unit_tests.rs",
    "T029": "crates/catalog/tests/unit_tests.rs (adapters)",
    "T030": "crates/catalog/tests/unit_tests.rs (args)",
    "T031": "crates/catalog/tests/integration_tests.rs (cache) + application",
    "T032": "crates/interactions/tests/unit_tests.rs",
    "T033": "crates/interactions/tests/contract_tests.rs + integration_tests.rs",
    "T034": "crates/application/tests/unit_tests.rs (admission)",
    "T035": "crates/application/tests/integration_tests.rs (prompt)",
    "T036": "crates/application/tests/integration_tests.rs (stop/focus)",
    "T037": "crates/application/tests/integration_tests.rs (launch)",
    "T038": "crates/application/tests/integration_tests.rs (state/refresh)",
    "T039": "crates/application/tests/contract_tests.rs (overview/conversations)",
    "T040": "crates/application/tests/unit_tests.rs (git)",
    "T041": "crates/application/tests/unit_tests.rs (watcher, fake clock)",
    "T042": "crates/application/tests/unit_tests.rs (journal)",
    "T043": "crates/application/tests/integration_tests.rs (subscription)",
    "T044": "crates/notifications/tests/unit_tests.rs + files atomic tests",
    "T045": "crates/notifications/tests/integration_tests.rs (delivery)",
    "T046": "crates/files/tests/unit_tests.rs (authorized_file/mime)",
    "T047": "crates/files/tests/property_tests.rs (scan)",
    "T048": "crates/herdrchat/tests/unit_tests.rs (config)",
    "T049": "crates/http-api/tests/contract_tests.rs (guards)",
    "T050": "crates/http-api/tests/contract_tests.rs (sessions/health/overview)",
    "T051": "crates/http-api/tests/contract_tests.rs (commands)",
    "T052": "crates/http-api/tests/contract_tests.rs (catalog/files/push/log)",
    "T053": "crates/http-api/tests/fragmentSSE → contract_tests.rs (SSE)",
    "T054": "crates/herdrchat/tests/ + crates/http-api/tests/ (assets)",
    "T055": "crates/herdrchat/tests/unit_tests.rs (logging) + application diagnostics",
    "T056": "crates/herdrchat/tests/integration_tests.rs (composition/shutdown)",
    "T057": "packages/shared/tests + apps/web/tests (generated facade) + contract corpus",
    "T058": "apps/web/tests (conversation store)",
    "T059": "apps/web/tests (data client)",
    "T060": "apps/web/tests (PWA update)",
    "T061": "apps/web/tests (markdown/status labels)",
    "T062": "apps/web/tests (focus/a11y)",
    "T063": "apps/web/tests (composer isolation)",
    "T064": "compatibility/coverage.json diff + crates coverage matrix",
    "T065": "compatibility/benchmark/ + compatibility/results/",
    "T066": "crates/xtask/tests/ (release assembly) + CI runners",
    "T067": "apps/web/tests/daemon_fixture + captures",
    "T068": "apps/server + bin retirement checks",
    "T069": "xtask verify + EXECUTION.md",
    "T070": "specs review bundle (docs only)",
}

CAPS_TASKS = {}
for cid, _t, _e, tasks, _target in CAPS:
    CAPS_TASKS[cid] = tasks

# ---------------------------------------------------------------------------
# Parse CONTRACTS.md → declarations + inline schemas
# ---------------------------------------------------------------------------
def parse_contracts():
    md = (SPEC / "CONTRACTS.md").read_text()
    cur = None
    decls, inlines = [], []
    for line in md.splitlines():
        if line.startswith("## "):
            cur = line[3:].strip()
        elif line.startswith("### "):
            name = line[4:].strip()
            (inlines if name.startswith("Inline schema") else decls).append(
                {"module": cur, "name": name})
    return decls, inlines

# ---------------------------------------------------------------------------
# Parse SOURCE-MAP.md → 48 modules with owner + symbols
# ---------------------------------------------------------------------------
def parse_source_map():
    rows = []
    for line in (SPEC / "SOURCE-MAP.md").read_text().splitlines():
        m = re.match(r"^\| \[(.+?)\]\([^)]*\) \|(.*)\|$", line)
        if not m:
            continue
        link_text, rest = m.group(1), m.group(2)
        path = link_text
        cells = [c.strip() for c in rest.split("|") if c.strip()]
        symbols = [s.strip() for s in cells[1].split(",")]
        rows.append({"module": link_text, "path": path, "proposedOwner": cells[0], "symbols": symbols})
    return rows


def main():
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    decls, inlines = parse_contracts()
    modules = parse_source_map()
    assert len(modules) == 48, f"source modules: {len(modules)}"
    assert len(decls) == 171, f"declarations: {len(decls)}"
    assert len(inlines) == 11, f"inline schemas: {len(inlines)}"

    capabilities = []
    for cid, title, expectation, tasks, target in CAPS:
        capabilities.append({
            "id": cid,
            "title": title,
            "expectation": expectation,
            "tasks": tasks,
            "futureTestTarget": target,
            "status": "pending",
        })
    assert len(capabilities) == 89, len(capabilities)

    routes = [c for c in capabilities if c["id"].startswith("H")]
    assert len(routes) == 18

    envs = [{"key": k, "default": d, "consumer": c} for k, d, c in ENV_KEYS]
    assert len(envs) == 17

    corrections = [
        {"id": cid, "label": lab, "currentBehavior": cur, "rustBehavior": prop,
         "tasks": tasks}
        for cid, lab, cur, prop, tasks in CORRECTIONS
    ]
    assert len(corrections) == 27

    baseline = {
        "schemaVersion": 1,
        "generatedAt": now,
        "historicalBaseline": {
            "commit": HISTORICAL_BASELINE,
            "note": "CURRENT.md/CONTRACTS.md/SOURCE-MAP.md remain frozen photographs of this commit.",
        },
        "executionBase": {
            "commit": EXECUTION_BASE,
            "extra": "BASELINE-DELTA.md: Codex title discovery (nomsDeSessionCodex) delivered at T023.",
        },
        "capabilities": capabilities,
        "routes": routes,
        "envKeys": envs,
        "declarations": decls,
        "inlineSchemas": inlines,
        "sourceModules": modules,
        "corrections": corrections,
        "knownDefects": KNOWN_DEFECTS,
        "budgets": BUDGETS,
        "wireFlavoredEnums": {
            "agentStatus": ["idle", "working", "blocked", "done", "unknown"],
            "readCause": ["absente", "vide", "invalide", "io"],
            "sessionState": ["available", "absent", "error"],
            "promptFailure": ["attente", "erreur", "inconnu"],
            "trustState": ["transmise", "acceptee", "refusee", "non-applicable"],
            "questionState": ["appliquee", "transmise", "refusee"],
        },
    }
    (OUT / "baseline.json").write_text(
        json.dumps(baseline, ensure_ascii=False, indent=2) + "\n")

    coverage = {
        "schemaVersion": 1,
        "generatedAt": now,
        "capabilities": [
            {"id": c["id"], "deliverTasks": c["tasks"],
             "proofTask": "T064", "target": c["futureTestTarget"],
             "status": c["status"]}
            for c in capabilities
        ],
        "corrections": [{"id": c["id"], "tasks": c["tasks"], "proofTask": "T064"}
                        for c in corrections],
        "historicalBaselineRef": HISTORICAL_BASELINE,
    }
    (OUT / "coverage.json").write_text(
        json.dumps(coverage, ensure_ascii=False, indent=2) + "\n")

    print(f"capabilities={len(capabilities)} routes={len(routes)} env={len(envs)} "
          f"decls={len(decls)} inline={len(inlines)} mods={len(modules)} "
          f"corrections={len(corrections)} defects={len(KNOWN_DEFECTS)} budgets={len(BUDGETS)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
