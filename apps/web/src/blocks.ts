/**
 * Analyse des messages d'une session Pi en **modèle d'affichage typé**.
 *
 * Ce module ne dessine rien : il transforme une ligne JSONL en une structure
 * que l'interface sait rendre. Séparé du composant, il est **testable** — c'est
 * la leçon des défauts précédents (une logique d'affichage encastrée ne se
 * vérifie qu'en ouvrant l'application).
 *
 * Les formes proviennent de la documentation Pi (`message-types.md`) **et** d'un
 * census des sessions réelles, qui a donné la répartition utile :
 *
 * | Bloc | Occurrences |
 * |---|---|
 * | `text` | 8 343 |
 * | `toolCall` | 5 663 |
 * | `thinking` | 3 218 |
 * | `image` | 49 |
 *
 * Les outils réellement rencontrés sont `bash` (3 964), `edit` (801),
 * `read` (499), `write` (372), `todo` (19), `subagent` (9).
 */
import { Option, Schema } from "effect";

// ---------------------------------------------------------------------------
// Blocs de contenu
// ---------------------------------------------------------------------------

export type Block =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly redacted: boolean; readonly thinking: string }
  | {
      readonly kind: "toolCall";
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly id: string;
      readonly name: string;
    }
  | { readonly kind: "image"; readonly data: string; readonly mimeType: string }
  | {
      readonly kind: "toolResult";
      readonly images: ReadonlyArray<{ readonly data: string; readonly mimeType: string }>;
      readonly isError: boolean;
      readonly text: string;
      readonly toolName: string;
    }
  | {
      readonly kind: "subagent";
      readonly mode: string;
      readonly results: ReadonlyArray<SubagentResult>;
    }
  | {
      /** Le contexte a été résumé : c'est un point de reprise, pas un message. */
      readonly kind: "compaction";
      readonly firstKeptEntryId: string | null;
      readonly summary: string;
      readonly tokensBefore: number | null;
    }
  | {
      readonly kind: "bashExecution";
      readonly cancelled: boolean;
      readonly command: string;
      readonly exitCode: number | null;
      readonly output: string;
      readonly truncated: boolean;
    };

/**
 * Résultat d'un sous-agent, tel que Pi le rapporte.
 *
 * ⚠️ `status` et `digest.status` peuvent **diverger** : un sous-agent marqué
 * `failed` peut porter un digest `ok`. Les deux sont vrais, et l'interface les
 * affiche tous les deux plutôt que d'en choisir un.
 */
export interface SubagentResult {
  readonly agent: string;
  readonly digest: {
    readonly filesChanged: ReadonlyArray<string>;
    readonly questions: string | null;
    readonly status: string | null;
    readonly summary: string | null;
    readonly verified: string | null;
  } | null;
  readonly errorMessage: string | null;
  readonly exitCode: number | null;
  readonly id: string;
  readonly model: string | null;
  readonly status: string;
  readonly stopReason: string | null;
}

/** Un message prêt à afficher. */
export interface RenderedMessage {
  /** Horodatage de l'entrée, quand la source en fournit un. */
  readonly at: string | null;
  readonly blocks: ReadonlyArray<Block>;
  readonly id: string;
  /** `model`, `usage`, `stopReason`… quand la source les fournit. */
  readonly meta: Readonly<Record<string, string>>;
  readonly role: string;
  /** Texte brut concaténé : recherche, aperçu, repli. */
  readonly text: string;
}

// ---------------------------------------------------------------------------
// Schémas de décodage
// ---------------------------------------------------------------------------

const TextBlock = Schema.Struct({ text: Schema.String, type: Schema.Literal("text") });

const ThinkingBlock = Schema.Struct({
  redacted: Schema.optional(Schema.Boolean),
  thinking: Schema.optional(Schema.String),
  type: Schema.Literal("thinking"),
});

const ToolCallBlock = Schema.Struct({
  arguments: Schema.optional(Schema.Unknown),
  id: Schema.optional(Schema.String),
  name: Schema.String,
  type: Schema.Literal("toolCall"),
});

const ImageBlockSchema = Schema.Struct({
  data: Schema.String,
  mimeType: Schema.String,
  type: Schema.Literal("image"),
});

