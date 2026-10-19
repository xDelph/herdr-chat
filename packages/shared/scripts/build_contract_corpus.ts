#!/usr/bin/env bun
/**
 * Build the frozen synthetic reference contract corpus (task T001).
 *
 * Every schema-backed sample is validated NOW against the current contract
 * authority (packages/shared/src/{api,protocol}.ts + inline route schemas in
 * apps/server/src/http/Api.ts) so each recorded `expect: accept|reject`
 * verdict is proven by execution, not assumed. After T057 the Rust DTOs become
 * the authority and must reach identical verdicts on this frozen corpus.
 *
 * Dev-only. Writes ../../compatibility/contracts/corpus.json (+ README.md).
 * Lives inside packages/shared so the `effect` dependency resolves for the
 * schema decode that proves each verdict.
 */
import { Schema } from "effect";
import {
  AgentFocusedResponse,
  AgentModel,
  AgentViewSchema,
  ApiErrorResponse,
  Choix,
  ConversationSummary,
  ConversationsResponse,
  InstalledKind,
  InstalledKindsResponse,
  HealthResponse,
  LaunchAgentRequest,
  LaunchAgentResponse,
  ModelCatalogResponse,
  OverviewResponse,
  PaneLayout,
  PaneLayoutPane,
  PaneLayoutRect,
  PromptFailedResponse,
  PromptSentResponse,
  PromptSuppressedResponse,
  Question,
  QuestionAnsweredResponse,
  RecentImageSchema,
  RecentImagesResponse,
  SessionEntrySchema,
  SessionResponse,
  SessionState,
  SnapshotPane,
  SnapshotPayload,
  ReadSource as ContratReadSource,
  StopAgentResponse,
  TabInfo,
  TrustRequiredResponse,
  TrustResolvedResponse,
  WorkspaceViewSchema,
} from "../src/api.ts";
import {
  AgentInfo as ProtocolAgentInfo,
  AgentListPayload,
  AgentSessionInfo,
  HerdrReply,
  PaneInfo as ProtocolPaneInfo,
  PaneReadPayload,
  PongPayload,
  WorkspaceInfo as ProtocolWorkspaceInfo,
  WorkspaceWorktreeInfo,
} from "../src/protocol.ts";

// --- Inline route schemas, mirroring apps/server/src/http/Api.ts (provenance)
const InlinePromptBody = Schema.Struct({ text: Schema.String });
const InlineTrustBody = Schema.Struct({ accept: Schema.Boolean });
const InlineAnswerBody = Schema.Struct({
  numero: Schema.Number,
  texte: Schema.optional(Schema.String),
});
const InlineLogBody = Schema.Struct({
  detail: Schema.optional(Schema.Unknown),
  level: Schema.Literal("error"),
  message: Schema.String,
});
const InlineSubscribeBody = Schema.Struct({
  endpoint: Schema.String,
  expirationTime: Schema.optional(Schema.NullOr(Schema.Number)),
  keys: Schema.Struct({ auth: Schema.String, p256dh: Schema.String }),
});
const InlineUnsubscribeBody = Schema.Struct({ unsubscribe: Schema.String });

type Sample = {
  id: string;
  target: string;
  kind: "positive" | "negative";
  expect: "accept" | "reject";
  verify: "schema" | "route-guard" | "cursor" | "constructed";
  provenance: string;
  value: unknown;
};
const samples: Sample[] = [];
let seq = 0;

type AnySchema = Schema.ConstraintDecoder<unknown>;

const verifierOf: Record<string, AnySchema> = {
  HealthResponse,
  AgentView: AgentViewSchema,
  WorkspaceView: WorkspaceViewSchema,
  Overview: OverviewResponse,
  SessionEntry: SessionEntrySchema,
  SessionResponse,
  PromptSent: PromptSentResponse,
  PromptFailed: PromptFailedResponse,
  PromptSuppressed: PromptSuppressedResponse,
  StopAgent: StopAgentResponse,
  AgentFocused: AgentFocusedResponse,
  LaunchAgentRequest,
  LaunchAgent: LaunchAgentResponse,
  InstalledKind,
  InstalledKinds: InstalledKindsResponse,
  AgentModel,
  ModelCatalog: ModelCatalogResponse,
  RecentImage: RecentImageSchema,
  RecentImages: RecentImagesResponse,
  TrustRequired: TrustRequiredResponse,
  TrustResolved: TrustResolvedResponse,
  QuestionAnswered: QuestionAnsweredResponse,
  Choix,
  Question,
  ConversationSummary,
  Conversations: ConversationsResponse,
  ApiError: ApiErrorResponse,
  SessionState,
  HerdrReply,
  PongPayload,
  AgentInfo: ProtocolAgentInfo,
  AgentSessionInfo,
  AgentListPayload,
  PaneReadPayload,
  WorkspaceInfo: ProtocolWorkspaceInfo,
  PaneInfo: ProtocolPaneInfo,
  WorkspaceWorktreeInfo,
  TabInfo,
  SnapshotPane,
  PaneLayoutRect,
  PaneLayoutPane,
  PaneLayout,
  SnapshotPayload,
  ReadSource: ContratReadSource,
  PromptBody: InlinePromptBody,
  TrustBody: InlineTrustBody,
  AnswerBody: InlineAnswerBody,
  ClientLogBody: InlineLogBody,
  SubscribeBody: InlineSubscribeBody,
  UnsubscribeBody: InlineUnsubscribeBody,
};

