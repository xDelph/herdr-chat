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
import { estPendantTour, rapportDe, type RapportDeTache } from "./taches.ts";

// ---------------------------------------------------------------------------
// Blocs de contenu
// ---------------------------------------------------------------------------

export type Block =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "thinking";
      readonly redacted: boolean;
      readonly thinking: string;
    }
  | {
      readonly kind: "toolCall";
      readonly arguments: Readonly<Record<string, unknown>>;
      readonly id: string;
      readonly name: string;
    }
  | { readonly kind: "image"; readonly data: string; readonly mimeType: string }
  /** Image **désignée par un chemin** : affichée en ligne, pas un lien. */
  | { readonly kind: "imagePath"; readonly path: string }
  /** Image désignée par une **URL** : rendue en ligne elle aussi. */
  | { readonly kind: "imageUrl"; readonly url: string }
  | {
      readonly kind: "toolResult";
      readonly images: ReadonlyArray<{
        readonly data: string;
        readonly mimeType: string;
      }>;
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
    }
  /** Ce que le harnais de l'agent a écrit (rapport de sous-agent, fin de tâche). */
  | RapportDeTache;

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

const TextBlock = Schema.Struct({
  text: Schema.String,
  type: Schema.Literal("text"),
});

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
  cancelled: Schema.optional(Schema.Boolean),
  content: Schema.optional(Schema.Unknown),
  command: Schema.optional(Schema.String),
  /** La sorte d'un message `custom` (forme pi) — harnais de l'agent. */
  customType: Schema.optional(Schema.String),
  /** Détails structurés (`custom`), et `midTurn` (arrivé pendant un tour). */
  details: Schema.optional(Schema.Unknown),
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
  isError: Schema.optional(Schema.Boolean),
  model: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  stopReason: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Boolean),
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

/*
  ⚠️ **Les propriétés excédentaires sont IGNORÉES, et c'est vital.** Une ligne de
  session normalisée par le backend porte des champs qui ne sont pas dans le
  schéma (`phase`, `isError`, `toolName`, `exitCode`…) selon la famille d'agent.
  Avec le décodage strict par défaut, **une seule clé en trop faisait échouer
  tout le message** — et le fil entier disparaissait, sans erreur : la session
  opencode de 229 messages s'affichait « No messages ».
*/
const decodeSessionLine = Schema.decodeUnknownOption(SessionLine, {
  onExcessProperty: "ignore",
});
const decodeBlock = Schema.decodeUnknownOption(AnyBlock);
const decodeBash = Schema.decodeUnknownOption(BashExecution);
const decodeCompaction = Schema.decodeUnknownOption(Compaction);

/** Normalise les arguments Codex : ils arrivent souvent comme une chaîne JSON. */
const toolArgumentsOf = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      const object = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(parsed),
      );
      if (object !== undefined) return object;
      if (Array.isArray(parsed) && parsed.every((part) => typeof part === "string"))
        return { argv: parsed };
    } catch {
      // Codex `exec` may provide the shell script directly, not as JSON.
    }
    return { command: value };
  }
  return (
    Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(value),
    ) ?? {}
  );
};

export interface PatchFileChange {
  readonly kind: "add" | "delete" | "update";
  readonly path: string;
  readonly edits: ReadonlyArray<{
    readonly newText: string;
    readonly oldText: string;
  }>;
}

/** Commande shell portée par un appel Codex, sous ses différentes formes. */
export const commandTextOf = (args: Readonly<Record<string, unknown>>): string | undefined => {
  for (const key of ["command", "cmd", "code", "argv"] as const) {
    const value = args[key];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.every((part) => typeof part === "string"))
      return key === "cmd" && value.length > 0 ? (value.at(-1) ?? "") : value.join(" ");
  }
  return undefined;
};

/**
 * Chemin de fichier d'un appel, **quelle que soit l'orthographe de l'agent**.
 *
 * ⚠️ Les arguments arrivent tels que l'agent les a écrits : Pi dit `path`,
 * Claude `file_path`, opencode `filePath`. Ne lire que `path` laissait toutes les
 * éditions de Claude et d'opencode sans cible — « Modifié » sur rien.
 */
export const cheminDe = (args: Readonly<Record<string, unknown>>): string | null => {
  for (const cle of ["path", "file_path", "filePath", "file"] as const) {
    const valeur = args[cle];
    if (typeof valeur === "string" && valeur.trim().length > 0) return valeur.trim();
  }
  return null;
};

const texteOuVide = (valeur: unknown): string => (typeof valeur === "string" ? valeur : "");

/** Une édition lue dans un objet, sous les trois orthographes connues. */
const editionDe = (
  objet: Readonly<Record<string, unknown>>,
): { readonly oldText: string; readonly newText: string } | null => {
  const oldText = objet["oldText"] ?? objet["old_string"] ?? objet["oldString"];
  const newText = objet["newText"] ?? objet["new_string"] ?? objet["newString"];
  if (oldText === undefined && newText === undefined) return null;
  return { newText: texteOuVide(newText), oldText: texteOuVide(oldText) };
};