/** Union discriminée par `type` : un bloc inconnu est ignoré, pas fatal. */
const AnyBlock = Schema.Union([TextBlock, ThinkingBlock, ToolCallBlock, ImageBlockSchema]);

const MessageBody = Schema.Struct({
  content: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean),
  model: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  stopReason: Schema.optional(Schema.String),
  toolName: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      cost: Schema.optional(Schema.Struct({ total: Schema.optional(Schema.Number) })),
      totalTokens: Schema.optional(Schema.Number),
    }),
  ),
});

const SubagentDigest = Schema.Struct({
  filesChanged: Schema.optional(Schema.Array(Schema.String)),
  questions: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  verified: Schema.optional(Schema.NullOr(Schema.String)),
});

const SubagentResultSchema = Schema.Struct({
  agent: Schema.optional(Schema.String),
  digest: Schema.optional(Schema.NullOr(SubagentDigest)),
  errorMessage: Schema.optional(Schema.NullOr(Schema.String)),
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
  id: Schema.optional(Schema.String),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.String),
  stopReason: Schema.optional(Schema.NullOr(Schema.String)),
});

const SubagentDetails = Schema.Struct({
  mode: Schema.optional(Schema.String),
  results: Schema.optional(Schema.Array(SubagentResultSchema)),
});

const Compaction = Schema.Struct({
  firstKeptEntryId: Schema.optional(Schema.NullOr(Schema.String)),
  summary: Schema.optional(Schema.String),
  tokensBefore: Schema.optional(Schema.NullOr(Schema.Number)),
});

const BashExecution = Schema.Struct({
  cancelled: Schema.optional(Schema.Boolean),
  command: Schema.String,
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
  output: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Boolean),
});

const SessionLine = Schema.Struct({
  message: Schema.optional(MessageBody),
  type: Schema.optional(Schema.String),
});

const decodeSessionLine = Schema.decodeUnknownOption(SessionLine);
const decodeBlock = Schema.decodeUnknownOption(AnyBlock);
const decodeBash = Schema.decodeUnknownOption(BashExecution);
const decodeCompaction = Schema.decodeUnknownOption(Compaction);

/** Extrait les images d'un contenu, sans passer par un bloc texte. */
const imagesOf = (content: unknown): ReadonlyArray<{ data: string; mimeType: string }> => {
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    const decoded = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Struct({ data: Schema.String, mimeType: Schema.String }))(
        item,
      ),
    );
    return decoded === undefined ? [] : [decoded];
  });
};

const decodeSubagentDetails = Schema.decodeUnknownOption(SubagentDetails);

/**
 * Analyse les détails d'un résultat de sous-agent.
 *
 * Retourne `undefined` si ce n'est pas un résultat de sous-agent exploitable :
 * l'appelant retombe alors sur l'affichage générique, jamais sur un vide.
 */
export const toSubagent = (
  details: unknown,
): { readonly mode: string; readonly results: ReadonlyArray<SubagentResult> } | undefined => {
  const decoded = Option.getOrUndefined(decodeSubagentDetails(details));
  if (decoded === undefined || decoded.results === undefined || decoded.results.length === 0) {
    return undefined;
  }
  return {
    mode: decoded.mode ?? "single",
    results: decoded.results.map((result) => ({
      agent: result.agent ?? "agent",
      digest:
        result.digest === undefined || result.digest === null
          ? null
          : {
              filesChanged: result.digest.filesChanged ?? [],
              questions: result.digest.questions ?? null,
              status: result.digest.status ?? null,
              summary: result.digest.summary ?? null,
              verified: result.digest.verified ?? null,
            },
      errorMessage: result.errorMessage ?? null,
      exitCode: result.exitCode ?? null,
      id: result.id ?? "sa",
      model: result.model ?? null,
      status: result.status ?? "inconnu",
      stopReason: result.stopReason ?? null,
    })),
  };
};

/** Convertit un contenu en texte, quel que soit son emballage. */
export const contentToText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const text = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Struct({ text: Schema.String }))(item),
      );
      return text?.text ?? "";
    })
    .join("");
};

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

/**
 * Analyse les blocs de contenu d'un message.
 *
 * Un bloc dont la forme est inconnue est **ignoré** plutôt que de faire échouer
 * tout le message : les fournisseurs ajoutent des types, et perdre une réponse
 * entière pour un bloc non reconnu serait pire que de ne pas l'afficher.
 */