const S = (target: string, values: unknown[]): void => {
  for (const value of values) {
    seq += 1;
    samples.push({
      id: `${target}-p${String(seq).padStart(3, "0")}`,
      target,
      kind: "positive",
      expect: "accept",
      verify: verifierOf[target] ? "schema" : "route-guard",
      provenance: verifierOf[target]
        ? "packages/shared schema (verified at build time)"
        : "inline route schema in apps/server/src/http/Api.ts (verified at build time)",
      value,
    });
  }
};
const N = (target: string, values: unknown[]): void => {
  for (const value of values) {
    seq += 1;
    samples.push({
      id: `${target}-n${String(seq).padStart(3, "0")}`,
      target,
      kind: "negative",
      expect: "reject",
      verify: verifierOf[target] ? "schema" : "route-guard",
      provenance: "distinction corpus (presence/null/literal/type) checked at build time",
      value,
    });
  }
};
const CURSOR = (label: string, encoded: string, ok: boolean): void => {
  seq += 1;
  samples.push({
    id: `SessionCursor-c${String(seq).padStart(3, "0")}`,
    target: "SessionCursor",
    kind: "positive",
    expect: ok ? "accept" : "reject",
    verify: "cursor",
    provenance:
      "api.ts:decodeCursor — opaque base64; reject unreadable/negative/non-integer offset",
    value: { label, encoded },
  });
};
const RAW = (target: string, provenance: string, values: unknown[]): void => {
  for (const value of values) {
    seq += 1;
    samples.push({
      id: `${target}-r${String(seq).padStart(3, "0")}`,
      target,
      kind: "positive",
      expect: "accept",
      verify: "constructed",
      provenance,
      value,
    });
  }
};

const encode = (c: unknown): string => Buffer.from(JSON.stringify(c), "utf8").toString("base64");

// ---------------------------------------------------------------------------
// Public DTOs
// ---------------------------------------------------------------------------
const agentViewFull = {
  agent: "codex",
  cwd: "/Users/x/proj",
  focused: true,
  paneId: "p1",
  parentSession: null,
  sessionCwd: "/Users/x/proj",
  sessionCwdMatches: null,
  sessionId: "abc123",
  sessionKind: "id",
  sessionPath: "/Users/x/.codex/sessions/abc123.jsonl",
  status: "working",
  tabLabel: null,
  tabId: "t1",
  tabNumber: 3,
  name: null,
  paneRank: 1,
  tabPaneCount: 1,
  title: "Terminal",
  workspaceLabel: null,
  workspaceId: "w1",
};
S("AgentView", [
  agentViewFull,
  { ...agentViewFull, agent: null, sessionCwdMatches: true, status: "blocked" },
  { ...agentViewFull, cwd: null, sessionCwdMatches: false, status: "idle" },
  {
    ...agentViewFull,
    sessionId: null,
    sessionKind: "path",
    sessionPath: "/x/y.jsonl",
    status: "done",
  },
  { ...agentViewFull, status: "unknown", sessionCwd: null, sessionCwdMatches: null, title: null },
  { ...agentViewFull, notDeclared: "stripped on decode" },
]);
N("AgentView", [
  { ...agentViewFull, paneId: undefined }, // required missing
  { ...agentViewFull, status: "ready" }, // closed status union
  { ...agentViewFull, focused: null }, // required boolean
  { ...agentViewFull, paneRank: "1" }, // Nullable number: string rejected
  { ...agentViewFull, sessionKind: "reference" }, // literal
  { ...agentViewFull, sessionId: null, sessionPath: undefined, sessionCwdMatches: 3 },
]);

const workspaceViewFull = {
  agentPanes: ["p1"],
  agentStatus: "working",
  checkoutPath: "/Users/x/proj",
  focused: true,
  label: "proj",
  paneCount: 2,
  tabCount: 1,
  workspaceId: "w1",
};
S("WorkspaceView", [
  workspaceViewFull,
  {
    agentPanes: [],
    agentStatus: null,
    checkoutPath: null,
    focused: false,
    label: null,
    paneCount: 1,
    tabCount: 1,
    workspaceId: "w2",
  },
]);
N("WorkspaceView", [
  { ...workspaceViewFull, paneCount: "2" },
  { ...workspaceViewFull, agentStatus: "finished" },
  { ...workspaceViewFull, workspaceId: null },
]);