/**
 * Les éditions d'un appel `edit`, toutes orthographes confondues.
 *
 * Pi range ses éditions dans `edits[]` ; Claude met une édition à plat
 * (`old_string`/`new_string`) ou plusieurs dans `edits[]` (`MultiEdit`) ;
 * opencode écrit `oldString`/`newString`. Une forme inconnue ne produit rien —
 * jamais une édition inventée.
 */
export const editionsDe = (
  args: Readonly<Record<string, unknown>>,
): ReadonlyArray<{ readonly oldText: string; readonly newText: string }> => {
  const editions: Array<{ readonly oldText: string; readonly newText: string }> = [];
  const aPlat = editionDe(args);
  if (aPlat !== null) editions.push(aPlat);
  const liste = args["edits"];
  if (Array.isArray(liste)) {
    for (const element of liste) {
      if (typeof element !== "object" || element === null || Array.isArray(element)) continue;
      const lue = editionDe(
        Option.getOrUndefined(
          Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(element),
        ) ?? {},
      );
      if (lue !== null) editions.push(lue);
    }
  }
  return editions;
};

/** Découpe un `apply_patch` Codex en changements de fichiers mesurables. */
export const patchFilesOf = (command: string): ReadonlyArray<PatchFileChange> => {
  if (!command.includes("*** Begin Patch")) return [];
  const result: PatchFileChange[] = [];
  let kind: PatchFileChange["kind"] | undefined;
  let path: string | undefined;
  let edits: Array<{ newText: string; oldText: string }> = [];
  let oldLines: string[] = [];
  let newLines: string[] = [];
  const flushEdit = () => {
    if (oldLines.length > 0 || newLines.length > 0) {
      edits.push({
        newText: newLines.join("\n"),
        oldText: oldLines.join("\n"),
      });
      oldLines = [];
      newLines = [];
    }
  };
  const flushFile = () => {
    flushEdit();
    if (kind !== undefined && path !== undefined) result.push({ edits, kind, path });
    kind = undefined;
    path = undefined;
    edits = [];
  };

  for (const line of command.split(/\r?\n/)) {
    const header = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (header !== null) {
      flushFile();
      kind = header[1] === "Add" ? "add" : header[1] === "Delete" ? "delete" : "update";
      path = header[2]?.trim();
      continue;
    }
    if (line === "*** End Patch") {
      flushFile();
      continue;
    }
    if (kind === undefined) continue;
    if (line.startsWith("@@")) {
      flushEdit();
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      flushEdit();
    }
  }
  flushFile();
  return result;
};

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
      status: result.status ?? "unknown",
      stopReason: result.stopReason ?? null,
    })),
  };
};

/**
 * Chemins d'image cités dans un texte.
 *
 * ⚠️ **Un agent qui donne le chemin d'une image doit la MONTRER.** Afficher
 * `/tmp/capture.png` en texte oblige à le recopier ailleurs pour la regarder —
 * ce qui est exactement ce qu'on cherche à éviter depuis un téléphone.
 *
 * Le motif exige un chemin **absolu** terminé par une extension d'image : un
 * simple mot ne déclenche rien.
 */
const IMAGE_EXTENSIONS = "(?:png|jpe?g|gif|webp|avif)";

/** Chemin absolu local : `/tmp/capture.png`. */
const IMAGE_PATH_PATTERN = new RegExp(`(\\/[^\\s"'\u0060()\\[\\]]+\\.${IMAGE_EXTENSIONS})`, "gi");

/**
 * URL d'image : `https://exemple/capture.png`.
 *
 * ⚠️ Un agent cite **plus souvent une URL qu'un chemin local**. Ne détecter que
 * les chemins laissait l'URL s'afficher comme un lien : il fallait cliquer,
 * sortir de l'application, puis revenir. C'est ce qu'on cherche à éviter.
 */
const IMAGE_URL_PATTERN = new RegExp(
  `(https?://[^\\s"'\u0060()\\[\\]]+\\.${IMAGE_EXTENSIONS})`,
  "gi",
);

export interface ImageRefs {
  /** Chemins locaux, à lire via `/api/file`. */
  readonly paths: ReadonlyArray<string>;
  /** URLs distantes, affichées telles quelles. */
  readonly urls: ReadonlyArray<string>;
}

/**
 * Références d'image citées dans un texte, sans doublon.
 *
 * ⚠️ **Les URLs sont masquées avant de chercher les chemins.** Sans cela,
 * `http://hote/x.png` contient `//hote/x.png`, qui correspond aussi au motif de
 * chemin local — on produisait une URL bidon `/api/file?path=//hote/x.png`, qui
 * échouait, et l'image ne s'affichait jamais.
 */
