# Current backend: features and contracts

Baseline: commit `576bbf4902a00d3ef9702b4df315c943c7ac5680`. All source links in [SOURCE-MAP.md](SOURCE-MAP.md) and [CONTRACTS.md](CONTRACTS.md) are pinned to this commit. IDs below are migration traceability IDs, not claims that behavior has been newly tested against live agents.

## 1. Runtime and deployment

| ID | Current feature / behavior | Implementation |
|---|---|---|
| O01 | Single Bun HTTP process, Effect services/layers and scoped watcher; no application database or broker | `main.ts`, `config.ts` |
| O02 | Bind default `127.0.0.1:8791`; configurable tailnet bind; public/wildcard bind rejected | `config.ts` |
| O03 | Herdr Unix socket startup ping; unavailable Herdr produces warning but HTTP remains available | `main.ts` |
| O04 | Polling watcher starts with service; SIGINT/SIGTERM scope shutdown stops watcher and HTTP server | `main.ts`, `AgentWatcher.ts` |
| O05 | Compiled PWA served relative to server source location, independent of launcher working directory | `main.ts`, `bin/herdrchat` |
| O06 | Static traversal/symlink confinement; SPA index fallback; explicit JSON 503 if build is absent | `AssetGuard.ts`, `main.ts` |
| O07 | No-cache/no-store for index, worker scripts and manifest; API JSON no-store; normal assets use Bun file responses | `main.ts`, `Reply.ts` |
| O08 | `herdrchat` launcher checks Bun and source entry, then execs Bun; release tarball contains built PWA plus sources | `bin/herdrchat`, `.github/workflows/release.yml` |
| O09 | Homebrew service is the documented deployment; Tailscale Serve supplies remote HTTPS and tailnet access | `README.md`, `docs/PACKAGING.md` |
| O10 | Format, lint, typecheck, tests form `verify`; pre-commit and tag release invoke it; release publishes archive and SHA256 | scripts, hook and workflow |

No TLS server, account system, public deployment mode, background job service, or application-owned conversation database exists in this backend. Homebrew tap files live in a separate repository and were not inspected here; the in-repo launcher/workflow and documented service behavior are the packaging baseline.

## 2. HTTP surface: all 18 registered paths