const ws = { ...workspaceViewFull };
const av = { ...agentViewFull };
S("Overview", [
  { agents: [av], herdrProtocol: 1, herdrVersion: "0.9.3", withoutSession: 0, workspaces: [ws] },
  { agents: [], herdrProtocol: 2, herdrVersion: "1.0.0", withoutSession: 3, workspaces: [] },
]);
N("Overview", [
  { agents: [], herdrProtocol: 1, herdrVersion: "0.9.3", withoutSession: 0 },
  { agents: [], herdrProtocol: "1", herdrVersion: "0.9.3", withoutSession: 0, workspaces: [] },
]);

S("SessionEntry", [
  {
    id: "m1",
    parentId: null,
    raw: '{"kind":"user","text":"x"}',
    timestamp: "2026-10-18T00:00:00.000Z",
    type: "message",
  },
  { raw: "raw-kept-as-is", type: "custom-entry" },
  { parentId: "m0", raw: "x", type: "message" },
  { parentId: null, raw: "x", type: "message" },
]);
N("SessionEntry", [
  { parentId: null, type: "message" }, // raw missing
  { raw: "x", type: 42 },
  { id: "m1", parentId: null, raw: 42, type: "message" },
  { id: null, parentId: "m0", raw: "x", type: "message" }, // optional id is NOT nullable
]);

const session = {
  cause: "vide",
  entries: [],
  incremental: false,
  hasMore: false,
  reset: false,
  sessionPath: "/Users/x/.pi/agent/sessions/2026-10-18.jsonl",
};
S("SessionResponse", [
  { ...session, cause: "absente" },
  { ...session, cause: "vide" },
  { ...session, cause: "invalide" },
  { ...session, cause: "io" },
  {
    ...session,
    cursor: encode({ dev: 0, ino: 0, offset: 8307 }),
    entries: [{ raw: "x", type: "message" }],
    hasMore: true,
    incremental: true,
    previousCursor: encode({ dev: 0, ino: 0, offset: 8100 }),
  },
]);
N("SessionResponse", [
  { ...session, cause: "missing" },
  { entries: [], hasMore: false, incremental: false, reset: false, sessionPath: "/x" }, // cause missing
  { ...session, cursor: 42 },
]);

CURSOR("file cursor", encode({ dev: 48005193, ino: 51397611, offset: 8307 }), true);
CURSOR("legacy sqlite cursor dev/ino 0", encode({ dev: 0, ino: 0, offset: 42 }), true);
CURSOR("extra fields tolerated", encode({ dev: 1, ino: 2, offset: 3, noise: 9 }), true);
CURSOR("negative offset", encode({ dev: 1, ino: 2, offset: -1 }), false);
CURSOR("non-integer offset", encode({ dev: 1, ino: 2, offset: 1.5 }), false);
CURSOR("not an object", Buffer.from("[1,2]", "utf8").toString("base64"), false);
CURSOR("wrong dev type", encode({ dev: "0", ino: 0, offset: 3 }), false);
CURSOR("offset as string", encode({ dev: 0, ino: 0, offset: "3" }), false);
CURSOR("garbage base64", "%%%not-base64%%%", false);
CURSOR("empty string", "", false);
CURSOR("offset zero", encode({ dev: 0, ino: 0, offset: 0 }), true);

S("PromptSent", [
  { confirmation: "confirmed", fingerprint: "9f2c8a31b4d5e6f7091a2b3c4d5e6f70", status: "sent" },
  { confirmation: "unknown", fingerprint: "9f2c8a31b4d5e6f7091a2b3c4d5e6f70", status: "sent" },
]);
N("PromptSent", [
  { confirmation: "applied", fingerprint: "x", status: "sent" },
  { confirmation: "confirmed", fingerprint: "x", status: "suppressed" },
  { confirmation: null, fingerprint: "x", status: "sent" },
  { confirmation: "confirmed", status: "sent" }, // fingerprint missing
]);

S("PromptFailed", [
  { detail: "Herdr n'a pas tranché dans le délai", state: "attente" },
  { detail: "Herdr a refusé l'envoi", state: "erreur" },
  { detail: "seul le transport a répondu", state: "inconnu" },
]);
N("PromptFailed", [
  { detail: "x", state: "timeout" },
  { state: "attente" },
  { detail: "x", state: null },
  { detail: 42, state: "attente" },
]);

S("PromptSuppressed", [{ reason: "consecutive identical send", status: "suppressed" }]);
N("PromptSuppressed", [{ reason: "x", status: "failed" }, {}, { reason: "x", status: null }]);

