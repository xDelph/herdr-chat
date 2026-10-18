# Synthetic reference contract corpus (T001)

Frozen corpus of positive and negative wire samples with `accept`/`reject`
expectations, proven **by execution** against the current TypeScript contract
authority (`packages/shared/src/api.ts`, `packages/shared/src/protocol.ts`, and
the inline route schemas of `apps/server/src/http/Api.ts`) before being frozen
as data. The file itself carries no code and no imports: it survives the T057
contract-authority switch unchanged.

- `corpus.json` — the frozen samples. Fields per sample: `id`, `target`
  (schema/body name), `kind` (`positive`/`negative`), `expect`
  (`accept`/`reject`), `verify` (`schema`, `cursor`, `constructed`),
  `provenance`, `value`.
- Rebuild: `bun packages/shared/scripts/build_contract_corpus.ts` (dev-only;
  fails if any sample behaves differently than recorded).

Counts at freeze time: see `counts` inside `corpus.json`. Notable recorded
distinctions (each is exercised by negative samples so the Rust DTOs cannot
silently differ):

- optional field ≠ nullable field (`SessionEntry.id: null` rejected;
  `HerdrReply.result` absent ok); explicit `null` on an optional literal
  rejected (`ApiError.cause: null`).
- closed literal unions on `status`-like fields everywhere.
- unknown object properties are stripped, not rejected.
- `SessionCursor`: opaque base64; rejects garbage base64, non-objects,
  wrong field types, negative and non-integer offsets; accepts dev/ino 0
  (legacy SQLite) and tolerant extra fields.
- upstream wire tolerance (`HerdrReply`, `AgentInfo`, `WorkspaceInfo`,
  `SnapshotPayload` families) recorded for the private `herdr_client` wire
  structs (T012/T013).
- SSE payloads, push store/payload, `Method` vocabulary and
  `SUPPORTED_EVENT_WAIT_MATCHES` are **constructed** shapes: no baseline
  decoder exists, so they are frozen as data from routing/persistence code and
  the consumers at T053/T057 must match them.

Known-baseline defect samples: `TrustResolved` without `state`
(the C03 defect) is recorded as a negative — i.e. today's schema already
demands `state`, and today's route breaks the contract; T033/T051 fix the
producer side. This is kept visible instead of erased.