> Démon Rust : 23 routes (H19–H23 ajoutées) et quelques statuts corrigés — voir [§9](#9-écarts-du-démon-rust-état-au-2026-10-29). Le tableau ci-dessous reste la photographie du fil TS.

`Api.ts` returns the authoritative route table. The table below gives intended methods. All eight mutation handlers explicitly reject non-POST methods with 405 and `Allow: POST`. The ten read handlers do not enforce GET themselves: Bun's route map binds them by path, without a method map. There is no public raw terminal, arbitrary shell, model-update, workspace-create, session-write, or agent-delete endpoint. Model/thinking changes during a session use the ordinary prompt pathway from the webapp.

All POST routes share these rejection branches: missing/foreign Origin **403**, non-JSON Content-Type **415**, declared Content-Length over 64 KiB **413**, wrong method **405**. Guard failures normally use `ApiErrorResponse`; the 405 body also has `{error}`. A serialization contract failure is **500** with `{error,hint}`. Other statuses are listed below.

| ID | Intended method and path | Input | Success / domain result | Other explicit responses |
|---|---|---|---|---|
| H01 | GET `/api/health` | none | 200 `HealthResponse` | 503 same schema with `ok:false`, `herdr.reachable:false`; 500 unreadable result |
| H02 | GET `/api/overview` | none | 200 `OverviewResponse` | 500 through generic `run` on Herdr/decoding failure |
| H03 | GET `/api/conversations` | none | 200 `ConversationsResponse` | 503 `{conversations:[]}` on snapshot failure; 502 same empty shape on unreadable snapshot |
| H04 | GET `/api/agents/:paneId/session` | `tail?`, `cursor?`, `before?` query | 200 `SessionResponse` | 400 bad/exclusive cursors; 403 rejected session path; 404 no usable source; 409 stale history cursor; 422 invalid result; 502 read/control failure; 503 missing SQLite DB |
| H05 | POST `/api/agents/:paneId/prompt` | `{text:string}` | 200 `PromptSentResponse` or `PromptSuppressedResponse` | 400 malformed body; 413 text >32 KiB UTF-8; 502 `PromptFailedResponse`; 500 unreadable result |
| H06 | POST `/api/agents/:paneId/stop` | body ignored after guard | 200 `StopAgentResponse` | 404 no agent in pane; 502 snapshot/decode/key-send failure |
| H07 | POST `/api/workspaces/:workspaceId/agents` | `LaunchAgentRequest` | 201 `LaunchAgentResponse`; 409 `TrustRequiredResponse` | 400 invalid body/unavailable kind; 503 installed-kind discovery failed; 502 validation/tab/launch failures; 500 unreadable result |
| H08 | GET `/api/agents/kinds` | none | 200 `InstalledKindsResponse` | 502 integration lookup/decode failure |
| H09 | GET `/api/agents/:kind/models` | kind path parameter | 200 `ModelCatalogResponse`, including unsupported kind and unavailable catalog as values | no explicit non-200 catalog-unavailable branch |
| H10 | POST `/api/agents/:paneId/answer` | `{numero:number,texte?:string}` | 200 `QuestionAnsweredResponse`, including `refusee` as a value | 400 body shape; 502 Herdr failure; 500 unreadable result |
| H11 | POST `/api/agents/:paneId/focus` | body ignored after guard | 200 `AgentFocusedResponse`, `focused:false` on Herdr failure | shared mutation guard only |
| H12 | POST `/api/agents/:paneId/trust` | `{accept:boolean}` | intended 200 `TrustResolvedResponse` | 400 invalid body; 502 Herdr failure; current response construction omits required `state`, so contract validation produces 500 for service outcomes |
| H13 | POST `/api/log` | `{level:"error",message:string,detail?:unknown}` | 200 `{ok:true}` | 400 `{ok:false}` malformed log body |
| H14 | GET `/api/events` | `Last-Event-ID` header | 200 `text/event-stream` | 503 `{error}` when eight counted streams are open |
| H15 | GET `/api/notifications/vapid-key` | none | 200 plain-text base64url public key, no-store | 503 plain text when service absent; 500 JSON `{error}` setup failure |
| H16 | POST `/api/notifications/subscriptions` | subscribe or unsubscribe body below | 204 empty body, no-store | 400 invalid subscription; 503 JSON `{error}` service absent; 500 JSON `{error}` read/write/key failure |
| H17 | GET `/api/file` | required `path` query | 200 binary/text body with type, length, disposition, no-store | 403 `{error}` for missing parameter, rejected/unavailable file, or failed lookup; 500 unreadable internal result |
| H18 | GET `/api/images` | none | 200 `RecentImagesResponse` | 502 `{error}` snapshot/scan failure |

Uncaught defects outside explicit result handling can still produce runtime 500 responses. No universal panic/defect response middleware is defined. Unknown paths, including unknown `/api/...`, reach the static SPA fallback, which can return HTML 200. This is accidental routing behavior, not a new JSON API contract.

### Inline request and non-schema response contracts

These are additional contracts outside the shared API schema module:

```ts
type PromptBody = { text: string };
type AnswerBody = { numero: number; texte?: string };
type TrustBody = { accept: boolean };
type ClientLogBody = { level: "error"; message: string; detail?: unknown };
type ClientLogResult = { ok: boolean };
type SubscribeBody = {
  endpoint: string; // current route checks https:// prefix
  expirationTime?: number | null;
  keys: { auth: string; p256dh: string };
};
type UnsubscribeBody = { unsubscribe: string };
```

Unsubscribe is tried before subscribe if a body contains both shapes. Stored subscriptions normalize omitted expirationTime to null. The stop/focus paths require JSON Content-Type, but do not parse or validate a JSON body. `numero` is a schema number at the route, then checked as an integer against offered choices by the service. `provider` is accepted in `LaunchAgentRequest` but is not consumed by the current launch implementation. Unknown object properties are generally removed by Effect Struct decoding, rather than rejected.

### Static responses

`/*` serves an existing confined asset or `index.html`. Bad percent encoding, escapes, nonexistent assets, and outward links fall back to index. Missing build responds `{error:"PWA not built",hint:...}` with 503. `/index.html`, `/sw.js`, `/push-sw.js`, `/manifest.webmanifest` and fallback HTML have `Cache-Control: no-cache, no-store, must-revalidate`. No compression, immutable-asset cache policy, ETag contract or range-response contract is explicitly implemented in application code; Bun can supply runtime file behavior.

## 3. Public DTO and behavioral contracts

Exact fields for every declared schema are in [CONTRACTS.md](CONTRACTS.md). This index explains their relationships and meaning.

| Contract group | Definitions | Semantics |
|---|---|---|
| Service health | `HealthResponse` | Backend status, Herdr reachability/socket, optional protocol/version/log/uptime |
| Overview | `AgentViewSchema`, `WorkspaceViewSchema`, `OverviewResponse` | Agent identity/context/session metadata, workspaces including empty ones, filtered count `withoutSession` |
| Sessions | `SessionEntrySchema`, `SessionCursor`, `SessionResponse` | Opaque raw/normalized entry, file identity/position, pagination, incremental/reset flags and explicit cause |
| Sending | `PromptSentResponse`, `PromptFailedResponse`, `PromptSuppressedResponse` | `confirmed/unknown`; `attente/erreur/inconnu`; suppressed is a normal no-op |
| Stop / focus | `StopAgentResponse`, `AgentFocusedResponse` | Interrupt transmitted vs not running; focus performed vs unavailable |
| Launch | `LaunchAgentRequest`, `LaunchAgentResponse`, `InstalledKind`, `InstalledKindsResponse` | Optional model/provider/name/thinking; created pane/tab; installed integration kinds |
| Models | `AgentModel`, `ModelCatalogResponse` | Per-model levels, aggregate levels, provenance, nullable unavailable reason |
| Interactive | `Choix`, `Question`, `QuestionAnsweredResponse`, `TrustRequiredResponse`, `TrustResolvedResponse` | Numbered choices; displayed question; submitted vs observed-applied decisions |
| Files | `RecentImageSchema`, `RecentImagesResponse` | Absolute path, modification time in milliseconds, byte size; body serving is a separate non-JSON contract |
| Errors | `ApiErrorResponse`, `SessionState` | Optional cause/hint; available/absent/error distinguishes empty from unreadable |
| Herdr input | `AgentInfo`, `AgentSessionInfo`, `WorkspaceInfo`, `TabInfo`, `SnapshotPane`, layout schemas, `SnapshotPayload`, protocol envelopes | Tolerant external data, separate from public wire DTOs |
| Normalized content | `SessionHeader`, `MessageEntry`, `ModelChangeEntry`, `ThinkingLevelChangeEntry`, `LooseEntry`, `LignePi`, `ChangePi` | Pi-compatible raw messages/settings; content intentionally remains flexible |

Wire enum values must retain their exact spelling, including French values: agent status `idle|working|blocked|done|unknown`; read cause `absente|vide|invalide|io`; session state `available|absent|error`; prompt failure `attente|erreur|inconnu`; trust state `transmise|acceptee|refusee|non-applicable`; question state `appliquee|transmise|refusee`.

Nullable fields are not optional fields. Required nullable session context fields in `AgentViewSchema` must still be emitted as null when unknown; optional summary fields must be omitted when unknown. Empty arrays are known-empty collections. Do not create fake model names, timestamps, versions, reasoning text, statuses, exit reasons or acceptance confirmations.

### Session cursor and query contract (H04)

- Base64 of JSON `{dev:number,ino:number,offset:number}`; client treats it as opaque. `decodeCursor` rejects unreadable schema and negative/noninteger offset; dev/ino have no additional explicit integer/range restriction.
- `cursor` and `before` are mutually exclusive. `tail` can coexist but the branch choosing cursor/before takes precedence. Legacy `since` is not consumed.
- JSONL initial `tail` defaults to 512 KiB; valid positive parsed integers are capped at 512 KiB; invalid/nonpositive values use the default. Reads retain complete newline-delimited records, discard a truncated leading record and defer an incomplete trailing record. Byte position follows the last complete newline.
- File identity comes from device/inode. Forward cursor replacement/truncation causes 200 with `reset:true` and a fresh tail. Missing file also resets to empty. Stale backward cursor gives 409. A missing advertised JSONL is a benign empty/absent session.
- `previousCursor` marks the beginning of the returned window. `hasMore` identifies omitted earlier entries; empty backward pages can still advance a cursor across oversized records.
- SQLite cursors use `{dev:0,ino:0,offset:sequence}`. Both adapters use 400-row windows, ignore `tail`, reread the boundary row using `>=` for mutable messages, and page backward with `<`. Caller replaces entries by stable ID. Missing advertised session row returns empty `cause:"absente"`; missing DB is 503. Current SQLite cursor does not identify database, agent or session and never reports rotation reset.
- Nonempty successful sessions currently also report `cause:"vide"`; that field is an existing schema vocabulary, not proof that entries are empty.

## 4. Domain and integration feature inventory

### Discovery, identity, content and summaries

| ID | Existing feature | Important details |
|---|---|---|
| D01 | Read Herdr snapshot | Agents, workspace metadata, optional panes/tabs/layouts; snapshot is nested under `result.snapshot` |
| D02 | Compose workspace view | Worktree checkout wins, otherwise first matching pane cwd; preserve project counts/focus/status, even for projects without agents |
| D03 | Compose agent view | Agent type/title/status/cwd/focus; original session-reference kind; session ID/header cwd/parent session; tri-state cwd match |
| D04 | Human naming and pane ranks | Numeric default labels suppressed; rank by rect y, then x, then pane ID, missing rect unranked; multi-pane label uses nonrepeating chosen name then rank, single pane omits it; same policy used for notifications |
| D05 | Visibility rule | Show if source path exists, working/blocked, multiple panes in tab, or readable family; `withoutSession` actually counts filtered agents, not every missing file |
| D06 | Supported session families | Pi, Codex, Claude Code, opencode, Devin; installed is different from readable; Cursor catalog support does not imply a Cursor session reader |
| D07 | Source reference resolution | `path` uses advertised file; Codex/Claude IDs search matching JSONL filenames; opencode/Devin IDs select read-only SQLite stores; empty IDs refused |
| D08 | Codex missing-reference fallback | Parse `thread name | cwd-basename` title; query versioned `$CODEX_HOME/state_*.sqlite` threads by exact name+cwd, unarchived, latest update; require rollout file to exist; source decision reused by all consumers |
| D09 | Header reads | Bounded 64 KiB first line; cwd/id/parentSession/version extraction; version fallback 1; enrichment currently ignores header read failure |
| D10 | JSONL reading | Header, full/forward/tail/backward reads, file-size identity checks, partial trailing records, unknown entries preserved; source files never written |
| D11 | Pi compatibility | Original JSONL retained; eight message roles and settings/usage/context/compaction/custom entry types; parentId is conversation ancestry, parentSession is session lineage |
| D12 | Codex normalization | `response_item` messages/function/custom tools/results/redacted reasoning; `event_msg.item_completed` UserMessage/AgentMessage/CommandExecution/FileChange; command outcome and diff edits; settings from turn_context/thread_settings_applied |
| D13 | Codex context filtering | Exclude developer/system-role prose and user content consisting entirely of injected AGENTS.md/INSTRUCTIONS or environment-context blocks; no size heuristic |
| D14 | Claude normalization | User/assistant lines, text and tool_use/tool_result including error; model from message; slash-command XML decoded; app notices/interrupt/compaction/system wrappers excluded; refused conversation lines stripped of message before raw fallback |
| D15 | opencode normalization | user text; assistant text, clear reasoning, tool calls/results/error/images, data-URI images; model.id/providerID/variant; default variant omitted; unsupported row types remain raw |
| D16 | Devin normalization | User/assistant text and clear thinking; metadata.created_at/generation_model; system excluded; guarded OpenAI-like tool conversion exists but code explicitly says real tool-call shape was not measured |
| D17 | SQLite paging | opencode session_v2/session_message by seq; Devin sessions/message_nodes by row_id; latest ascending after reverse, inclusive boundary replay, backward cursor, read-only queries/busy timeout |
| D18 | Conversation summary | One row per visible agent pane; last user text, assistant text or last tool+argument preview, known timestamp, model/provider/thinking, branch, source availability/cause, optional question/trust/waiting |
| D19 | Summary cache | File identity+size/offset+pending; 256 entries with oldest eviction; 64 KiB tail, up to 32 older windows (~2 MiB) to find metadata; incremental update preserves prior metadata when no replacement declared |
| D20 | Summary isolation | Four concurrent session reads; one bad session keeps other lines; snapshot error remains aggregate failure; question-screen enrichment later uses Promise.all |
| D21 | Git branch metadata | `git -C <pane cwd> rev-parse --abbrev-ref HEAD`; three-second child timeout; 30-second cache; detached HEAD, empty, missing git/error produce absent branch |
| D22 | Conservative metadata | Placeholder models in angle brackets excluded; model/provider selected as a pair; timestamps not fabricated; summaries are extracted data, no LLM summary generation |

Codex fallback DBs are currently reverse-lexically sorted, despite comments describing highest version first. A published slot that cannot be resolved can also fall through to title fallback. These details need explicit treatment in the compatibility ledger, rather than copying their comments as implementation.

Screen enrichment is attempted for nonworking agents that are blocked or have neither preview nor lastPrompt. Numbered question wins; otherwise recognized trust wins; otherwise a blocked agent gets optional `waiting:string` containing the last 12 nonempty screen lines, preserving leading indentation and trimming trailing spaces. This is a bounded factual waiting-screen excerpt, not a reconstructed conversation or invented choices. Nonblocked startup screens are not attached as waiting. Failed screen reads keep the existing row without that enrichment.

### Agent actions and interactive control

| ID | Existing feature | Important details |
|---|---|---|
| A01 | Submit prompt | Read current agent status; ordinary path uses agent.prompt; blocked path writes literal text then Enter; specific interactive-input refusal also triggers text/key fallback |
| A02 | Local duplicate suppression | SHA256 of target + NUL + exact text, first 32 hex chars; 60-second in-memory window; no upstream idempotency |
| A03 | Action uncertainty | Normal protocol success is reported confirmed; literal-input path reports unknown; transport/protocol failures classified as timeout/refusal/unknown at HTTP boundary |
| A04 | Stop working agent | Fresh snapshot; absent agent 404; nonworking no-op; working sends Ctrl+C; reports interrupt-sent, never proves process stopped |
| A05 | Focus/acknowledgement | agent.focus has real desktop effect; returns focused boolean, with failed focus a 200 value; explicitly logged |
| A06 | Installed integrations | integration.list; mapping command vs target; supported readable-family filter; launch additionally excludes state not_installed |
| A07 | Explicit agent launch | Workspace validation/cwd, unique generated `<label>-1..99` name or provided name, new unfocused tab, root pane, start agent with model args; no automatic second agent |
| A08 | Shell readiness and launch failure | Retry only “not an available shell,” every 3 s up to 10 retries; upstream agent detection timeout 120 s; close newly created tab on model/level validation failure; retain blocked launched pane for trust decision |
| A09 | Trust detection / response | Actual screen marker required; current agent kind determines known keys; Codex accept [1,enter]/deny [2], Claude accept [down,enter]/deny [enter]; no fallback for unknown kind |
| A10 | Trust verification | Read before; send keys; getAgent to verify existence; reread; disappeared agent or persistent prompt means transmise; refusal can quit agent; backend does not edit agent config itself |
| A11 | Question parser | Last coherent numbered list starting at 1, at least two choices; selected › marker, same-line/two-space and indented-next-line detail; strips vertical gutters; context and Enter/arrow help parsed |
| A12 | Answer question | Fresh visible screen; offered integer choice only; number+Enter; optional trimmed free text+Enter; reread distinguishes question remaining/disappearing; no readable question is a refused value |
| A13 | Model catalog lookup | Five catalog adapters below; per-kind successful-result 60 s cache and intended in-flight reuse; provenance and explicit unavailable reason; no catalog inferred from installed family |
| A14 | Launch model/level args | Pi --model/--thinking; Claude --model/--effort (effort-only allowed); Codex -m/--config model_reasoning_effort; Cursor --model, separate thinking rejected; others reject requested overrides |
| A15 | Model-level validation | Check declared levels only when model and thinking supplied; absent model/catalog levels do not establish unsupported; no chosen model means no invented default |

Current dedup implementation is broader than its “consecutive” comment: any matching retained fingerprint suppresses A→B→A inside the window. It also records successful interactive transport even though wire confirmation is unknown, and concurrent check/send/update is not atomic. `PromptSender` does not itself check a successful result discriminator equals `agent_prompted`; `HerdrClient` accepts any result record without an error. These are implementation facts, not a desired exactly-once guarantee.

Launch validates model arguments **after** creating a tab and attempts cleanup; the contrary comment is stale. `available` is decoded but not used to filter; the list endpoint does not mirror launch's state filter. A generated-name fallback after 99 tries can return a taken `-1`. `LaunchFailed` carries phase/pane internally, but generic HTTP failure flattens that structured context into an error string.

### Model-provider contracts

| Kind | Source | Parsing / supported levels |
|---|---|---|
| Pi | `pi --list-models` | Two-or-more-space columns; provider/model ID; thinking column yes adds off,minimal,low,medium,high,xhigh,max |
| Claude | Static CLI-documented aliases, source `claude --help (documented aliases)` | default,sonnet,opus,haiku; low,medium,high,max; non-null error explains full authenticated listing unavailable |
| Codex | `codex debug models` | `{models:[{slug,display_name?,supported_reasoning_levels?:[{effort}]}]}`; deduplicated levels per model and aggregate |
| Cursor | `cursor-agent --list-models` | `id - label` lines; no independent thinking levels |
| Devin | `devin models list --format json` | `{families:[{variants:[{model_uid,label?}]}]}`; variant ID, no independent thinking levels |
| Any other | no command | Empty arrays, source `aucune`, error explaining absence of verified mechanism |

Commands are fixed argv arrays, not a shell execution API. Timeout 20 s, stdout 2 MiB, stderr 64 KiB; overrun/timeout kills only that created child. The HTTP response remains 200 with error/provenance. This inventory did not execute any agent CLI, including catalog commands.

## 5. Herdr socket and content-store contracts

### Unix socket protocol

`Transport.ts` creates one Unix connection per request. UTF-8 newline-delimited JSON request `{id:"hr-N",method,params:{...}}`; first newline-delimited response is decoded. Reply is `{id:string,error?:{code:string,message:string},result?:Record<string,unknown>}`. Error wins over result. Neither result nor error is a decode error. The current client does not compare reply.id to the request ID. Default transport timeout is **15 s**, including requests that specify a longer upstream detection timeout. Socket errors, close-before-response and timeout destroy the connection; no persistent connection or multiplexing exists. No explicit frame-size ceiling is applied.

| Method used by backend | Params / result contract | Consumer |
|---|---|---|
| `ping` | `{}` → result `{protocol:number,version:string}` | Startup / H01 |
| `session.snapshot` | `{}` → `{snapshot:SnapshotPayload}` | Watcher, overview, summaries, stop, launch, file roots |
| `agent.get` | `{target}` → result with `agent` | Session source, action status and trust family/existence |
| `agent.list` | `{}` → `{agents:AgentInfo[]}` | Internal client API; salvages individually valid items and counts skipped; not a separate public route |
| `agent.read` | `{target,source,strip_ansi:true,lines?:200}` → `{read?:{text?:string,truncated?:boolean}}` | Questions and trust; visible omits lines, default recent includes lines |
| `agent.prompt` | `{target,text}` → result record (expected agent_prompted) | Prompt path |
| `pane.send_text` | `{pane_id,text}` → result record | Interactive literal text |
| `agent.send_keys` | `{target,keys:string[]}` → result record | Enter, choice, trust, Ctrl+C |
| `agent.focus` | `{target}` → result record | Desktop focus |
| `tab.create` | `{cwd:string|null,focus:boolean,label:string|null,workspace_id:string|null}` → `{tab:{tab_id},root_pane:{pane_id}}` | Launch |
| `agent.start` | `{args:string[],kind,name,pane_id,timeout_ms}` → result record | Launch; client default timeout_ms 60000, HTTP path uses 120000 |
| `tab.close` | `{tab_id}` → result record | Cleanup newly created launch tab |
| `integration.list` | `{}` → `{integrations:[{available,command,label,state,target}]}` | Installed/listable/launchable kinds |

The shared `Method` vocabulary additionally declares `events.subscribe` and `events.wait`, but neither is used by the current runtime. Historical measurement supports only `pane_agent_status_changed` for wait matching; `revision` is not a content cursor. Do not convert declared-but-unused method names into claims of delivered backend functionality.

### Source stores

| Source | Location / schema queried | Identity and ordering |
|---|---|---|
| Pi | `$PI_SESSIONS_ROOT`, default `~/.pi/agent/sessions`; advertised JSONL path | dev/ino/byte offset; header id/cwd/parentSession |
| Codex | `$CODEX_SESSION_ROOT`, default `~/.codex/sessions`; rollout filename contains session ID | JSONL position; normalized IDs `codex:<ordinal-or-timestamp>:<item>` |
| Codex fallback index | `$CODEX_HOME/state_*.sqlite`, default `~/.codex`; `threads(name,cwd,rollout_path,archived,updated_at)` | Exact name+cwd, archived=0, updated_at descending, limit 1 |
| Claude | `$CLAUDE_PROJECTS_ROOT`, default `~/.claude/projects`; recursive `<uuid>.jsonl` | dev/ino/offset; normalized `claude:<uuid>` when present |
| opencode | `$OPENCODE_DB`; existence `session_v2 WHERE id=?`; page `session_message(id,type,seq,time_created,data) WHERE session_id=?` | seq ordered; normalized `opencode:<id>`; inclusive replay boundary |
| Devin | `$DEVIN_DB`; existence `sessions WHERE id=?`; page `message_nodes(row_id,chat_message,created_at) WHERE session_id=?` | row_id ordered; normalized ID `devin:<row_id>`; inclusive replay boundary |

All SQLite connections use read-only mode; opencode/Devin set busy_timeout=3000. No source schema writes, WAL-mode changes, indexing migrations, lock-file edits, or source-session cleanup is performed. Unknown normalized content must remain available as raw data; source JSON is not necessarily identical to `SessionEntry.raw`, because translated records are serialized into Pi form. Timestamp strings are ISO-like source entry values, message timestamps can be Unix milliseconds, and summary timestamps are numeric milliseconds.

## 6. Events, notifications and durable state

| ID | Existing feature | Contract |
|---|---|---|
| E01 | Polling state watcher | 2 s after each completed iteration; cached agents/last-success timestamp/error count; failures keep loop running |
| E02 | State diff | Signature status/title/cwd/type/sessionPath; changes appeared/status/disappeared; metadata changes can emit status with same from/to |
| E03 | Initial observation | Suppress appeared events while previous map is empty; disappearance retains last identity for notification |
| E04 | Event journal | Memory only, monotonic integer IDs starting at 1; default capacity 500; oldest evicted; restart loses journal |
| E05 | SSE catch-up | Last-Event-ID parsed as integer, default 0; replay greater IDs; old cursor gets resync and resume position; max eight counted streams; 300 ms per-stream scan |
| E06 | Push trigger | working→any other status; working/blocked→gone; idle/done disappearance ignored |
| E07 | Push wording and deep links | Agent needs you / Agent finished / Agent stopped; grounded identity, distinct waiting/done/gone tags; `/#/agent/<encoded paneId>` |
| E08 | Subscription lifecycle | Endpoint-keyed upsert, remove endpoint, persistent VAPID key auto-generation or env override; serialized store operations |
| E09 | Delivery | Encrypted Web Push to subscriptions; TTL 60 s; 404/410 remove expired endpoints, other failures logged; push failure does not fail watcher |
| E10 | Legacy-store migration | On startup copy full old cwd `.herdr-remote/push.json` including keys when old has subscriptions and destination absent/empty; do not overwrite populated destination |

### SSE wire events

Headers: `Content-Type:text/event-stream`, `Cache-Control:no-cache`, `Connection:keep-alive`. Event payload is emitted directly as JSON `data`, not wrapped in BusEvent. Journal `at` is not emitted as a separate field.

| Event | ID behavior | Data |
|---|---|---|
| `ready` | No id; immediately on open | `{cursor:number}` |
| `agent_status` | Monotonic journal id | `{from:string|null,kind:"status"|"appeared"|"disappeared",paneId:string,to:string}`; `to` may be gone |
| `prompt` | Journal id | `{paneId,status:"sent",fingerprint,confirmation:"confirmed"|"unknown"}` |
| `prompt-suppressed` | Journal id | `{paneId,reason:"consecutive identical send"}` |
| `agent-launched` | Journal id | `{kind,paneId,workspaceId}` |
| `resync` | id=resumeFrom | `{reason:"truncated journal",resumeFrom:number}` |

No content-delta, heartbeat, trust-answer, question-answer or stop event is currently published. Internal `BusEvent` is `{id,kind,at,data}`; `CatchUp` is `{events,resyncRequired,resumeFrom}`. Current resync construction can also replay retained events in the same iteration. Cancellation releases stream count but does not stop an idle loop; future cursor after restart is not recognized as discontinuity.

### Push persistence and payloads

```ts
type PushStore = {
  subscriptions: Array<{
    endpoint: string;
    expirationTime?: number | null;
    keys: { auth: string; p256dh: string };
  }>;
  vapidKeys?: { publicKey: string; privateKey: string };
};
type PushPayload = { body: string; tag: string; title: string; url: string };
```

Store defaults to `~/.herdr-remote/push.json`, parent mkdir mode 0700 and file create mode 0600. Writes currently rewrite JSON directly, without atomic replace. Missing store means empty subscriptions; malformed store is a visible error, never silent regeneration. Existing VAPID keys must survive Rust migration unchanged so browser subscriptions stay valid. Subject resolution is explicit VAPID subject, otherwise first HTTPS configured plural public origin, otherwise `mailto:herdr-remote@example.com`.

Browser-side `push-sw.js` suppresses notification display when any app window is visible, then focuses/navigates a window on notification click. Those behaviors are frontend ownership; preserve payload/deep-link compatibility, not server-side claims that the selected conversation was read.

## 7. File access, security and diagnostics

| ID | Feature | Current behavior |
|---|---|---|
| S01 | Personal tailnet trust boundary | No app authentication, cookies or per-device permissions; network ACLs/Serve are the access boundary |
| S02 | Mutation origin policy | Exact configured origins plus loopback hostname localhost/127.0.0.1/::1 on any port; missing Origin rejected; no general CORS middleware |
| S03 | Body guards | JSON Content-Type prefix; declared Content-Length >64 KiB rejected before parse; text prompt independently capped at 32 KiB UTF-8 |
| S04 | Session confinement | Canonical configured roots, path segment checks, symlink escape rejection; missing root/file and outside-root/link causes distinguished |
| S05 | File roots | Every request derives project checkout roots from fresh Herdr snapshot plus explicitly configured extra roots; no implicit Desktop/Downloads/Pictures access |
| S06 | File descriptor checks | Canonicalize roots/target, open resolved file, fstat regular-file and size, read same descriptor, close; max 12 MiB |
| S07 | Inline/download policy | Inline .avif .gif .jpeg .jpg .png .webp .pdf plus .txt .log .json .jsonl .md .diff .patch as text/plain; other types octet-stream attachment; SVG not inline |
| S08 | Recent-image discovery | png/jpg/jpeg/gif/webp/avif, recursive depth 3, collected cap 400, local-directory matching-image cap 120, four roots concurrently, most recent first, return 60 |
| S09 | Scan exclusions/degradation | Dot entries and dependency/build directories skipped; unreadable/disappeared entries ignored; stat follows links; partial scan is normal and not represented by a completeness field |
| S10 | Error response contract | Named cause/hint when supplied, structured response validation before emission; outgoing >=400 logged; some handlers still collapse detailed causes |
| S11 | Log format | ISO time `[LEVEL] [source] message` plus optional JSON detail truncated to 2000 chars; server/client origins; file path injected into tests |
| S12 | Log bounds | Rotate >4 MiB current file to `.1`; suppress repeats keyed path/source/level/message within rolling 60 s; logging failure swallowed |
| S13 | Display error sanitization | Human-readable detail/message preferred; replace pane/tab IDs in suitable error strings; fallback serialization limited to 300 chars |
| S14 | Read-only upstream data | No prompt experiments against user agents; tests use fake socket transport/temp stores; service mutations only reflect explicit product actions |

Current path canonicalization plus later open is not a complete descriptor-relative defense against concurrent symlink replacement. Recent-image scanning can follow links and list metadata outside roots even when H17 rejects the later read. Declared Content-Length enforcement is not a streamed byte limit. These are explicit hardening items for the Rust design.

Ignored scan directory names: node_modules, dist, build, target, vendor, coverage, .next, .nuxt, .turbo, Pods, __pycache__, .venv, venv (plus any dot-prefixed entry). The 120 counter is per recursive walk invocation, not a true per-top-level-root limit; concurrent collectors share the 400 array and do not provide an atomic global budget.

## 8. Configuration and resource contracts

| Environment key | Default / precedence | Consumer |
|---|---|---|
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock` | Control socket; `HERDR_SOCKET` deliberately unused |
| `HERDR_REMOTE_BIND` | `127.0.0.1` | Current check also permits string prefixes 100. / fd7a:; rejects others |
| `HERDR_REMOTE_PORT` | 8791 | parseInt then 1..65535; shared frontend proxy helper falls back on invalid value |
| `HERDR_REMOTE_PUBLIC_ORIGINS` | comma-separated, preferred over singular alias | Explicit mutation origins / VAPID subject fallback |
| `HERDR_REMOTE_PUBLIC_ORIGIN` | legacy fallback if plural unset | Explicit origins only |
| `HERDR_REMOTE_FILES_ROOTS` | empty | Colon-separated existing paths, trimmed; additional file/image roots |
| `PI_SESSIONS_ROOT` | `~/.pi/agent/sessions` | JSONL roots |
| `CODEX_SESSION_ROOT` | `~/.codex/sessions` | JSONL root/search |
| `CLAUDE_PROJECTS_ROOT` | `~/.claude/projects` | JSONL root/search |
| `CODEX_HOME` | `~/.codex` | Versioned state DB fallback; independent from CODEX_SESSION_ROOT |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | Source DB; current source resolver also reads env directly |
| `DEVIN_DB` | `~/.local/share/devin/cli/sessions.db` | Source DB |
| `HERDR_REMOTE_LOG_PATH` | `~/.herdr-remote/herdr-remote.log` | Application journal |
| `HERDR_REMOTE_PUSH_STORE` | `~/.herdr-remote/push.json` | Keys/subscriptions; independent of configured log path |
| `HERDR_REMOTE_VAPID_SUBJECT` | HTTPS configured origin, then mailto fallback | Push claims |
| `HERDR_REMOTE_VAPID_PUBLIC_KEY` | persisted/generated when pair absent | Both overrides required together |
| `HERDR_REMOTE_VAPID_PRIVATE_KEY` | persisted/generated when pair absent | Partial override is an error |

Tailscale origin discovery executes `tailscale serve status --json` once at startup, timeout 5 s. It selects only Serve handlers proxying a loopback host and the actual backend port, normalizes HTTPS port 443 away, and retains other HTTPS ports. CLI absence/failure yields no derived origins. It probes known macOS/Linux absolute binary paths before PATH. Direct tailnet bind adds its own HTTP origin with proper IPv6 brackets. Ambient HOME/PATH remain runtime inputs; no dot-env loader or parsed CLI flags are implemented.

| Resource | Current setting |
|---|---|
| JSON request declaration / prompt / project file | 64 KiB / 32 KiB UTF-8 / 12 MiB |
| JSONL initial/default/hard maximum window | 512 KiB |
| JSONL incremental delta | Entire remainder; no explicit page cap |
| Summary tail / older metadata budget / entries | 64 KiB / 32 windows / 256 cached sessions |
| Header read | 64 KiB |
| SQLite chat / list window | 400 / 200 rows |
| SQLite busy timeout | 3 s |
| Session-summary concurrent reads | 4 per request |
| Herdr transport timeout | 15 s |
| Watcher interval / overview-cache freshness | 2 s / 15 s and nonempty cache; warm path still snapshots |
| SSE journal / streams / scan cadence | 500 events / 8 counted streams / 300 ms |
| Prompt duplicate window | 60 s |
| Catalog timeout / stdout / stderr / cache | 20 s / 2 MiB / 64 KiB / 60 s |
| Branch command timeout / cache / returned text cap | 3 s / 30 s / 4096 chars after reading output |
| Launch shell retries / spacing / detection timeout | 10 retries / 3 s / 120 s upstream request parameter |
| Image traversal / collection / return | depth 3 / 400 / 60 |
| Push TTL | 60 s |
| Log rotation / retained previous generations / repeat window | >4 MiB / 1 / 60 s |

All remaining internal typed ports, errors, source models and constant vocabularies are recorded in the generated declaration appendix and source map. This inventory establishes the review baseline; actual migration parity will require executable fixture coverage, not an assumption that comments or this document prove runtime support.

## 9. Écarts du démon Rust (état au 2026-10-29)

Les sections 1 à 8 photographient le fil TS (commit de base). Cette section dit ce que le démon Rust fait **différemment**, route par route ; chaque ligne a sa preuve composée dans `compatibility/coverage.json`.

### Routes modifiées

| ID | Fil TS | Démon Rust | Preuve |
|---|---|---|---|
| H04 | curseurs : JSON base64 `{dev,ino,offset}` ; curseur SQLite sans identité de session ; base SQLite absente 503 | curseurs **versionnés et liés** à leur source (empreinte + session) : illisible, `cursor`+`before` ensemble, ou curseur d'une **autre** session → **400** ; curseur d'historique d'un fichier remplacé → **409** ; chemin publié hors des racines → **403** ; base SQLite absente → **503** ; base présente mais illisible → 502 | `crates/herdrchat/tests/unit/composition.rs` (vrai `PortSessions` derrière le routeur) |
| H04 | — | une ligne JSONL > 16 MiB n'est pas lue : une entrée `unknown` la remplace (`{"type":"unknown","ignored":true,"bytes":N,"reason":"line too large (N bytes) skipped"}`), la PWA affiche « A line of N MB was skipped (too large) » | `crates/sessions/tests/unit/port_curseurs.rs`, `apps/web/tests/blocks.test.ts` |
| H19 | un chemin publié refusé : `gone` | un chemin refusé par la garde (403 sur H04) ferme le flux par `gone` avec la cause réelle, jamais une attente muette | `crates/http-api/tests/unit/flux_session.rs` |
| H04 / H19 | `parentId` omis quand la ligne n'en porte pas | `parentId` **toujours présent** sur chaque `SessionEntry` : la valeur, ou `null` (forme `Schema.optional(Schema.NullOr)` respectée, jamais omis côté démon) | `crates/http-api/tests/unit/session.rs` |
| H07 | refus de validation (modèle, niveau) → 502 | refus de validation → **400** `{error: "invalid launch request: <cause>"}`, **avant** tout onglet ; un niveau que le modèle n'offre pas est refusé (`niveau_supporte`) ; `not an available shell` rejoué (10 essais, 3 s), puis l'onglet **possédé** est fermé et la réponse est 502 | `crates/http-api/tests/unit/lancement.rs`, `crates/herdrchat/tests/unit/composition.rs` |
| H08 | libellé et état reconstruits côté serveur | `label` et `state` viennent **d'Herdr** (`integration.list`), tels quels ; la liste reste celle des types lançables ; un type sans état mesuré → 502 nommé | `crates/http-api/tests/unit/catalogues.rs` |
| O03 | ping au démarrage | ping au démarrage sur un fil à côté de l'écoute : `info` (protocole, version) ou `warn` avec la cause réelle ; le serveur HTTP ne l'attend jamais | `crates/herdrchat/tests/unit/demarrage.rs` |

### Routes ajoutées

| ID | Méthode et chemin | Entrée | Succès | Autres réponses |
|---|---|---|---|---|
| H19 | GET `/api/agents/:paneId/stream` | `Last-Event-ID` (prioritaire) ou `?cursor=` | 200 `text/event-stream` : `entries` (`SessionStreamEntries`), `reset` (`SessionResponse`), `gone` (`SessionStreamGone`), battement 15 s — contrat complet dans [STREAMING.md](STREAMING.md) | 404 pane inconnu ; 503 plus de 16 flux ; un curseur refusé n'est pas une erreur HTTP : il produit un `reset` |
| H20 | GET `/api/agents/:paneId/taches` | aucune | 200 `BackgroundTasksResponse` `{paneId, supported, tasks[]}` — `supported:false` = capacité absente (famille sans tâches de fond), jamais une liste vide inventée | 404 pane inconnu ou sans session ; 502 lecture en panne |
| H21 | GET `/api/agents/:paneId/taches/:id/session` | `tail?`, `cursor?`, `before?` comme H04 | 200 `SessionResponse` de la transcription de la tâche | 404 tâche inconnue ou sans transcription ; 403 chemin de transcription hors des racines ; 422 résultat invalide ; autres statuts comme H04 |
| H22 | POST `/api/agents/:paneId/read` | `MarkReadRequest` `{at: number}` (ms epoch) | 200 `MarkReadResponse` `{paneId, readAt}` — `readAt` ne recule jamais (une lecture plus ancienne rend la connue) ; la lecture est partagée entre tous les appareils, persistée dans `HERDR_REMOTE_READS_STORE` (défaut : `reads.json` à côté du magasin push) ; ne touche jamais Herdr | 400 corps invalide ; gardes POST partagées ; une panne de persistance est journalisée (`warn`), la lecture vaut en mémoire |
| H23 | POST `/api/notifications/presence` | `PresenceRequest` `{endpoint: string, visible: boolean}` | 204 sans corps — l'appareil (son endpoint push) a l'app au premier plan : il n'est pas notifié tant que sa présence vit (battement 10 s, oubli à 25 s, départ explicite `visible:false`) ; les autres appareils le sont toujours | 400 corps invalide ; 503 Web Push absent ; gardes POST partagées |

`BackgroundTask` : `id`, `kind` (`agent` \| `commande`), `status` (`en_cours` \| `terminee` \| `echouee` \| `arretee` \| `inconnu` — sans fin écrite ni activité depuis 30 min, une tâche est `inconnu`, jamais `en_cours`), `transcript` (booléen), et, quand la source les porte : `description`, `agentType`, `startedAt`, `endedAt`, `lastActivity`, `summary`.

### Champs ajoutés à `ConversationSummary` (H03)

| Champ | Forme | Sens |
|---|---|---|
| `tourDebut` | `number` (ms epoch), omis si inconnu | l'instant du message qui a **ouvert** le tour courant : la dernière vraie demande — ni une demande envoyée pendant le travail (`details.midTurn`), ni un message du harnais injecté dans le tour |
| `tachesDeFond` | `{enCours: number, total: number}`, omis si la famille n'expose pas de tâches | le décompte des tâches de fond de l'agent (H20) |
| `readAt` | `number` (ms epoch), omis tant qu'aucun appareil ne l'a ouverte | la lecture partagée (H22) ; la PWA prend la plus récente de sa lecture locale et de celle-ci pour le point « non lu » |

`lastPrompt` est la demande qui a **ouvert** le tour courant (jamais une demande glissée en plein tour) ; si elle est au-delà de la remontée ordinaire, une remontée profonde unique la retrouve et le démon la retient par source tant que le fichier ne fait que grandir. Le résumé de compactage de Claude (`isCompactSummary`) devient un message `custom` `compaction`, jamais une demande. `lastPrompt` ne compte que les demandes de l'utilisateur : les messages du harnais Claude (rapports de sous-agents, fins de tâches de fond) deviennent des messages `custom`, et les lignes du mode shell de Claude (`<bash-input>`, `<bash-stdout>`/`<bash-stderr>`) des `bashExecution` (commande, sortie, `exitCode: null`) — ni l'un ni l'autre n'est jamais une demande.

### Interface

Tout le texte visible (PWA, notifications push, corps `error` du démon) est en **anglais** (décision T072) ; les codes et énumérations du contrat (`cause: "absente"`, `en_cours`…) ne changent pas.