S("StopAgent", [{ status: "interrupt-sent" }, { status: "not-running" }]);
N("StopAgent", [{ status: "stopped" }, {}]);

S("AgentFocused", [
  { focused: true, status: "agent-focused" },
  { focused: false, status: "agent-focused" },
]);
N("AgentFocused", [
  { focused: false, status: "focused" },
  { focused: null, status: "agent-focused" },
  { status: "agent-focused" },
]);

S("LaunchAgentRequest", [
  { kind: "pi" },
  { kind: "claude", model: "sonnet", thinking: "high" },
  // provider accepted here but documented as never consumed by launch (A14)
  { kind: "codex", model: "o3", name: "revue-1", provider: "openai", thinking: "medium" },
]);
N("LaunchAgentRequest", [
  { model: "o3" },
  { kind: 42 },
  { kind: "pi", thinking: 3 },
  { kind: null, provider: "openai" },
]);

S("LaunchAgent", [
  { kind: "codex", name: "revue-1", paneId: "p9", status: "started", tabId: "t4" },
]);
N("LaunchAgent", [
  { kind: "codex", name: "revue-1", paneId: "p9", status: "running", tabId: "t4" },
  { kind: "codex", name: "revue-1", paneId: "p9", status: "started" }, // tabId missing
]);

S("InstalledKind", [
  { kind: "pi", label: "Pi", state: "current" },
  { kind: "claude", label: "Claude Code", state: "outdated" },
  // state is a free String at the schema level; the current/outdated vocabulary
  // is the documented usage, and not_installed is filtered by launch policy (A06), not rejected by the schema.
  { kind: "pi", label: "Pi", state: "not_installed" },
]);
N("InstalledKind", [
  { kind: "pi", state: "current" }, // label required
  { kind: "pi", label: "Pi" }, // state required
  { kind: 7, label: "Pi", state: "current" },
]);

S("InstalledKinds", [{ kinds: [{ kind: "pi", label: "Pi", state: "current" }] }, { kinds: [] }]);
N("InstalledKinds", [{ kinds: ["pi"] }, {}]);

S("AgentModel", [
  { id: "gpt-5", label: "GPT-5", thinkingLevels: ["low", "medium", "high"] },
  { id: "haiku", thinkingLevels: [] },
]);
N("AgentModel", [
  { label: "no id", thinkingLevels: [] },
  { id: "x", thinkingLevels: ["high"], label: 42 },
  { id: "x", thinkingLevels: null },
  { id: "x", thinkingLevels: [], label: null }, // label optional, not nullable
]);

S("ModelCatalog", [
  { error: null, kind: "cursor", models: [], source: "aucune", thinkingLevels: [] },
  {
    error: null,
    kind: "pi",
    models: [{ id: "gpt-5", label: "GPT-5", thinkingLevels: ["low", "medium", "high"] }],
    source: "pi --list-models",
    thinkingLevels: ["high", "low", "medium"],
  },
  {
    error: "listing unavailable (documented aliases only)",
    kind: "claude",
    models: [],
    source: "claude --help (documented aliases)",
    thinkingLevels: ["high", "low", "medium", "max"],
  },
]);
N("ModelCatalog", [
  { kind: "pi", models: [], source: "x", thinkingLevels: [] }, // error required nullable
  { error: "x", kind: "pi", models: [], source: 42, thinkingLevels: [] },
  { error: null, kind: "pi", models: [], source: "x" }, // thinkingLevels missing
]);

const image = { modifiedAt: 1760000000000, path: "/Users/x/proj/a.png", size: 4096 };
S("RecentImage", [image, { ...image, path: "/x/b.webp", size: 0 }]);
N("RecentImage", [
  { modifiedAt: "2026-10-18", path: "/x/a.png", size: 4096 },
  { modifiedAt: 1760000000000, path: "/x/a.png" },
]);

S("RecentImages", [{ images: [] }, { images: [image] }]);
N("RecentImages", [{}, { images: null }]);

const trustRequired = {
  folder: "proj",
  kind: "codex",
  message: "Cet agent attend la confiance sur ce dossier",
  paneId: "p9",
  status: "trust-required",
};
S("TrustRequired", [trustRequired]);
N("TrustRequired", [
  { ...trustRequired, status: "trust-granted" },
  { ...trustRequired, message: undefined }, // field removed → missing
  { ...trustRequired, folder: null },
]);

S("TrustResolved", [
  { accepted: true, state: "acceptee", status: "trust-resolved" },
  { accepted: false, state: "refusee", status: "trust-resolved" },
  { accepted: false, state: "transmise", status: "trust-resolved" },
  { accepted: false, state: "non-applicable", status: "trust-resolved" },
]);
N("TrustResolved", [
  { accepted: true, status: "trust-resolved" }, // state missing: the C03 baseline defect
  { accepted: true, state: "ok", status: "trust-resolved" },
  { state: "transmise", status: "trust-resolved" },
]);

