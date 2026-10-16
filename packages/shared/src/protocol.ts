/**
 * Protocole Herdr — sous-ensemble **vérifié par exécution**.
 *
 * Chaque schéma ici a été validé contre `herdr api schema --json` **et** par
 * appel réel sur le socket. Voir `docs/PROTOCOL.md` §10 : le schéma Herdr
 * n'est pas la source de vérité de son implémentation (19 variantes
 * d'`EventMatch` déclarées, 1 seule implémentée).
 *
 * Ne jamais déduire une capacité du schéma : la mesurer.
 */
import { Schema } from "effect";

/** `idle | working | blocked | done | unknown` — vérifié sur l'énum du schéma. */
export const AgentStatus = Schema.Literals(["idle", "working", "blocked", "done", "unknown"]);
export type AgentStatus = typeof AgentStatus.Type;

/** Source de lecture d'un terminal. */
export const ReadSource = Schema.Literals(["visible", "recent", "recent_unwrapped", "detection"]);
export type ReadSource = typeof ReadSource.Type;

/** `id` ou `path` — `path` est le seul cas observé en pratique (4 agents sur 4). */
export const AgentSessionRefKind = Schema.Literals(["id", "path"]);
export type AgentSessionRefKind = typeof AgentSessionRefKind.Type;

/**
 * Lien Herdr → fichier de session de l'agent.
 *
 * C'est **la** donnée qui évite toute détection de fichier : `kind: "path"`
 * donne un chemin absolu directement exploitable.
 */
export const AgentSessionInfo = Schema.Struct({
  agent: Schema.String,
  kind: AgentSessionRefKind,
  source: Schema.String,
  value: Schema.String,
});
export type AgentSessionInfo = typeof AgentSessionInfo.Type;

/**
 * État d'un agent.
 *
 * Seuls `terminal_id`, `agent_status`, `workspace_id`, `tab_id`, `pane_id`,
 * `focused` et `revision` sont requis par le schéma Herdr. Tout le reste est
 * absent ou nul selon l'instance : `state_labels` et `tokens` étaient absents
 * sur l'instance mesurée, pas vides.
 */
export const AgentInfo = Schema.Struct({
  agent: Schema.optional(Schema.NullOr(Schema.String)),
  agent_session: Schema.optional(Schema.NullOr(AgentSessionInfo)),
  agent_status: AgentStatus,
  completion_seq: Schema.optional(Schema.NullOr(Schema.Number)),
  cwd: Schema.optional(Schema.NullOr(Schema.String)),
  focused: Schema.Boolean,
  foreground_cwd: Schema.optional(Schema.NullOr(Schema.String)),
  /** Nom de l'agent — **unique** entre agents. */
  name: Schema.optional(Schema.NullOr(Schema.String)),
  pane_id: Schema.String,
  revision: Schema.Number,
  state_change_seq: Schema.optional(Schema.Number),
  tab_id: Schema.String,
  terminal_id: Schema.String,
  terminal_title: Schema.optional(Schema.NullOr(Schema.String)),
  workspace_id: Schema.String,
});
export type AgentInfo = typeof AgentInfo.Type;

/**
 * Dossier de travail d'un projet.
 *
 * `checkout_path` est **le** chemin où lancer un agent : c'est le dossier de
 * travail réel, worktree lié compris.
 */
export const WorkspaceWorktreeInfo = Schema.Struct({
  checkout_path: Schema.String,
  is_linked_worktree: Schema.Boolean,
  repo_key: Schema.String,
  repo_name: Schema.String,
  repo_root: Schema.String,
});
export type WorkspaceWorktreeInfo = typeof WorkspaceWorktreeInfo.Type;

/** Un workspace tel que renvoyé dans `session.snapshot`. */
export const WorkspaceInfo = Schema.Struct({
  active_tab_id: Schema.optional(Schema.NullOr(Schema.String)),
  agent_status: Schema.optional(Schema.NullOr(AgentStatus)),
  focused: Schema.optional(Schema.Boolean),
  label: Schema.optional(Schema.NullOr(Schema.String)),
  number: Schema.optional(Schema.NullOr(Schema.Number)),
  pane_count: Schema.optional(Schema.Number),
  tab_count: Schema.optional(Schema.Number),
  worktree: Schema.optional(Schema.NullOr(WorkspaceWorktreeInfo)),
  workspace_id: Schema.String,
});
export type WorkspaceInfo = typeof WorkspaceInfo.Type;

/** Un pane tel que renvoyé par `tab.create` et `pane.split`. */
export const PaneInfo = Schema.Struct({
  pane_id: Schema.String,
  tab_id: Schema.optional(Schema.String),
  workspace_id: Schema.optional(Schema.String),
});
export type PaneInfo = typeof PaneInfo.Type;