export const toBlocks = (content: unknown): ReadonlyArray<Block> => {
  if (typeof content === "string") {
    return content.trim().length === 0 ? [] : [{ kind: "text", text: content }];
  }
  if (!Array.isArray(content)) return [];

  return content.flatMap((item): Block[] => {
    const decoded = Option.getOrUndefined(decodeBlock(item));
    if (decoded === undefined) return [];

    switch (decoded.type) {
      case "text":
        return decoded.text.trim().length === 0 ? [] : [{ kind: "text", text: decoded.text }];

      case "thinking": {
        const thinking = decoded.thinking ?? "";
        const redacted = decoded.redacted === true;
        // Un bloc masqué n'a pas de texte visible : on l'annonce sans inventer.
        if (thinking.trim().length === 0 && !redacted) return [];
        return [{ kind: "thinking", redacted, thinking }];
      }

      case "toolCall": {
        const args =
          Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(
              decoded.arguments,
            ),
          ) ?? {};
        return [
          {
            arguments: args,
            id: decoded.id ?? decoded.name,
            kind: "toolCall",
            name: decoded.name,
          },
        ];
      }

      case "image":
        return [{ data: decoded.data, kind: "image", mimeType: decoded.mimeType }];

      default:
        // Un type de bloc inconnu est ignoré : les fournisseurs en ajoutent, et
        // perdre un message entier pour un bloc non reconnu serait pire.
        return [];
    }
  });
};

/** Lit `message.details` d'une ligne brute — le seul champ non modélisé. */
const rawDetailsOf = (raw: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const message = (parsed as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) return undefined;
    return (message as { details?: unknown }).details;
  } catch {
    return undefined;
  }
};

/** Construit les métadonnées affichables d'un message, sans rien inventer. */
const metaOf = (body: typeof MessageBody.Type | undefined): Readonly<Record<string, string>> => {
  if (body === undefined) return {};
  const meta: Record<string, string> = {};
  if (body.model !== undefined) meta["model"] = body.model;
  if (body.stopReason !== undefined) meta["stopReason"] = body.stopReason;
  if (body.usage?.totalTokens !== undefined) meta["tokens"] = String(body.usage.totalTokens);
  const cost = body.usage?.cost?.total;
  if (cost !== undefined) meta["cost"] = cost.toFixed(4);
  return meta;
};

/**
 * Analyse **puis** décode une ligne brute de session.
 *
 * ⚠️ Les deux étapes sont indispensables : passer la chaîne brute à un schéma
 * qui attend un objet renvoie `None` **sans rien signaler** — c'est le défaut
 * qui a vidé la conversation pendant plusieurs itérations.
 */
export const decodeRawLine = (raw: string): typeof SessionLine.Type | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(decodeSessionLine(parsed));
};

/**
 * Transforme une entrée de session en message affichable.
 *
 * Retourne `undefined` pour tout ce qui n'est pas un message, ou pour un message
 * sans rien à montrer.
 */