S("QuestionAnswered", [
  { detail: "1 — oui, valider l'étape", state: "appliquee", status: "question-answered" },
  {
    detail: "frappe envoyée, reprise de preuve nécessaire",
    state: "transmise",
    status: "question-answered",
  },
  { detail: "aucune question lisible à l'écran", state: "refusee", status: "question-answered" },
]);
N("QuestionAnswered", [
  { detail: "x", state: "acceptee", status: "question-answered" },
  { state: "appliquee", status: "question-answered" },
  { detail: "", state: "appliquee", status: "answered" },
]);

S("Choix", [
  { libelle: "Oui", numero: 1, selectionne: false },
  { detail: "envoie les modifications", libelle: "Valider", numero: 2, selectionne: true },
]);
N("Choix", [
  { libelle: "Oui", numero: "1", selectionne: false },
  { libelle: "Oui", numero: 1 },
  { numero: 1, selectionne: false },
  { libelle: "Oui", numero: 1, selectionne: "true" },
]);

const questionFull = {
  choix: [
    { libelle: "Oui", numero: 1, selectionne: false },
    { detail: "d", libelle: "Non", numero: 2, selectionne: true },
  ],
  contexte: ["L'agent a modifié trois fichiers."],
  invite: "Entrée pour valider, ↑/↓ pour choisir",
  texte: "Valider la mise à jour ?",
};
S("Question", [questionFull, { choix: [], contexte: [], texte: "Choisir un dossier" }]);
N("Question", [
  { choix: [], contexte: [] },
  { choix: {}, contexte: [], texte: "x" },
  { ...questionFull, invite: 42 },
]);

const convBase = {
  agent: null,
  name: null,
  paneId: "p1",
  paneRank: null,
  status: "idle",
  sessionState: "absent",
  tabId: "t1",
  tabPaneCount: 1,
  title: "p1",
  workspaceId: "w1",
};
const convWorking = {
  ...convBase,
  agent: "codex",
  branch: "main",
  lastPrompt: "liste les images récentes",
  model: "gpt-5",
  name: "revue-1",
  paneRank: 1,
  preview: "Je vais lister les images.",
  provider: "openai",
  status: "working",
  sessionState: "available",
  tabPaneCount: 2,
  thinking: "medium",
  timestamp: 1760000000000,
  title: "revue-1",
};
S("ConversationSummary", [
  { ...convBase },
  convWorking,
  { ...convBase, status: "blocked", waiting: "  continuation? (y/n) " },
  {
    ...convBase,
    status: "blocked",
    question: {
      choix: [{ libelle: "Oui", numero: 1, selectionne: true }],
      contexte: [],
      texte: "Continuer ?",
    },
  },
  { ...convBase, status: "blocked", trust: trustRequired },
  { ...convBase, status: "done", sessionState: "available", timestamp: 1760000000000 },
  { ...convBase, status: "unknown", sessionState: "error" },
  { ...convBase, status: "blocked" }, // blocked without question/waiting: fields stay absent
]);
N("ConversationSummary", [
  { ...convBase, title: null },
  { ...convBase, status: "done", sessionState: "missing" },
  { ...convBase, preview: 42 },
  { ...convBase, question: { texte: "x" } },
  { ...convBase, timestamp: "2026-10-18" },
]);

S("Conversations", [{ conversations: [] }, { conversations: [convWorking] }]);
N("Conversations", [{}, { conversations: [{}] }]);

S("ApiError", [
  { error: "invalid cursor" },
  { error: "session absent", cause: "absente" },
  { error: "lecture impossible", cause: "io", hint: "permission denied" },
  { error: "lecture impossible", cause: "vide" },
  { error: "curseur illisible", cause: "invalide" },
]);
N("ApiError", [
  { error: "x", cause: "missing-file" },
  { error: "x", cause: null }, // optional literal ≠ null
  { cause: "io" },
]);

S("SessionState", ["available", "absent", "error"]);
N("SessionState", ["unknown", null, "absente", ""]);

S("ReadSource", ["visible", "recent", "recent_unwrapped", "detection"]);
N("ReadSource", ["visible_today", null, "RECENT"]);

// ---------------------------------------------------------------------------
// Upstream herdr-client wire (protocol.ts) — private Rust structs at T012/T013
// ---------------------------------------------------------------------------
const agentSessionInfo = { agent: "codex", kind: "path", source: "value", value: "/x/sess.jsonl" };
S("AgentSessionInfo", [agentSessionInfo, { ...agentSessionInfo, agent: "pi", kind: "id" }]);
N("AgentSessionInfo", [
  { kind: "path", source: "value", value: "/x" }, // agent missing
  { ...agentSessionInfo, kind: "path2" },
]);