export const imageRefsIn = (text: string): ImageRefs => {
  // ⚠️ On retire d'abord le code inline. Un chemin entre accents graves est un
  // **exemple de documentation**, pas un fichier à afficher : mes propres
  // explications produisaient des « image indisponible : //hote/x.png ».
  const prose = text.replace(/`[^`]*`/g, " ");

  const urls = [...new Set(prose.match(IMAGE_URL_PATTERN) ?? [])];

  // On remplace chaque URL par des espaces de même longueur : les positions
  // restent valides et aucun chemin ne peut plus chevaucher une URL.
  let masked = prose;
  for (const url of urls) {
    masked = masked.split(url).join(" ".repeat(url.length));
  }

  return {
    // `//hote/x.png` n'est pas un chemin local valide : on l'écarte.
    paths: [...new Set(masked.match(IMAGE_PATH_PATTERN) ?? [])].filter(
      (path) => !path.startsWith("//"),
    ),
    urls,
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
        // Une réflexion vide ou masquée n'apporte rien à la conversation.
        if (thinking.trim().length === 0 || redacted) return [];
        return [{ kind: "thinking", redacted, thinking }];
      }

      case "toolCall": {
        const args = toolArgumentsOf(decoded.arguments);
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
  if (body.phase !== undefined) meta["phase"] = body.phase;
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
  const strict = Option.getOrUndefined(decodeSessionLine(parsed));
  if (strict !== undefined) return strict;
  /*
    ⚠️ **Repli tolérant, et c'est ce qui manquait.** Une ligne normalisée par le
    backend porte des champs propres à sa famille (`phase`, `toolName`,
    `isError`, `exitCode`, `output`…) que le schéma ne connaît pas. Le décodage
    strict échouait alors **sur toute la ligne**, et le fil entier disparaissait
    sans erreur : la session opencode de 229 messages s'affichait « No messages ».
    On garde donc les seuls champs que le rendu utilise ; le reste est ignoré,
    jamais deviné.
  */
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const typeLigne = Reflect.get(parsed, "type");
  const corps = Reflect.get(parsed, "message");
  const horodatage = Reflect.get(parsed, "timestamp");
  if (typeof typeLigne !== "string" || typeof corps !== "object" || corps === null) {
    return undefined;
  }
  /*
    ⚠️ **Un champ `null` ne doit pas être recopié tel quel.** Les lignes opencode
    portent `toolName: null`, `model: null`… : recopiés, ils refaisaient échouer
    le second décodage, et **les messages `user` disparaissaient** (les messages
    `assistant` passaient, eux, parce que leurs champs étaient remplis). C'est
    ce qui donnait « zéro demande affichée » sur une session qui en contenait 6,
    et un tour unique de 10 h 25.
  */
  // Accès par `Reflect` : pas d'assertion de type sur une donnée venue du fil.
  const champ = (cle: string): unknown => Reflect.get(corps, cle);
  const texte = (cle: string): string | undefined => {
    const valeur = champ(cle);
    return typeof valeur === "string" && valeur !== "" ? valeur : undefined;
  };
  const compact = {
    message: {
      content: champ("content"),
      customType: texte("customType"),
      details: champ("details") ?? undefined,
      model: texte("model"),
      provider: texte("provider"),
      role: texte("role"),
      thinkingLevel: texte("thinkingLevel"),
    },
    timestamp: typeof horodatage === "string" ? horodatage : texte("timestamp"),
    type: typeLigne,
  };
  return Option.getOrUndefined(decodeSessionLine(compact));
};

/**
 * Transforme une entrée de session en message affichable.
 *
 * Retourne `undefined` pour tout ce qui n'est pas un message, ou pour un message
 * sans rien à montrer.
 */
/** Le rôle d'une ligne de session ignorée par le démon (trop grande). */
export const ROLE_LIGNE_IGNOREE = "ligneIgnoree";

const OCTETS_PAR_MO = 1_048_576;

/**
 * La taille d'une ligne que le démon a ignorée parce que trop grande, ou
 * `undefined`.
 *
 * ⚠️ **Elle n'apparaissait jamais.** Au-delà de 16 MiB, le démon (cadrage
 * `crates/sessions`) sert une entrée `unknown` qui DIT qu'une ligne a été
 * ignorée (`{"ignored":true,"bytes":N,"reason":"line too large (N bytes)
 * skipped"}`) ; la PWA ne rendait aucune entrée `unknown` : un trou muet dans
 * la conversation. On lit `bytes`, sinon la raison (texte anglais ou ancien
 * texte français du démon).
 */
export const octetsDeLigneIgnoree = (entry: {
  readonly raw: string;
  readonly type: string;
}): number | undefined => {
  if (entry.type !== "unknown") return undefined;
  const motif = /(?:line too large|ligne trop grande) \((\d+) (?:bytes|octets)\)/;
  try {
    const valeur: unknown = JSON.parse(entry.raw);
    if (
      typeof valeur === "object" &&
      valeur !== null &&
      "ignored" in valeur &&
      valeur.ignored === true &&
      "bytes" in valeur &&
      typeof valeur.bytes === "number"
    ) {
      return valeur.bytes;
    }
    if (typeof valeur === "object" && valeur !== null && "reason" in valeur) {
      const raison = valeur.reason;
      if (typeof raison === "string") {
        const trouve = motif.exec(raison);
        if (trouve?.[1] !== undefined) return Number(trouve[1]);
      }
    }
  } catch {
    // Le brut n'est pas du JSON : la raison peut être le texte lui-même.
  }
  const trouve = motif.exec(entry.raw);
  return trouve?.[1] === undefined ? undefined : Number(trouve[1]);
};