export const toRenderedMessage = (entry: {
  readonly id?: string | undefined;
  readonly raw: string;
  readonly timestamp?: string | undefined;
  readonly type: string;
}): RenderedMessage | undefined => {
  const line = decodeRawLine(entry.raw);
  if (line === undefined) return undefined;

  const body = line.message;

  // Exécution directe de shell : ce n'est pas un résultat d'outil du modèle.
  if (entry.type === "message" && body?.role === "bashExecution") {
    const parsed = (() => {
      try {
        return Option.getOrUndefined(decodeBash(JSON.parse(entry.raw)?.message));
      } catch {
        return undefined;
      }
    })();
    if (parsed === undefined) return undefined;
    const block: Block = {
      cancelled: parsed.cancelled === true,
      command: parsed.command,
      exitCode: parsed.exitCode ?? null,
      kind: "bashExecution",
      output: parsed.output ?? "",
      truncated: parsed.truncated === true,
    };
    return {
      at: entry.timestamp ?? null,
      blocks: [block],
      id: entry.id ?? "bash",
      meta: {},
      role: "bashExecution",
      text: `${parsed.command}\n${parsed.output ?? ""}`,
    };
  }

  // Le compactage n'est pas un message : c'est le point où le contexte a été
  // résumé. Sur une session longue, c'est une information d'orientation.
  if (entry.type === "compaction") {
    const parsed = (() => {
      try {
        return Option.getOrUndefined(decodeCompaction(JSON.parse(entry.raw)));
      } catch {
        return undefined;
      }
    })();
    if (parsed === undefined) return undefined;
    const summary = parsed.summary ?? "";
    return {
      at: entry.timestamp ?? null,
      blocks: [
        {
          firstKeptEntryId: parsed.firstKeptEntryId ?? null,
          kind: "compaction",
          summary,
          tokensBefore: parsed.tokensBefore ?? null,
        },
      ],
      id: entry.id ?? "compaction",
      meta: {},
      role: "compaction",
      text: summary,
    };
  }

  if (entry.type !== "message") return undefined;
  const role = body?.role;
  if (role === undefined) return undefined;

  const isToolResult = role === "toolResult";

  // Un résultat de sous-agent porte une structure riche : on l'affiche comme
  // telle plutôt que de déverser sa sortie brute.
  const subagent = isToolResult ? toSubagent(rawDetailsOf(entry.raw)) : undefined;

  const blocks: ReadonlyArray<Block> =
    subagent !== undefined
      ? [{ kind: "subagent", mode: subagent.mode, results: subagent.results }]
      : isToolResult
        ? [
            {
              images: imagesOf(body?.content),
              isError: body?.isError === true,
              kind: "toolResult",
              text: contentToText(body?.content),
              toolName: body?.toolName ?? "outil",
            },
          ]
        : toBlocks(body?.content);

  if (blocks.length === 0) return undefined;

  return {
    at: entry.timestamp ?? null,
    blocks,
    id: entry.id ?? `${role}:${contentToText(body?.content).slice(0, 24)}`,
    meta: metaOf(body),
    role,
    text: blocks
      .map((block) => blockToText(block))
      .join("\n")
      .trim(),
  };
};

/** Texte cherchable d'un bloc — sert à l'aperçu et à la recherche. */
export const blockToText = (block: Block): string => {
  switch (block.kind) {
    case "text":
      return block.text;
    case "thinking":
      return block.thinking;
    case "image":
      return "[image]";
    case "bashExecution":
      return `${block.command}\n${block.output}`;
    case "toolResult":
      return block.text;
    case "toolCall":
      return `[${block.name}]`;
    case "subagent":
      return block.results.map((result) => result.digest?.summary ?? "").join("\n");
    case "compaction":
      return block.summary;
    default:
      return "";
  }
};

/** Transforme les entrées d'une session en messages affichables. */
export const toMessages = (
  entries: ReadonlyArray<{
    readonly id?: string | undefined;
    readonly raw: string;
    readonly type: string;
  }>,
): ReadonlyArray<RenderedMessage> =>
  entries.flatMap((entry) => {
    const message = toRenderedMessage(entry);
    return message === undefined ? [] : [message];
  });

// ---------------------------------------------------------------------------
// Regroupement des appels d'outils
// ---------------------------------------------------------------------------

/** Un élément de la conversation : soit un message, soit un groupe d'outils. */
export type Item =
  | { readonly kind: "single"; readonly message: RenderedMessage }
  | {
      readonly kind: "tools";
      readonly id: string;
      readonly messages: ReadonlyArray<RenderedMessage>;
      /** Outils utilisés, avec leur nombre — pour un résumé lisible. */
      readonly tools: ReadonlyArray<{ readonly name: string; readonly count: number }>;
      /** `true` si un résultat du groupe est en échec. */
      readonly hasError: boolean;
      readonly callCount: number;
    };

/** `true` si tous les blocs d'un message sont des appels ou des résultats d'outil. */
const isToolOnly = (message: RenderedMessage): boolean =>
  message.role === "toolResult" ||
  (message.role === "assistant" &&
    message.blocks.length > 0 &&
    message.blocks.every((block) => block.kind === "toolCall"));

const toolNamesOf = (
  messages: ReadonlyArray<RenderedMessage>,
): { name: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === "toolCall") {
        counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
      } else if (block.kind === "toolResult") {
        counts.set(block.toolName, (counts.get(block.toolName) ?? 0) + 1);
      } else if (block.kind === "subagent") {
        counts.set("subagent", (counts.get("subagent") ?? 0) + 1);
      }
    }
  }
  // `toSorted` : `sort` mute le tableau, ce qui produirait des effets de bord
  // sur une valeur dérivée.
  return [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .toSorted((a, b) => b.count - a.count);
};