const agentInfoFull = {
  agent: "codex",
  agent_session: agentSessionInfo,
  agent_status: "working",
  completion_seq: 12,
  cwd: "/Users/x/proj",
  focused: true,
  foreground_cwd: "/Users/x/proj",
  name: "revue-1",
  pane_id: "p1",
  revision: 0,
  state_change_seq: 3,
  tab_id: "t1",
  terminal_id: "tm1",
  terminal_title: null,
  workspace_id: "w1",
};
const agentInfoMin = {
  agent_status: "idle",
  focused: false,
  pane_id: "p2",
  revision: 0,
  tab_id: "t1",
  terminal_id: "tm2",
  workspace_id: "w1",
};
S("AgentInfo", [agentInfoFull, { ...agentInfoMin, agent: null, name: null, cwd: null }]);
N("AgentInfo", [
  { ...agentInfoMin, pane_id: undefined },
  { ...agentInfoMin, agent_status: "paused" },
  { ...agentInfoMin, revision: "0" },
  { ...agentInfoMin, agent_session: { agent: "pi", kind: "id" } },
]);

const workspaceInfo = {
  active_tab_id: "t1",
  agent_status: "working",
  focused: true,
  label: "proj",
  number: 1,
  pane_count: 2,
  tab_count: 1,
  worktree: {
    checkout_path: "/Users/x/proj",
    is_linked_worktree: true,
    repo_key: "k",
    repo_name: "proj",
    repo_root: "/Users/x/proj",
  },
  workspace_id: "w1",
};
S("WorkspaceInfo", [
  workspaceInfo,
  { ...workspaceInfo, worktree: null, number: null, label: null },
]);
N("WorkspaceInfo", [
  { ...workspaceInfo, workspace_id: undefined },
  { ...workspaceInfo, focused: null },
]);

const worktree = {
  checkout_path: "/Users/x/proj",
  is_linked_worktree: false,
  repo_key: "k",
  repo_name: "proj",
  repo_root: "/Users/x/proj",
};
S("WorkspaceWorktreeInfo", [worktree]);
N("WorkspaceWorktreeInfo", [{ ...worktree, is_linked_worktree: "no" }]);

S("PaneInfo", [{ pane_id: "p5" }, { pane_id: "p5", tab_id: "t1", workspace_id: "w1" }]);
N("PaneInfo", [{ tab_id: "t1" }, { pane_id: 5 }]);

S("HerdrReply", [
  { id: "hr-1" },
  { id: "hr-2", error: { code: "invalid_params", message: "mort" } },
  { id: "hr-3", result: {} },
  { id: "hr-4", result: { agent: { pane_id: "p1" }, type: "agent_prompted" } },
]);
N("HerdrReply", [
  { error: { code: "x", message: "y" } },
  { id: 7 },
  { id: "hr-6", error: { code: "x" } },
]);

S("AgentListPayload", [{ agents: [agentInfoMin] }, { agents: [] }]);
N("AgentListPayload", [{ agents: {} }, {}]);

S("PaneReadPayload", [
  {},
  { read: {} },
  { read: { text: "1. oui…", truncated: true } },
  { read: { truncated: false } },
]);
N("PaneReadPayload", [{ read: null }, { read: { text: 42 } }, { read: { truncated: "true" } }]);

S("PongPayload", [{ protocol: 1, version: "0.9.3" }]);
N("PongPayload", [{ protocol: "1", version: "0.9.3" }, { version: "0.9.3" }]);

S("TabInfo", [
  { label: null, number: 1, tab_id: "t1", workspace_id: "w1" },
  {
    agent_status: "working",
    label: "Terminal",
    number: 2,
    pane_count: 3,
    tab_id: "t1",
    workspace_id: "w1",
  },
  {
    agent_status: null,
    label: "Terminal",
    number: 3,
    pane_count: 1,
    tab_id: "t2",
    workspace_id: "w1",
  },
]);
N("TabInfo", [
  { label: "x", number: 0, tab_id: "t1" },
  { label: "x", number: "0", tab_id: "t1", workspace_id: "w1" },
]);

const snapshotPane = { cwd: "/Users/x/proj", pane_id: "p1", workspace_id: "w1" };
S("SnapshotPane", [snapshotPane, { ...snapshotPane, cwd: null }, { pane_id: "p9" }]);
N("SnapshotPane", [{ ...snapshotPane, pane_id: null }, { cwd: "/x" }]);

const layoutRect = { height: 82, width: 190, x: 0, y: 0 };
S("PaneLayoutRect", [layoutRect]);
N("PaneLayoutRect", [{ ...layoutRect, width: "190" }]);

const layoutPane = { focused: true, pane_id: "p1", rect: layoutRect };
S("PaneLayoutPane", [layoutPane]);
N("PaneLayoutPane", [
  { pane_id: "p1", rect: layoutRect },
  { ...layoutPane, focused: null },
]);