/** « A line of 17.2 MB was skipped (too large) » — discret, mais dit. */
export const avisDeLigneIgnoree = (octets: number): string => {
  const mo = Math.round((octets / OCTETS_PAR_MO) * 10) / 10;
  return `A line of ${mo.toLocaleString("en-US")} MB was skipped (too large)`;
};

export const toRenderedMessage = (entry: {
  readonly id?: string | undefined;
  readonly raw: string;
  readonly timestamp?: string | undefined;
  readonly type: string;
}): RenderedMessage | undefined => {
  const ignoree = octetsDeLigneIgnoree(entry);
  if (ignoree !== undefined) {
    const avis = avisDeLigneIgnoree(ignoree);
    return {
      at: entry.timestamp ?? null,
      blocks: [{ kind: "text", text: avis }],
      id: entry.id ?? `ignoree:${stableHash(entry.raw)}`,
      meta: {},
      role: ROLE_LIGNE_IGNOREE,
      text: avis,
    };
  }
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
    if (parsed === undefined && body?.command === undefined) return undefined;
    const command = parsed?.command ?? body?.command ?? "";
    const output = parsed?.output ?? body?.output ?? "";
    const block: Block = {
      cancelled: parsed?.cancelled === true || body?.cancelled === true,
      command,
      exitCode: parsed?.exitCode ?? body?.exitCode ?? null,
      kind: "bashExecution",
      output,
      truncated: parsed?.truncated === true || body?.truncated === true,
    };
    return {
      at: entry.timestamp ?? null,
      blocks: [block],
      id: entry.id ?? "bash",
      meta: {},
      role: "bashExecution",
      text: `${command}\n${output}`,
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

  /*
    ⚠️ **Le harnais n'est pas l'utilisateur.** Claude Code écrit en rôle `user`
    les rapports de ses sous-agents et les fins de tâches de fond ; le démon les
    rend en `custom` (`customType`). Ils ont leur carte, jamais une bulle de
    demande — c'était le défaut : un rapport s'affichait comme envoyé par soi.
  */
  if (role === "custom") {
    const rapport = rapportDe(body?.customType, body?.details, contentToText(body?.content));
    if (rapport !== undefined) {
      return {
        at: entry.timestamp ?? null,
        blocks: [rapport],
        id: entry.id ?? `entry:${stableHash(entry.raw)}`,
        meta: estPendantTour(body?.details) ? { pendantTour: "1" } : {},
        role,
        text: rapport.corps,
      };
    }
  }

  const isToolResult = role === "toolResult";

  // Un résultat de sous-agent porte une structure riche : on l'affiche comme
  // telle plutôt que de déverser sa sortie brute.
  const subagent = isToolResult ? toSubagent(rawDetailsOf(entry.raw)) : undefined;

  let blocks: ReadonlyArray<Block> =
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
  if (role === "assistant" && entry.id?.startsWith("codex:") === true) {
    blocks = blocks.filter((block) => {
      if (block.kind !== "toolCall" || block.name !== "exec") return true;
      const command = commandTextOf(block.arguments);
      // Codex's outer JS wrapper often only calls tools.exec_command; the
      // native CommandExecution event below carries the actual shell command.
      return command === undefined || !/tools\.exec_command\s*\(/.test(command);
    });
  }

  if (blocks.length === 0) return undefined;

  // Un texte qui cite une image la montre : chemins **et** URLs.
  const withImages: ReadonlyArray<Block> = blocks.flatMap((block) => {
    if (block.kind !== "text") return [block];
    const refs = imageRefsIn(block.text);
    // `push` plutôt que l'étalement : sur une session réelle, un texte peut
    // citer plusieurs images, et l'étalement recopiait le tableau à chaque bloc.
    const expanded: Array<Block> = [block];
    for (const path of refs.paths) expanded.push({ kind: "imagePath", path });
    for (const url of refs.urls) expanded.push({ kind: "imageUrl", url });
    return expanded;
  });

  // Une demande envoyée PENDANT le travail : une demande, marquée — elle
  // n'ouvre pas de tour (le chronomètre ne repart pas d'elle).
  const meta = metaOf(body);
  return {
    at: entry.timestamp ?? null,
    blocks: withImages,
    id: entry.id ?? `entry:${stableHash(entry.raw)}`,
    meta: estPendantTour(body?.details) ? { ...meta, pendantTour: "1" } : meta,
    role,
    text: withImages
      .map((block) => blockToText(block))
      .join("\n")
      .trim(),
  };
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
    case "imagePath":
      return `[image ${block.path}]`;
    case "imageUrl":
      return `[image ${block.url}]`;
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
    case "rapportTache":
      return block.corps;
    default:
      return "";
  }
};

/**
 * Mémoire du décodage, **par objet d'entrée**.
 *
 * ⚠️ **Pourquoi.** Une entrée de session ne change jamais sans changer d'objet :
 * la fusion par identifiant (`fusionnerEntrees`) garde l'objet d'une ligne
 * inchangée et pose un nouvel objet pour une ligne réécrite. Décoder une ligne
 * (un `JSON.parse` et un schéma) n'a donc lieu **qu'une fois par objet**, au lieu
 * d'une fois par ligne et par delta — la différence entre 2 000 analyses à chaque
 * événement du flux et une seule.
 *
 * Le second cache garde l'identité d'un message enrichi de ses jetons : sans lui,
 * la fusion des jetons produirait un objet neuf à chaque passage, et la ligne
 * correspondante se redessinerait pour rien.
 */
export interface MemoMessages {
  readonly parEntree: WeakMap<object, RenderedMessage | null>;
  readonly jetons: WeakMap<RenderedMessage, Map<string, RenderedMessage>>;
  readonly usages: WeakMap<object, number | null>;
}

export const creeMemoMessages = (): MemoMessages => ({
  jetons: new WeakMap(),
  parEntree: new WeakMap(),
  usages: new WeakMap(),
});

/** Jetons d'un enregistrement d'usage codex, ou `null` s'il est illisible. */
const jetonsDUsage = (raw: string): number | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const payload = Reflect.get(parsed, "payload");
    if (typeof payload !== "object" || payload === null) return null;
    const turn = Reflect.get(payload, "turn_token_usage");
    const usage = Reflect.get(payload, "usage");
    const total =
      typeof turn === "object" && turn !== null ? Reflect.get(turn, "total_tokens") : undefined;
    const fallback =
      typeof usage === "object" && usage !== null ? Reflect.get(usage, "total_tokens") : undefined;
    const tokens = typeof total === "number" ? total : fallback;
    return typeof tokens === "number" && tokens > 0 ? tokens : null;
  } catch {
    // Un enregistrement d'usage illisible ne doit pas faire perdre le fil.
    return null;
  }
};

