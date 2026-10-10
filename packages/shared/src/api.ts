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
  /** Libellé humain de l'onglet, quand Herdr en fournit un. */
  tabLabel: Schema.NullOr(Schema.String),
  tabId: Schema.String,
  tabNumber: Schema.NullOr(Schema.Number),
  title: Schema.NullOr(Schema.String),
  /** Libellé humain du projet. `null` = nom par défaut côté Herdr. */
  workspaceLabel: Schema.NullOr(Schema.String),
  workspaceId: Schema.String,
});
export type AgentView = typeof AgentViewSchema.Type;

export const WorkspaceViewSchema = Schema.Struct({
  /** Panes d'agents de ce projet, pour savoir s'il y en a déjà un. */
  agentPanes: Schema.Array(Schema.String),
  agentStatus: Schema.NullOr(Schema.String),
  /**
   * Chemin du projet. Vient du dossier de travail (`checkout_path`) : c'est
   * **là** qu'un nouvel agent doit démarrer. Sans lui, impossible de lancer
   * un agent sans demander le chemin à la main.
   */
  checkoutPath: Schema.NullOr(Schema.String),
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
  /** `true` quand seule la suite a été renvoyée (mode `?since=`). */
  incremental: Schema.Boolean,
  /** Offset à renvoyer au prochain appel pour ne recevoir que le nouveau. */
  offset: Schema.Number,
  sessionPath: Schema.String,
  /** `true` quand les entrées précédentes existent mais n'ont pas été renvoyées. */
  truncated: Schema.Boolean,
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

/** Demande de lancement d'un agent dans un projet. */
export const LaunchAgentRequest = Schema.Struct({
  /** Type d'agent, tel que Herdr le connaît (`pi`, `claude`, `codex`…). */
  kind: Schema.String,
  name: Schema.optional(Schema.String),
});
export type LaunchAgentRequest = typeof LaunchAgentRequest.Type;

export const LaunchAgentResponse = Schema.Struct({
  kind: Schema.String,
  name: Schema.String,
  /** Pane dans lequel l'agent a été lancé. */
  paneId: Schema.String,
  status: Schema.Literal("started"),
  tabId: Schema.String,
});
export type LaunchAgentResponse = typeof LaunchAgentResponse.Type;

/** Un type d'agent **réellement installé** sur la machine. */
export const InstalledKind = Schema.Struct({
  /** Valeur à passer à `agent.start`. */
  kind: Schema.String,
  /** Libellé lisible. */
  label: Schema.String,
  /** `current` ou `outdated` — les deux fonctionnent. */
  state: Schema.String,
});
export type InstalledKind = typeof InstalledKind.Type;

export const InstalledKindsResponse = Schema.Struct({
  kinds: Schema.Array(InstalledKind),
});
export type InstalledKindsResponse = typeof InstalledKindsResponse.Type;

/** Types d'agents que Herdr sait démarrer (liste `herdr agent start --kind`). */
export const AGENT_KINDS = [
  "pi",
  "claude",
  "codex",
  "gemini",
  "cursor",
  "opencode",
  "copilot",
  "droid",
  "amp",
  "grok",
  "hermes",
] as const;

export const RecentImageSchema = Schema.Struct({
  modifiedAt: Schema.Number,
  path: Schema.String,
  size: Schema.Number,
});
export type RecentImage = typeof RecentImageSchema.Type;

export const RecentImagesResponse = Schema.Struct({
  images: Schema.Array(RecentImageSchema),
});
export type RecentImagesResponse = typeof RecentImagesResponse.Type;

/** Erreur d'API. */
export const ApiErrorResponse = Schema.Struct({
  error: Schema.String,
  hint: Schema.optional(Schema.String),
});
export type ApiErrorResponse = typeof ApiErrorResponse.Type;

/** Un onglet Herdr. `label` et `number` sont toujours présents côté Herdr. */
export const TabInfo = Schema.Struct({
  agent_status: Schema.optional(Schema.NullOr(Schema.String)),
  label: Schema.NullOr(Schema.String),
  number: Schema.Number,
  pane_count: Schema.optional(Schema.Number),
  tab_id: Schema.String,
  workspace_id: Schema.String,
});
export type TabInfo = typeof TabInfo.Type;

/**
 * Un pane du snapshot.
 *
 * `cwd` est **la** source du dossier de travail d'un projet : `worktree` est
 * souvent absent, alors que chaque pane en porte un.
 */
export const SnapshotPane = Schema.Struct({
  cwd: Schema.optional(Schema.NullOr(Schema.String)),
  pane_id: Schema.String,
  workspace_id: Schema.optional(Schema.String),
});
export type SnapshotPane = typeof SnapshotPane.Type;

/** Vue du snapshot Herdr telle que consommée par le serveur. */
export const SnapshotPayload = Schema.Struct({
  agents: Schema.Array(AgentInfo),
  panes: Schema.optional(Schema.Array(SnapshotPane)),
  protocol: Schema.Number,
  tabs: Schema.optional(Schema.Array(TabInfo)),
  version: Schema.String,
  workspaces: Schema.Array(WorkspaceInfo),
});
export type SnapshotPayload = typeof SnapshotPayload.Type;