const layout = {
  focused_pane_id: "p1",
  panes: [layoutPane],
  tab_id: "t1",
  workspace_id: "w1",
  zoomed: false,
};
S("PaneLayout", [layout, { ...layout, panes: [] }]);
N("PaneLayout", [
  { ...layout, zoomed: "false" },
  { ...layout, tab_id: null },
]);

const snapshotFull = {
  agents: [agentInfoFull],
  focused_pane_id: "p1",
  focused_tab_id: "t1",
  focused_workspace_id: "w1",
  layouts: [layout],
  panes: [snapshotPane],
  protocol: 1,
  tabs: [{ label: "Terminal", number: 1, tab_id: "t1", workspace_id: "w1" }],
  version: "0.9.3",
  workspaces: [workspaceInfo],
};
S("SnapshotPayload", [
  { agents: [], protocol: 1, version: "0.9.3", workspaces: [] },
  snapshotFull,
  {
    ...snapshotFull,
    layouts: undefined,
    panes: undefined,
    tabs: undefined,
    focused_pane_id: null,
    focused_tab_id: null,
    focused_workspace_id: null,
  },
]);
N("SnapshotPayload", [
  { agents: [], protocol: 1, workspaces: [] }, // version missing
  { agents: "none", protocol: 1, version: "x", workspaces: [] },
]);

// ---------------------------------------------------------------------------
// Inline route bodies (Api.ts) — route-guard provenance
// ---------------------------------------------------------------------------
S("PromptBody", [
  { text: "" },
  { text: "liste les images récentes" },
  { text: "multi\nline", extra: "stripped" },
]);
N("PromptBody", [{}, { text: 42 }, { text: null }]);

S("TrustBody", [{ accept: true }, { accept: false }]);
N("TrustBody", [{}, { accept: "yes" }, { accept: null }]);

S("AnswerBody", [{ numero: 1 }, { numero: 42, texte: "préciser le chemin" }]);
N("AnswerBody", [{}, { numero: "1" }, { texte: "x" }, { numero: 1, texte: null }]);

S("ClientLogBody", [
  { level: "error", message: "décode impossible" },
  { detail: { status: 400 }, level: "error", message: "décode impossible" },
  { detail: [1, 2], level: "error", message: "x" },
]);
N("ClientLogBody", [
  { level: "info", message: "x" },
  { message: "x" },
  { level: "error" },
  { level: "error", message: 42 },
]);

const subscription = {
  endpoint: "https://push.example.com/xyz",
  keys: { auth: "auth-material", p256dh: "p256dh-material" },
};
S("SubscribeBody", [
  subscription,
  { ...subscription, expirationTime: 1760000000000 },
  { ...subscription, expirationTime: null },
]);
N("SubscribeBody", [
  { ...subscription, keys: { auth: "a" } },
  { keys: { auth: "a", p256dh: "b" } },
  { ...subscription, endpoint: undefined },
]);
// https:// prefix enforcement is a route rule beyond the schema (recorded, not schema-verified)
RAW("SubscribeHttpPrefixRule", "Api.ts route rule: endpoint.startsWith('https://') else 400", [
  { endpoint: "http://push.example.com/xyz", keys: { auth: "a", p256dh: "b" } },
]);

S("UnsubscribeBody", [{ unsubscribe: "https://push.example.com/xyz" }]);
N("UnsubscribeBody", [{}, { unsubscribe: 42 }, { endpoint: "https://push.example.com/xyz" }]);