/**
 * Photo complète de l'état.
 *
 * `workspaces` est la source de l'écran d'accueil du MVP : il porte déjà
 * `agent_status`, `pane_count`, `tab_count`. Ne pas reconstruire cette vue en
 * itérant `agent.list`.
 */
export const SessionSnapshot = Schema.Struct({
  agents: Schema.Array(AgentInfo),
  focused_pane_id: Schema.optional(Schema.NullOr(Schema.String)),
  focused_tab_id: Schema.optional(Schema.NullOr(Schema.String)),
  focused_workspace_id: Schema.optional(Schema.NullOr(Schema.String)),
  protocol: Schema.Number,
  version: Schema.String,
  workspaces: Schema.Array(WorkspaceInfo),
});
export type SessionSnapshot = typeof SessionSnapshot.Type;

/** Réponse d'erreur du protocole. `code` et `message` sont tous deux requis. */
export const HerdrErrorBody = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});
export type HerdrErrorBody = typeof HerdrErrorBody.Type;

/**
 * Enveloppe de réponse brute.
 *
 * `result.type` est volontairement laissé libre : les 60+ variantes de
 * `ResponseResult` ne sont pas toutes modélisées, et un `type` inconnu ne doit
 * pas faire échouer une réponse valide.
 */
export const HerdrReply = Schema.Struct({
  id: Schema.String,
  error: Schema.optional(HerdrErrorBody),
  /**
   * Le `result` est conservé **entier** : le typer en `Struct({ type })`
   * ferait perdre tous les autres champs au décodage (Effect Schema retire les
   * propriétés non déclarées). On valide donc la forme, pas le contenu.
   */
  result: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type HerdrReply = typeof HerdrReply.Type;

/** Payload d'un `agent.list`. */
export const AgentListPayload = Schema.Struct({
  agents: Schema.Array(AgentInfo),
});
export type AgentListPayload = typeof AgentListPayload.Type;

/**
 * Payload d'une lecture de terminal.
 *
 * Champs optionnels volontairement : une charge utile partielle doit rester
 * exploitable plutôt que faire échouer la lecture (principe « dégradé propre »).
 */
export const PaneReadPayload = Schema.Struct({
  read: Schema.optional(
    Schema.Struct({
      text: Schema.optional(Schema.String),
      truncated: Schema.optional(Schema.Boolean),
    }),
  ),
});
export type PaneReadPayload = typeof PaneReadPayload.Type;

/** Payload d'un `ping` — strict, car `protocol` conditionne tout le reste. */
export const PongPayload = Schema.Struct({
  protocol: Schema.Number,
  version: Schema.String,
});
export type PongPayload = typeof PongPayload.Type;

/**
 * Noms des méthodes utilisées par le MVP.
 *
 * `events.wait` n'accepte **que** `pane_agent_status_changed` sur
 * herdr 0.9.3 — toute autre variante renvoie `unsupported_event_wait_match`.
 */
export const Method = {
  agentGet: "agent.get",
  agentList: "agent.list",
  agentPrompt: "agent.prompt",
  agentRead: "agent.read",
  agentSendKeys: "agent.send_keys",
  /**
   * Écrire du **texte littéral** dans un pane (`{pane_id, text}`).
   *
   * ⚠️ **On ne l'écrit pas par déduction.** Le schéma déclarait 112 méthodes et
   * n'en implémentait pas autant (la leçon du projet : le schéma n'est pas la
   * source de vérité). Mesuré le 2026-10-16 en interrogeant le serveur sur une
   * **cible inexistante** — donc sans aucun effet : l'erreur rendue liste les
   * **103** variantes réellement acceptées, et `pane.send_text` en fait partie.
   * Il n'existe pas de `pane.run` (c'est une commodité du CLI, qui enchaîne
   * `send_text` puis une touche `enter`).
   *
   * ⚠️ Le paramètre s'appelle `pane_id`, pas `target` — contrairement à
   * `agent.send_keys`. Les deux formes cohabitent dans la même API.
   */
  paneSendText: "pane.send_text",
  agentFocus: "agent.focus",
  agentStart: "agent.start",
  eventsSubscribe: "events.subscribe",
  eventsWait: "events.wait",
  ping: "ping",
  sessionSnapshot: "session.snapshot",
  tabClose: "tab.close",
  tabCreate: "tab.create",
} as const;
export type Method = (typeof Method)[keyof typeof Method];

/**
 * Variantes d'`EventMatch` **réellement acceptées** par le serveur.
 *
 * Le schéma en déclare 19 ; le serveur n'en implémente qu'une. Cette liste est
 * la mesure, pas la documentation.
 */
export const SUPPORTED_EVENT_WAIT_MATCHES = ["pane_agent_status_changed"] as const;
