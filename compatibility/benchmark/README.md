# Frozen benchmark fixture bundle (T001; consumed at T065)

Synthetic, deterministic test data for the TS→Rust performance comparison.
**Dev-only.** No Herdr socket, no agent CLI, no user session, no network, no
real push/VAPID material is ever touched — the data generator writes files into
this directory only.

Regenerate:

    bun compatibility/benchmark/generate.ts            # fixtures + manifest
    bun compatibility/benchmark/generate.ts --delta    # 32 MiB delta append file

Determinism was proven at freeze time: a full regeneration produced
byte-identical artifacts (all 78 sha256 values unchanged). The T065 harness
must verify the manifest hashes before measuring; a mismatch means the bundle
was altered and measurements are void.

## Contents

- `pi/pane-*.jsonl` — 55 Pi sessions (55 × ≥40 KiB) written by the existing
  synthetic seeded fixture writer (`compatibility/benchmark/fixture-pi.ts`, copied verbatim from the retired `apps/server/src/sessions/Fixture.ts` at T068,
  seed base 20 240 310). Real Pi line shapes by construction.
- `codex/pane-*.jsonl` — 10 rollout-shaped sessions: `response_item`
  (message/function_call/function_call_output/reasoning), `event_msg`
  (item_completed with UserMessage/FileChange/CommandExecution/AgentMessage),
  `turn_context`, plus deliberately injected `<INSTRUCTIONS>`/`<environment_context>`
  content that the Codex profile must not surface as user prose.
- `claude/pane-*.jsonl` — 10 Claude Code-shaped sessions (`user`/`assistant`,
  `tool_use`/`tool_result`, model on the assistant message, plus an
  `api-request-blob` accounting line that must not enter the conversation).
- `opencode/opencode.db` — synthetic `session_v2`/`session_message`
  (50 sessions × 120 rows, mixed user/assistant/reasoning/tool/data-URI
  image/idle/system/model-switched rows).
- `devin/devin.db` — synthetic `sessions`/`message_nodes`
  (50 sessions × 120 rows, unique `(session_id, node_id)`, `row_id` order).
- `manifest.json` — sha256 + byte size per artifact, seed, generator command,
  bun version, and the frozen **expected** sha256 of the delta file
  (`51f047366143a5b432ed475445a6d9a93af9820296b0dd1e5ea8e7ffe20731da`,
  33 554 963 bytes).
- `delta/append-pi.jsonl` — **not committed** (gitignored): the deterministic
  32 MiB catch-up append (seed 21 050 318). Regenerate with `--delta` and
  compare against the manifest hash before each measurement run.

## Recorded scenarios (frozen reference conditions; harness built at T065)

`panes-1`, `panes-10`, `panes-50`; concurrent clients 1/4/8; cold vs warm
resolution; `delta32MiB` (base 2 MiB + this append, reconnect, full catch-up);
`lockDB` (opencode store held under a write transaction during reads — the
3 s busy-timeout path); `sse-idle` (quiet journal feed, 8 idle connections).
Runbook and measured numbers belong to T065 and are **not** recorded here.