// ---------------------------------------------------------------------------
// Constructed shapes (no baseline decoder; frozen from routing/persistence code)
// ---------------------------------------------------------------------------
RAW("SSE.ready", "routes-events.ts construction (event name → data JSON)", [
  { event: "ready", data: { cursor: 42 } },
]);
RAW("SSE.agent_status", "routes-events.ts construction (event name → data JSON)", [
  { event: "agent_status", data: { from: "idle", kind: "status", paneId: "p1", to: "working" } },
  { event: "agent_status", data: { from: null, kind: "appeared", paneId: "p1", to: "working" } },
  {
    event: "agent_status",
    data: { from: "working", kind: "disappeared", paneId: "p1", to: "gone" },
  },
]);
RAW("SSE.prompt", "routes-events.ts construction (event name → data JSON)", [
  {
    event: "prompt",
    data: { paneId: "p1", status: "sent", fingerprint: "9f2c", confirmation: "confirmed" },
  },
  {
    event: "prompt",
    data: { paneId: "p1", status: "sent", fingerprint: "9f2c", confirmation: "unknown" },
  },
]);
RAW("SSE.prompt-suppressed", "routes-events.ts construction (event name → data JSON)", [
  { event: "prompt-suppressed", data: { paneId: "p1", reason: "consecutive identical send" } },
]);
RAW("SSE.agent-launched", "routes-events.ts construction (event name → data JSON)", [
  { event: "agent-launched", data: { kind: "pi", paneId: "p9", workspaceId: "w1" } },
]);
RAW("SSE.resync", "routes-events.ts construction (event name → data JSON)", [
  { event: "resync", data: { reason: "truncated journal", resumeFrom: 7 } },
]);
RAW(
  "PushStore.legacy",
  "PushNotifications.ts persisted JSON shape (atomic rewrite planned at C14)",
  [
    {
      subscriptions: [
        {
          endpoint: "https://push.example.com/xyz",
          expirationTime: null,
          keys: { auth: "auth-material", p256dh: "p256dh-material" },
        },
      ],
      vapidKeys: {
        privateKey: "synthetic-private-key-material",
        publicKey: "synthetic-public-key-material",
      },
    },
    { subscriptions: [] },
  ],
);
RAW(
  "PushStore.legacy.null-expiration",
  "PushNotifications.ts persistence: omitted expirationTime normalizes to null",
  [
    {
      subscriptions: [
        { endpoint: "https://push.example.com/xyz", keys: { auth: "a", p256dh: "b" } },
      ],
    },
  ],
);
RAW("PushPayload", "PushNotifications.ts payloadDeNotification + deep link", [
  { body: "Agent finished", tag: "done", title: "revue-1", url: "/#/agent/p9" },
]);
RAW(
  "Method.vocabulary",
  "protocol.ts:Method (declared) — runtime uses 13 listed; events.* declared but unused",
  [
    {
      declared: [
        "agent.get",
        "agent.list",
        "agent.prompt",
        "agent.read",
        "agent.send_keys",
        "pane.send_text",
        "agent.focus",
        "agent.start",
        "events.subscribe",
        "events.wait",
        "ping",
        "session.snapshot",
        "tab.close",
        "tab.create",
      ],
      declaredNotUsed: ["events.subscribe", "events.wait"],
    },
  ],
);
RAW("EventWait.supported", "protocol.ts:SUPPORTED_EVENT_WAIT_MATCHES (measured)", [
  ["pane_agent_status_changed"],
]);

// ---------------------------------------------------------------------------
// Executive verification
// ---------------------------------------------------------------------------
let failures = 0;
const checker = Schema.decodeUnknownSync;
for (const s of samples) {
  if (s.verify !== "schema") continue;
  const verifier = verifierOf[s.target];
  if (verifier === undefined) {
    throw new Error(`no registered verifier for schema target '${s.target}'`);
  }
  let accepted = true;
  try {
    checker(verifier)(s.value);
  } catch {
    accepted = false;
  }
  const expected = s.expect === "accept";
  if (accepted !== expected) {
    failures += 1;
    console.error(`MISMATCH ${s.id}: expected ${s.expect}, got ${accepted ? "accept" : "reject"}`);
    console.error("  value:", JSON.stringify(s.value).slice(0, 400));
  }
}
if (failures > 0) {
  console.error(`corpus build failed: ${failures} sample(s) behave differently than expected`);
  process.exit(1);
}

const OUT = new URL("../../../compatibility/contracts/", import.meta.url).pathname;
await Bun.write(
  `${OUT}corpus.json`,
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAtUtc: new Date().toISOString(),
      authority: {
        note: "Verdicts were proven against the current TS contract authority at build time; the corpus itself is data-only and survives the T057 authority switch.",
        publicSchemas: "packages/shared/src/api.ts",
        upstreamWireSchemas: "packages/shared/src/protocol.ts",
        inlineRouteSchemas:
          "apps/server/src/http/Api.ts (PromptBody, TrustBody, AnswerBody, ClientLogBody, SubscribeBody, UnsubscribeBody)",
        cursorCodec: "packages/shared/src/api.ts decodeCursor/encodeCursor",
      },
      counts: {
        total: samples.length,
        positive: samples.filter((s) => s.kind === "positive").length,
        negative: samples.filter((s) => s.kind === "negative").length,
        schemaVerified: samples.filter((s) => s.verify === "schema").length,
        routeGuard: samples.filter((s) => s.verify === "route-guard").length,
        cursor: samples.filter((s) => s.verify === "cursor").length,
        constructed: samples.filter((s) => s.verify === "constructed").length,
      },
      samples,
    },
    null,
    2,
  ) + "\n",
);
console.error(
  `corpus: ${samples.length} samples (schema-verified: ${samples.filter((s) => s.verify === "schema").length}, route-guard: ${samples.filter((s) => s.verify === "route-guard").length}, cursor: ${samples.filter((s) => s.verify === "cursor").length}, constructed: ${samples.filter((s) => s.verify === "constructed").length})`,
);