/** Transforme les entrées d'une session en messages affichables. */
export const toMessages = (
  entries: ReadonlyArray<{
    readonly id?: string | undefined;
    readonly raw: string;
    readonly timestamp?: string | undefined;
    readonly type: string;
  }>,
  memo: MemoMessages = creeMemoMessages(),
): ReadonlyArray<RenderedMessage> =>
  entries.reduce<RenderedMessage[]>((messages, entry) => {
    if (entry.type === "token_usage_record") {
      let tokens = memo.usages.get(entry);
      if (tokens === undefined) {
        tokens = jetonsDUsage(entry.raw);
        memo.usages.set(entry, tokens);
      }
      const last = messages.at(-1);
      if (last?.role === "assistant" && tokens !== null) {
        const cle = String(tokens);
        const parJeton = memo.jetons.get(last) ?? new Map<string, RenderedMessage>();
        let enrichi = parJeton.get(cle);
        if (enrichi === undefined) {
          enrichi = { ...last, meta: { ...last.meta, tokens: cle } };
          parJeton.set(cle, enrichi);
          memo.jetons.set(last, parJeton);
        }
        messages[messages.length - 1] = enrichi;
      }
      return messages;
    }
    let decode = memo.parEntree.get(entry);
    if (decode === undefined) {
      decode = toRenderedMessage(entry) ?? null;
      memo.parEntree.set(entry, decode);
    }
    const message = decode ?? undefined;
    if (message !== undefined) {
      // Codex may record the same text in an event and a response item. Keep
      // one copy when adjacent records for the same role match.
      const plainText =
        (message.role === "assistant" || message.role === "user") &&
        message.blocks.length > 0 &&
        message.blocks.every((block) => block.kind === "text");
      const previousSameRole = messages.findLast((candidate) => candidate.role === message.role);
      const sameTimestamp =
        previousSameRole?.at !== null && previousSameRole?.at !== undefined && message.at !== null
          ? Math.abs(Date.parse(message.at) - Date.parse(previousSameRole.at)) <= 10_000
          : true;
      if (!(plainText && previousSameRole?.text === message.text && sameTimestamp))
        messages.push(message);
    }
    return messages;
  }, []);

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
      readonly tools: ReadonlyArray<{
        readonly name: string;
        readonly count: number;
      }>;
      readonly callCount: number;
    };

/** Raccourcit un chemin uniquement quand il appartient au workspace affiché. */
export const relativeWorkspacePath = (path: string, cwd: string | null | undefined): string => {
  if (!cwd) return path;
  const root = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (path === cwd) return ".";
  return path.startsWith(root) ? path.slice(root.length) : path;
};

/**
 * `cd <racine>` en tête d'une commande, suivi de la vraie commande.
 *
 * Trois écritures du chemin sortent d'agents réels : nue, entre guillemets
 * simples, entre guillemets doubles.
 *
 * ⚠️ Trois séparateurs aussi, et le troisième n'est pas théorique : un agent
 * écrit souvent `cd /projet` **puis un retour à la ligne**, sans `&&`. Relevé
 * dans une session réelle, c'est même la forme la plus fréquente des scripts.
 * Ne reconnaître que `&&` laissait passer la majorité des cas.
 */
const CD_ENTREE = /^cd\s+(?:"([^"]*)"|'([^']*)'|(\S+))(?:\s*&&|\s*;|\s*\n)\s*([\s\S]+)$/u;

