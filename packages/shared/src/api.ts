/**
 * Contrat d'API — **définition unique** des réponses du backend.
 *
 * Ce module existe à cause d'un bug réel : le handler `/api/health` du serveur
 * omettait `reachable` dans sa branche succès, alors que le schéma du client
 * l'exigeait. Le client échouait donc à décoder une réponse valide, et
 * l'interface affichait « Herdr injoignable » — un seul défaut, deux symptômes,
 * et rien pour le détecter.
 *
 * La cause n'était pas le champ oublié : c'était d'avoir **deux définitions du
 * même contrat**, une côté serveur et une côté client, libres de diverger.
 *
 * Désormais : le serveur **produit** selon ces schémas, le client **décode**
 * selon les mêmes, et un test de contrat échoue si l'un des deux s'en écarte.
 */
import { Schema } from "effect";
import { AgentInfo, WorkspaceInfo } from "./protocol.ts";

/** État du backend **et** joignabilité d'Herdr. */
export const HealthResponse = Schema.Struct({
  herdr: Schema.Struct({
    /** Absent quand Herdr est injoignable : on ne prétend pas connaître la version. */
    protocol: Schema.optional(Schema.Number),
    reachable: Schema.Boolean,
    socket: Schema.String,
    version: Schema.optional(Schema.String),
  }),
  ok: Schema.Boolean,
  uptimeMs: Schema.optional(Schema.Number),
});
export type HealthResponse = typeof HealthResponse.Type;

export const AgentViewSchema = Schema.Struct({
  agent: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  focused: Schema.Boolean,
  paneId: Schema.String,
  parentSession: Schema.NullOr(Schema.String),
  sessionCwd: Schema.NullOr(Schema.String),
  /** `null` = non vérifiable, volontairement distinct de `false`. */
  sessionCwdMatches: Schema.NullOr(Schema.Boolean),
  sessionId: Schema.NullOr(Schema.String),
  sessionKind: Schema.NullOr(Schema.Literals(["id", "path"])),
  sessionPath: Schema.NullOr(Schema.String),
  status: Schema.String,
  tabId: Schema.String,
  title: Schema.NullOr(Schema.String),
  workspaceId: Schema.String,
});
export type AgentView = typeof AgentViewSchema.Type;

export const WorkspaceViewSchema = Schema.Struct({
  agentStatus: Schema.NullOr(Schema.String),
  focused: Schema.Boolean,
  label: Schema.NullOr(Schema.String),
  paneCount: Schema.Number,
  tabCount: Schema.Number,
  workspaceId: Schema.String,
});
export type WorkspaceView = typeof WorkspaceViewSchema.Type;

export const OverviewResponse = Schema.Struct({
  agents: Schema.Array(AgentViewSchema),
  herdrProtocol: Schema.Number,
  herdrVersion: Schema.String,
  withoutSession: Schema.Number,
  workspaces: Schema.Array(WorkspaceViewSchema),
});
export type OverviewResponse = typeof OverviewResponse.Type;

export const SessionEntrySchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  raw: Schema.String,
  timestamp: Schema.optional(Schema.String),
  type: Schema.String,
});
export type SessionEntry = typeof SessionEntrySchema.Type;

export const SessionResponse = Schema.Struct({
  entries: Schema.Array(SessionEntrySchema),
  offset: Schema.Number,
  sessionPath: Schema.String,
});
export type SessionResponse = typeof SessionResponse.Type;

export const TerminalResponse = Schema.Struct({
  text: Schema.String,
  truncated: Schema.Boolean,
});
export type TerminalResponse = typeof TerminalResponse.Type;

/** Envoi confirmé. `confirmation` vient du serveur, pas du client. */
export const PromptSentResponse = Schema.Struct({
  confirmation: Schema.Literals(["confirmed", "unknown"]),
  fingerprint: Schema.String,
  status: Schema.Literal("sent"),
});
export type PromptSentResponse = typeof PromptSentResponse.Type;

/** Double envoi supprimé — **un état normal, pas une erreur**. */
export const PromptSuppressedResponse = Schema.Struct({
  reason: Schema.String,
  status: Schema.Literal("suppressed"),
});
export type PromptSuppressedResponse = typeof PromptSuppressedResponse.Type;

/** Erreur d'API. */
export const ApiErrorResponse = Schema.Struct({
  error: Schema.String,
  hint: Schema.optional(Schema.String),
});
export type ApiErrorResponse = typeof ApiErrorResponse.Type;

/** Vue du snapshot Herdr telle que consommée par le serveur. */
export const SnapshotPayload = Schema.Struct({
  agents: Schema.Array(AgentInfo),
  protocol: Schema.Number,
  version: Schema.String,
  workspaces: Schema.Array(WorkspaceInfo),
});
export type SnapshotPayload = typeof SnapshotPayload.Type;