const hasErrorIn = (messages: ReadonlyArray<RenderedMessage>): boolean =>
  messages.some((message) =>
    message.blocks.some((block) => block.kind === "toolResult" && block.isError),
  );

/**
 * Regroupe les messages **consécutifs** qui ne contiennent que des outils.
 *
 * Une session réelle alterne `assistant(toolCall)` → `toolResult` sur des
 * centaines de tours. Les afficher un par un noie complètement les décisions et
 * les réponses. On les réunit sous un résumé — « bash ×3, edit ×2 » — que l'on
 * peut déplier.
 *
 * ⚠️ Un groupe contenant une **erreur** est signalé comme tel, et l'interface le
 * déplie par défaut : masquer un échec derrière un résumé serait trompeur.
 *
 * Un groupe de **un seul** message n'est pas créé : cela n'apporterait rien.
 */
export const toItems = (messages: ReadonlyArray<RenderedMessage>): ReadonlyArray<Item> => {
  const items: Item[] = [];
  let run: RenderedMessage[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1 && run[0] !== undefined) {
      items.push({ kind: "single", message: run[0] });
    } else {
      items.push({
        callCount: run.length,
        hasError: hasErrorIn(run),
        id: `tools:${run[0]?.id ?? "?"}:${String(run.length)}`,
        kind: "tools",
        messages: run,
        tools: toolNamesOf(run),
      });
    }
    run = [];
  };

  for (const message of messages) {
    if (isToolOnly(message)) {
      run.push(message);
      continue;
    }
    flush();
    items.push({ kind: "single", message });
  }
  flush();

  return items;
};

// ---------------------------------------------------------------------------
// Question en attente
// ---------------------------------------------------------------------------

/**
 * Dernier texte produit par l'agent.
 *
 * C'est ce qu'il faut afficher quand un agent passe en `blocked` : il attend une
 * réponse, et cette réponse est presque toujours la dernière chose qu'il a
 * écrite. Le chercher dans la session évite d'inventer un résumé.
 *
 * Retourne `undefined` s'il n'y a aucun texte — un agent peut bloquer sans rien
 * avoir dit, et dans ce cas on ne prétend pas savoir ce qu'il demande.
 */
export const lastAssistantText = (messages: ReadonlyArray<RenderedMessage>): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.role !== "assistant") continue;
    const text = message.blocks
      .filter((block): block is Extract<Block, { kind: "text" }> => block.kind === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (text.length > 0) return text;
  }
  return undefined;
};

/** Résumé d'une session : ce qui demande une action, et ce qui a été fait. */
export interface SessionDigest {
  /** Nombre d'appels d'outil, tous types confondus. */
  readonly toolCalls: number;
  /** Fichiers touchés, dédupliqués, dans l'ordre d'apparition. */
  readonly files: ReadonlyArray<string>;
  readonly compactions: number;
  readonly subagents: number;
}

/** Agrège ce qu'un agent a fait, sans relire les messages un par un. */
export const digestOf = (messages: ReadonlyArray<RenderedMessage>): SessionDigest => {
  const files = new Set<string>();
  let toolCalls = 0;
  let compactions = 0;
  let subagents = 0;

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === "compaction") compactions += 1;
      if (block.kind === "subagent") subagents += block.results.length;
      if (block.kind === "toolCall") {
        toolCalls += 1;
        entriesOf(block).forEach((path) => files.add(path));
      }
    }
  }

  return { compactions, files: [...files], subagents, toolCalls };
};

/**
 * Chemins touchés par un appel d'outil.
 *
 * On ne retient que les outils qui **écrivent** — `edit`, `write` — plus les
 * **lectures d'image**, dont le contenu mérite d'être revu. Un `read` de code
 * n'a pas à gonfler la liste des fichiers « touchés ».
 */
const entriesOf = (block: Extract<Block, { kind: "toolCall" }>): string[] => {
  const path = block.arguments["path"];
  if (typeof path !== "string") return [];
  if (block.name === "edit" || block.name === "write") return [path];
  return [];
};