/** Retire la barre finale, sauf sur une racine (`/`). */
const sansBarreFinale = (chemin: string): string =>
  chemin.length > 1 && chemin.endsWith("/") ? chemin.slice(0, -1) : chemin;

/** Deux chemins désignent-ils le même dossier ? */
const memeDossier = (a: string, b: string): boolean => sansBarreFinale(a) === sansBarreFinale(b);

/**
 * Retire un `cd` d'entrée vers le **dossier de travail**.
 *
 * ⚠️ **Pourquoi.** Presque chaque commande d'agent commence par `cd <projet> &&`.
 * Afficher « Ran `cd /Users/…/projet && npm test` » met un chemin que
 * l'utilisateur connaît déjà devant la seule partie qui compte, et repousse
 * celle-ci hors de la ligne. Le bruit n'est pas neutre : il masque l'information.
 *
 * ⚠️ **Seulement vers le dossier de travail lui-même.** `cd apps/web && …` change
 * réellement le sens de la commande : le retirer ferait mentir la ligne. On
 * compare donc le chemin à la racine, barre finale ignorée, et on ne touche à
 * rien si l'on n'est pas sûr.
 *
 * ⚠️ Rien n'est retiré s'il ne reste **rien** à montrer : une ligne « Ran » sans
 * cible serait pire que le `cd` qu'elle remplace.
 */
export const commandeSansCd = (commande: string, cwd: string | null | undefined): string => {
  if (!cwd) return commande;
  let reste = commande;
  // Un enchaînement `cd projet && cd projet && …` arrive : on retire tant qu'il
  // y a un `cd` à retirer, sans boucler à l'infini (chaque tour raccourcit).
  for (;;) {
    const trouve = CD_ENTREE.exec(reste.trimStart());
    if (trouve === null) return reste;
    const chemin = trouve[1] ?? trouve[2] ?? trouve[3] ?? "";
    const suite = (trouve[4] ?? "").trim();
    if (!memeDossier(chemin, cwd) || suite.length === 0) return reste;
    reste = suite;
  }
};

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
/**
 * Découpe la conversation en éléments affichables.
 *
 * ⚠️ **Le regroupement se fait par période de travail**, pas par suite de
 * messages « tout-outils ». L'ancienne règle ne groupait que des messages dont
 * **tous** les blocs étaient des appels : or un tour réel est
 * `text + thinking + toolCall` (565 messages sur 1080 mesurés), donc presque
 * jamais groupé. Résultat : le travail d'un tour se retrouvait éparpillé en
 * lignes isolées, et un en-tête « A travaillé » pouvait se retrouver **après**
 * son propre contenu, avec un ou deux sous-blocs seulement.
 *
 * Un tour commence à un message de l'utilisateur. Tout ce que l'agent produit
 * ensuite est **un seul** travail, sauf sa **dernière prose**, qui est la
 * réponse : elle se lit hors du bloc, sinon il faudrait déplier pour lire ce
 * qu'on est venu chercher.
 */
/**
 * Cache de `toItems` — **par identité du tableau ET par état du dernier tour**.
 *
 * ⚠️ **Pourquoi (C27).** `ChatScreen` rappelle `toItems` à chaque rendu ; une
 * frappe dans le composeur est un rendu. Sans cache, chaque touche recalculait
 * les blocs de **tout** l'historique (mesuré : 2 000 messages), et la frappe
 * devenait pâteuse à mesure que la conversation grandissait.
 *
 * La clé est l'**identité** du tableau : `messages` est un état, il ne change
 * qu'à l'arrivée de vrais messages. Un nouveau tableau = un nouveau calcul ;
 * le même tableau = zéro travail. Le booléen du dernier tour fait partie de la
 * clé : un agent qui passe à `working` change le découpage, sans changer le
 * tableau.
 *
 * ⚠️ Une `WeakMap` : le cache ne retient pas les tableaux abandonnés (naviguer
 * entre deux conversations ne fuit pas).
 */
const cacheItems = new WeakMap<ReadonlyArray<RenderedMessage>, Map<boolean, ReadonlyArray<Item>>>();

export const toItems = (
  messages: ReadonlyArray<RenderedMessage>,
  lastTurnInProgress = false,
): ReadonlyArray<Item> => {
  const deja = cacheItems.get(messages)?.get(lastTurnInProgress);
  if (deja !== undefined) return deja;
  const calcule = calculeItems(messages, lastTurnInProgress);
  const parEtat = cacheItems.get(messages) ?? new Map<boolean, ReadonlyArray<Item>>();
  parEtat.set(lastTurnInProgress, calcule);
  cacheItems.set(messages, parEtat);
  return calcule;
};

/** Le calcul réel — séparé pour que le cache reste une ligne au-dessus. */
const calculeItems = (
  messages: ReadonlyArray<RenderedMessage>,
  // Conservé pour la clé de cache : le découpage ne dépend plus de ce booléen,
  // mais `toItems` reste appelé avec lui et un changement de valeur doit
  // recalculer (le statut `working` peut coïncider avec une nouvelle prose).
  _lastTurnInProgress = false,
): ReadonlyArray<Item> => toursDe(messages).flatMap((tour) => itemsDuTour(tour));

