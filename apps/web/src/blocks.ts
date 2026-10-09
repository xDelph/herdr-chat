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
      readonly kind: "bashExecution";
      readonly cancelled: boolean;
      readonly command: string;
      readonly exitCode: number | null;
      readonly output: string;
      readonly truncated: boolean;
    };

/** Un message prêt à afficher. */
export interface RenderedMessage {
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
      blocks: [block],
      id: entry.id ?? "bash",
      meta: {},
      role: "bashExecution",
      text: `${parsed.command}\n${parsed.output ?? ""}`,
    };
  }

  if (entry.type !== "message") return undefined;
  const role = body?.role;
  if (role === undefined) return undefined;

  const isToolResult = role === "toolResult";
  const blocks: ReadonlyArray<Block> = isToolResult
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
