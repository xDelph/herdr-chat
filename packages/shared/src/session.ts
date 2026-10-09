/**
 * Sessions Pi — format JSONL, **lecture seule**.
 *
 * Trois pièges mesurés qu'il ne faut jamais oublier :
 *
 * 1. `parentId` est un **branchement de conversation**, pas un sous-agent.
 * 2. Le double horodatage : `entry.timestamp` est une chaîne ISO 8601, mais
 *    `message.timestamp` est un **entier Unix en millisecondes**.
 * 3. `AgentMessage` a **quatre rôles supplémentaires** (`bashExecution`,
 *    `custom`, `branchSummary`, `compactionSummary`) absents du modèle naïf.
 *    `bashExecution` est réellement présent sur cette machine.
 *
 * Aucun chemin d'écriture n'existe dans ce module, volontairement.
 */
import { Schema } from "effect";

/** En-tête, première ligne du fichier. Seule entrée sans `id`/`parentId`. */
export const SessionHeader = Schema.Struct({
  cwd: Schema.String,
  id: Schema.String,
  parentSession: Schema.optional(Schema.String),
  timestamp: Schema.String,
  type: Schema.Literal("session"),
  version: Schema.Number,
});
export type SessionHeader = typeof SessionHeader.Type;

/**
 * Rôles d'`AgentMessage`.
 *
 * Les quatre derniers ne figurent pas dans le modèle évident et cassent un
 * parseur qui les ignore.
 */
export const MessageRole = Schema.Literals([
  "user",
  "assistant",
  "system",
  "toolResult",
  "bashExecution",
  "custom",
  "branchSummary",
  "compactionSummary",
]);
export type MessageRole = typeof MessageRole.Type;

/** Base commune à toute entrée sauf l'en-tête. */
const EntryBase = {
  /** 8 hex « habituellement » — peut retomber sur un UUID complet. */
  id: Schema.String,
  /** Parent **dans l'arbre de conversation**. Jamais un sous-agent. */
  parentId: Schema.NullOr(Schema.String),
  /** Chaîne ISO 8601. Ne pas confondre avec `message.timestamp`. */
  timestamp: Schema.String,
};

/**
 * Entrée de message.
 *
 * `message` est laissé en `Unknown` : la forme exacte dépend du rôle, et un
 * parseur strict perdrait les entrées qu'il ne connaît pas. Le contenu est lu à
 * la demande, jamais invalidé en bloc.
 */
export const MessageEntry = Schema.Struct({
  ...EntryBase,
  type: Schema.Literal("message"),
  message: Schema.Struct({
    role: MessageRole,
    /** Entier Unix en **millisecondes**, contrairement à `entry.timestamp`. */
    timestamp: Schema.optional(Schema.Number),
    toolName: Schema.optional(Schema.String),
    toolCallId: Schema.optional(Schema.String),
    isError: Schema.optional(Schema.Boolean),
  }),
});
export type MessageEntry = typeof MessageEntry.Type;

export const ModelChangeEntry = Schema.Struct({
  ...EntryBase,
  type: Schema.Literal("model_change"),
  modelId: Schema.String,
  provider: Schema.String,
});
export type ModelChangeEntry = typeof ModelChangeEntry.Type;

export const ThinkingLevelChangeEntry = Schema.Struct({
  ...EntryBase,
  type: Schema.Literal("thinking_level_change"),
  thinkingLevel: Schema.String,
});
export type ThinkingLevelChangeEntry = typeof ThinkingLevelChangeEntry.Type;

/**
 * Types d'entrées rencontrés sur les sessions réelles de cette machine,
 * par ordre de fréquence : `message` (9 966), `custom` (406),
 * `thinking_level_change` (91), `model_change` (65), `context_edit` (57),
 * `session` (34), `custom_message` (12), `compaction` (4).
 *
 * `usage`, `context_edit` et `custom` **ne participent pas** au contexte du
 * modèle. `context_edit` modifie le contexte futur sans toucher l'historique
 * brut : lire le JSONL n'est pas équivalent à ce que le modèle a vu.
 */
export const SessionEntryType = Schema.Literals([
  "message",
  "custom",
  "thinking_level_change",
  "model_change",
  "context_edit",
  "session",
  "custom_message",
  "compaction",
  "usage",
  "branch_summary",
  "label",
  "session_info",
]);
export type SessionEntryType = typeof SessionEntryType.Type;

/**
 * Décodage tolérant d'une ligne de session.
 *
 * On ne valide que le strict nécessaire — `type` et les champs de base — et on
 * laisse le reste brut. Une ligne inconnue ne doit pas casser la lecture d'un
 * historique : les formats évoluent et un parseur strict perdrait des données.
 */
export const LooseEntry = Schema.Struct({
  type: Schema.String,
  id: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  timestamp: Schema.optional(Schema.String),
});
export type LooseEntry = typeof LooseEntry.Type;

/**
 * Chemins des sessions.
 *
 * `~/.pi/agent/sessions/--<projet>--/<horodatage>_<session-id>.jsonl`
 *
 * Le slug du projet retire le `/` initial et remplace `/`, `\` et `:` par `-`.
 * On ne déduit **jamais** un chemin : Herdr le fournit via
 * `AgentInfo.agent_session.value` (E1/D008).
 */
export const SESSIONS_ROOT = ".pi/agent/sessions";

/** Transforme un chemin de projet en segment de répertoire de sessions. */
export const projectSlug = (projectPath: string): string =>
  `--${projectPath.replace(/^\//, "").replace(/[/\\:]/g, "-")}--`;