/** Un message du harnais (rapport, fin de tâche), rendu par sa carte. */
export const estMessageDuHarnais = (message: RenderedMessage): boolean =>
  message.role === "custom" && message.blocks.some((block) => block.kind === "rapportTache");

/**
 * Découpe les messages en **tours** : une demande et tout ce qui la suit.
 *
 * ⚠️ Les messages qui précèdent la première demande forment leur propre tour
 * (une page d'historique peut commencer au milieu d'un travail). Le découpage
 * ne dépend que des rôles : deux appels sur le même tableau donnent les mêmes
 * tours, ce qui rend le cache par tour (`creeGroupeur`) exact.
 */
export const toursDe = (
  messages: ReadonlyArray<RenderedMessage>,
): ReadonlyArray<ReadonlyArray<RenderedMessage>> => {
  const tours: RenderedMessage[][] = [];
  let courant: RenderedMessage[] = [];
  for (const message of messages) {
    if (message.role === "user" && courant.length > 0) {
      tours.push(courant);
      courant = [];
    }
    courant.push(message);
  }
  if (courant.length > 0) tours.push(courant);
  return tours;
};

/**
 * Les éléments d'**un** tour — la règle de découpage, appliquée à un tour seul.
 *
 * C'est exactement le calcul historique, restreint à un tour : il ne lit rien en
 * dehors de lui, et c'est ce qui permet de ne recalculer que le tour qui change.
 */
export const itemsDuTour = (messages: ReadonlyArray<RenderedMessage>): ReadonlyArray<Item> => {
  const items: Item[] = [];
  let tour: RenderedMessage[] = [];

  /*
    ⚠️ **Toute prose de l'agent est un message, jamais du « travail ».**

    Avant, la règle était « la réponse = la dernière prose du tour », et **tout
    le reste du tour** — y compris de longues réponses déjà écrites — partait
    dans le groupe replié. Dès qu'un texte arrive après la réponse (un brief
    injecté, un plugin, un skill qui écrit un accusé), la grande réponse
    disparaissait dans le groupe et la **petite** devenait « la réponse ».

    On découpe donc le tour en séquence : les blocs de travail (réflexion,
    appels d'outils, résultats) forment des groupes, et chaque bloc de prose
    sort **à sa place**, comme message. L'ordre du fil est préservé, et aucune
    prose lisible n'est cachée.
  */
  const pousseTravail = (travail: ReadonlyArray<RenderedMessage>) => {
    if (travail.length === 0) return;
    items.push({
      callCount: travail.length,
      // L'identité du groupe suit son premier message : le nombre de messages
      // augmente pendant le streaming et ne doit pas remonter son composant.
      id: `travail:${travail[0]?.id ?? "?"}`,
      kind: "tools",
      messages: travail,
      tools: toolNamesOf(travail),
    });
  };

  const flush = () => {
    if (tour.length === 0) return;
    let travail: RenderedMessage[] = [];
    for (const message of tour) {
      const prose = message.blocks.filter(
        (block) => block.kind === "text" || block.kind === "image",
      );
      const reste = message.blocks.filter(
        (block) => block.kind !== "text" && block.kind !== "image",
      );
      if (reste.length > 0) travail.push({ ...message, blocks: reste });
      if (prose.length > 0) {
        pousseTravail(travail);
        travail = [];
        items.push({ kind: "single", message: { ...message, blocks: prose } });
      }
    }
    pousseTravail(travail);
    tour = [];
  };

  for (const message of messages) {
    // Une demande, ou une carte du harnais : un élément à part, à sa place.
    if (message.role === "user" || estMessageDuHarnais(message)) {
      flush();
      items.push({ kind: "single", message });
      continue;
    }
    tour.push(message);
  }

  flush();

  return items;
};

/**
 * Identifiant du bloc de travail **vide** qui annonce un travail qui commence.
 *
 * ⚠️ Fixe, et c'est voulu : le bloc vide et le premier vrai groupe ne doivent
 * pas être deux blocs différents, sinon l'écran clignote au moment où le
 * premier appel d'outil arrive.
 */
export const ID_TRAVAIL_EN_COURS = "travail:en-cours";

/**
 * Ajoute le bloc de travail **dès que l'agent travaille**, avant même le premier
 * appel d'outil.
 *
 * ⚠️ **Le statut arrive avant la session.** Herdr annonce `working` sur son flux
 * — c'est un événement, il est immédiat — alors que le premier appel d'outil
 * n'est écrit dans le JSONL que plus tard, et n'est lu qu'au tour de
 * rafraîchissement suivant. Sans ce bloc, l'écran reste **muet** pendant tout
 * cet intervalle : on ne sait pas si l'agent a reçu la demande, ni s'il a
 * commencé. Mesuré sur `wA:p1` : ~1 s entre le statut `working` et le premier
 * appel visible dans la session.
 *
 * Le bloc part donc vide et se remplit à l'arrivée réelle des appels.
 *
 * ⚠️ **Aucun chiffre n'est inventé.** Le bloc vide ne porte ni durée ni jeton :
 * ces valeurs se calculent sur les horodatages des messages, et il n'y en a pas
 * encore. « Working » sans durée est exact ; une durée calculée sur l'horloge de
 * l'écran mesurerait l'écran, pas l'agent.
 *
 * ⚠️ **Le bloc ne dépend PAS d'une session lisible.** Le statut `working` vient
 * d'Herdr et il est vérifié ; l'absence de transcription en est un **autre** fait,
 * et les deux ne se contredisent pas.
 *
 * Défaut mesuré le 2026-10-17 sur `wB:p1B`, un agent codex qui a réellement
 * tourné : sa session existe sur le disque
 * (`~/.codex/sessions/2026/10/17/rollout-…-01a14a74-….jsonl`, cwd `herdr-pwa`),
 * mais Herdr ne l'expose plus — son propre journal le dit, au moment exact de
 * la création de la session :
 *
 * ```
 * api request completed outcome=error method="pane.report_agent_session"
 * ```
 *
 * L'agent travaillait, la route rendait `404 no usable session path`, donc la
 * conversation était vide, donc `items` était vide — et l'écran **muet** pendant
 * tout le travail. C'est exactement le « je n'ai pas le bloc de travail » du
 * rapport. Le bloc doit donc se décider sur le **statut**, pas sur le contenu.
 */
export const avecTravailEnCours = (
  items: ReadonlyArray<Item>,
  enCours: boolean,
): ReadonlyArray<Item> => {
  if (!enCours) return items;
  // Un groupe d'outils déjà en cours montre déjà son propre « Working ».
  if (items.at(-1)?.kind === "tools") return items;
  return [
    ...items,
    {
      callCount: 0,
      id: ID_TRAVAIL_EN_COURS,
      kind: "tools",
      messages: [],
      tools: [],
    },
  ];
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

/** Un fichier touché, avec les modifications qui le concernent. */
export interface TouchedFile {
  /** Nombre de lignes ajoutées, toutes éditions confondues. */
  readonly added: number;
  /** Nombre de lignes retirées. */
  readonly removed: number;
  /** Éditions successives, dans l'ordre de la session. */
  readonly edits: ReadonlyArray<{
    readonly newText: string;
    readonly oldText: string;
  }>;
  readonly path: string;
}

/**
 * Fichiers modifiés, **avec leurs diffs**.
 *
 * ⚠️ Afficher le fichier entier ne répond pas à la question. Une vue de
 * « fichiers touchés » doit montrer **ce qui a changé** — sinon il faut relire
 * tout le fichier pour trouver les trois lignes modifiées.
 */
/** Cache des fichiers touchés — même clé que `toItems` (C27). */
const cacheFichiers = new WeakMap<ReadonlyArray<RenderedMessage>, ReadonlyArray<TouchedFile>>();

export const touchedFilesOf = (
  messages: ReadonlyArray<RenderedMessage>,
): ReadonlyArray<TouchedFile> => {
  const deja = cacheFichiers.get(messages);
  if (deja !== undefined) return deja;
  const calcule = calculeFichiers(messages);
  cacheFichiers.set(messages, calcule);
  return calcule;
};

const calculeFichiers = (messages: ReadonlyArray<RenderedMessage>): ReadonlyArray<TouchedFile> => {
  const byPath = new Map<
    string,
    {
      added: number;
      edits: { newText: string; oldText: string }[];
      removed: number;
    }
  >();

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== "toolCall") continue;
      if (["exec", "exec_command", "apply_patch"].includes(block.name)) {
        const command = commandTextOf(block.arguments);
        if (command === undefined) continue;
        for (const patch of patchFilesOf(command)) {
          const entry = byPath.get(patch.path) ?? {
            added: 0,
            edits: [] as { newText: string; oldText: string }[],
            removed: 0,
          };
          for (const edit of patch.edits) {
            entry.edits.push(edit);
            if (edit.newText.length > 0) entry.added += edit.newText.split("\n").length;
            if (edit.oldText.length > 0) entry.removed += edit.oldText.split("\n").length;
          }
          byPath.set(patch.path, entry);
        }
        continue;
      }

      const path = cheminDe(block.arguments);
      if (path === null) continue;
      const nom = block.name.toLowerCase();
      if (nom !== "edit" && nom !== "write" && nom !== "multiedit") continue;

      const entry = byPath.get(path) ?? { added: 0, edits: [], removed: 0 };

      if (nom === "write") {
        // Une écriture complète : tout le contenu est ajouté.
        const content = block.arguments["content"];
        entry.added += typeof content === "string" ? content.split("\n").length : 0;
      }

      for (const { newText, oldText } of editionsDe(block.arguments)) {
        entry.edits.push({ newText, oldText });
        entry.removed += oldText.length === 0 ? 0 : oldText.split("\n").length;
        entry.added += newText.length === 0 ? 0 : newText.split("\n").length;
      }

      byPath.set(path, entry);
    }
  }

  return (
    [...byPath.entries()]
      // `path` est réécrit explicitement plutôt qu'étalé : la clé de la Map est
      // la seule chose que l'entrée ne contient pas encore.
      .map(([path, entry]) => Object.assign({ path }, entry))
      .toSorted((a, b) => b.added + b.removed - (a.added + a.removed))
  );
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
