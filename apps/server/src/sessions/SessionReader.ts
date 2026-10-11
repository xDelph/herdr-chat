/**
 * Lecture des sessions Pi — **strictement en lecture seule**.
 *
 * Le contenu et le rattrapage après coupure viennent d'ici, jamais d'Herdr :
 * `revision` vaut `0` en permanence et `events.wait` n'implémente pas
 * `pane_output_changed` (E3, `docs/PROTOCOL.md` §10).
 *
 * Stratégie validée par E4 : fichier **append-only**, `ino` stable, lecture par
 * **offset** fiable. On mémorise l'offset et on relit uniquement ce qui est
 * apparu. Une ligne partielle (le `\n` final peut manquer) est **conservée en
 * attente** et jamais interprétée.
 *
 * Aucune fonction de ce module n'ouvre un fichier en écriture.
 */
import { Effect, Option, Schema } from "effect";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { describeRejection, resolveWithin } from "./PathGuard.ts";

/** En-tête de session, tel qu'écrit en première ligne. */
const HeaderLine = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  parentSession: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number),
});

const decodeUnknown = Schema.decodeUnknownOption(HeaderLine);

/** Session illisible : disparue en cours de lecture, ou permissions. */
export class SessionReadError extends Schema.TaggedError<SessionReadError>()("SessionReadError", {
  cause: Schema.Defect(),
  detail: Schema.String,
  path: Schema.String,
}) {}

/**
 * Session **refusée** : le chemin est hors de la racine autorisée (S03).
 *
 * Volontairement distinct de `SessionReadError` : ici le fichier n'a pas été
 * ouvert, donc il n'y a pas d'erreur d'E/S à rapporter — seulement une décision
 * de politique. La cause est conservée telle quelle, jamais remplacée par un
 * message général : « ne pas masquer une erreur » vaut aussi pour un refus.
 */
export class SessionPathRejected extends Schema.TaggedError<SessionPathRejected>()(
  "SessionPathRejected",
  { detail: Schema.String, path: Schema.String, reason: Schema.String },
) {}

/**
 * Ouvre un fichier de session **après** avoir vérifié qu'il est sous `root`.
 *
 * ⚠️ L'ordre n'est pas négociable : `realpath` d'abord, comparaison **par
 * segments** ensuite, ouverture du chemin **résolu** en dernier. Valider la
 * chaîne puis ouvrir l'original laisserait une fenêtre entre les deux, pendant
 * laquelle un lien symbolique pouvait être substitué.
 *
 * `root` vide = aucun confinement. Utile aux tests sur fichiers temporaires
 * isolés ; le chemin de production fournit toujours sa racine (S03).
 */
const openGuarded = async (root: string, path: string): Promise<FileHandle> => {
  if (root === "") return open(path, "r");

  const verdict = await resolveWithin(root, path);
  if (!verdict.ok || verdict.resolved === undefined) {
    const reason = verdict.reason ?? "hors-racine";
    throw new SessionPathRejected({
      detail: describeRejection(reason),
      path,
      reason,
    });
  }
  return open(verdict.resolved, "r");
};

/**
 * `true` si l'erreur signifie « le fichier n'existe pas ».
 *
 * ⚠️ **Herdr annonce un chemin de session qui n'existe pas encore.** Pi crée le
 * fichier JSONL au **premier message** : un agent fraîchement lancé a donc un
 * `agent_session` valide pointant vers un fichier absent.
 *
 * Ce n'est pas une erreur — c'est une session vide. La traiter comme une panne
 * faisait échouer l'ouverture de tout nouvel agent, en boucle toutes les deux
 * secondes.
 */
export const isMissingFile = (error: unknown): boolean => {
  // Décodage plutôt qu'assertion : on cherche un code `ENOENT` où qu'il soit.
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      Schema.Struct({
        cause: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })),
      }),
    )(error),
  );
  if (decoded?.cause?.code === "ENOENT") return true;

  return (
    error instanceof Error &&
    Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Struct({ code: Schema.optional(Schema.String) }))(error),
    )?.code === "ENOENT"
  );
};

export interface RawEntry {
  readonly type: string;
  readonly id: string | undefined;
  readonly parentId: string | null | undefined;
  readonly timestamp: string | undefined;
  /** Ligne brute, conservée telle quelle : c'est la donnée de fidélité. */
  readonly raw: string;
}

export interface TailedSession {
  /** Entrées complètes lues depuis l'offset précédent. */
  readonly entries: ReadonlyArray<RawEntry>;
  /** Nouvel offset à mémoriser pour le prochain appel. */
  readonly offset: number;
  /** Ligne incomplète conservée (sera recollée au prochain appel). */
  readonly pending: string;
}

/**
 * Découpe un bloc texte en entrées complètes.
 *
 * La **dernière** portion après le dernier `\n` est un début de ligne : elle
 * n'est jamais interprétée comme une entrée, même si elle est du JSON valide,
 * car elle peut être tronquée en plein milieu.
 */
export const splitCompleteLines = (text: string): { lines: string[]; pending: string } => {
  const parts = text.split("\n");
  const pending = parts.pop() ?? "";
  return { lines: parts.filter((line) => line.trim().length > 0), pending };
};

/** Forme minimale reconnue d'une ligne de session. */
const LooseLine = Schema.Struct({
  id: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  timestamp: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
});

const decodeLoose = Schema.decodeUnknownOption(LooseLine);

/** Convertit du JSON déjà analysé en entrée brute, sans assertion de type. */
const toRawEntry = (parsed: unknown, line: string): RawEntry => {
  const decoded = Option.getOrUndefined(decodeLoose(parsed));
  if (decoded === undefined) {
    // Une ligne illisible est conservée brute plutôt que perdue : la fidélité
    // au format source prime sur la normalisation (principe produit n°2).
    return { id: undefined, parentId: null, raw: line, timestamp: undefined, type: "unknown" };
  }
  return {
    id: decoded.id,
    parentId: decoded.parentId ?? null,
    raw: line,
    timestamp: decoded.timestamp,
    type: decoded.type ?? "unknown",
  };
};

const parseEntry = (line: string): RawEntry => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    parsed = undefined;
  }
  return toRawEntry(parsed, line);
};

/**
 * Lit l'en-tête d'une session sans la charger entièrement.
 *
 * Retourne aussi `parentSession` quand il existe : c'est le **seul** lien de
 * filiation réel entre sessions, à ne pas confondre avec `parentId`, qui est
 * intra-session (`docs/PROTOCOL.md` §4.1).
 */
export const readHeader = (path: string, root = "") =>
  Effect.tryPromise({
    try: async () => {
      const handle = await openGuarded(root, path);
      try {
        const buffer = Buffer.alloc(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0] ?? "";
        const decoded = Option.getOrUndefined(decodeUnknown(JSON.parse(firstLine)));
        return {
          cwd: decoded?.cwd,
          id: decoded?.id,
          parentSession: decoded?.parentSession,
          version: decoded?.version ?? 1,
        };
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      cause instanceof SessionPathRejected
        ? cause
        : new SessionReadError({
            cause,
            detail: cause instanceof Error ? cause.message : String(cause),
            path,
          }),
  });

/**
 * Lit le fichier depuis `offset` jusqu'à la fin.
 *
 * `pending` est recollé au début de la lecture : une ligne incomplète vue au
 * tour précédent redevient complète dès que la suite arrive.
 */
export const tailFrom = (path: string, offset: number, pending: string, root = "") =>
  Effect.tryPromise({
    try: async (): Promise<TailedSession> => {
      const handle: FileHandle = await openGuarded(root, path);
      try {
        const stats = await handle.stat();
        if (stats.size <= offset) {
          return { entries: [], offset, pending };
        }
        const length = stats.size - offset;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        const text = pending + buffer.subarray(0, bytesRead).toString("utf8");
        const { lines, pending: rest } = splitCompleteLines(text);
        return {
          entries: lines.map(parseEntry),
          offset: offset + bytesRead,
          pending: rest,
        };
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      cause instanceof SessionPathRejected
        ? cause
        : new SessionReadError({
            cause,
            detail: cause instanceof Error ? cause.message : String(cause),
            path,
          }),
  });

export { tailFrom as tailFromRaw };

/** Lit tout le fichier. Réservé au premier chargement d'une session courte. */
export const readAll = (path: string, root = "") => tailFrom(path, 0, "", root);

/**
 * Lit **la fin** d'un fichier sans le charger entièrement.
 *
 * Sert au premier affichage d'une conversation : sur une session réelle de
 * 1,8 Mo, tout renvoyer avant la première peinture rend l'écran inutilisable.
 * On lit les `maxBytes` derniers octets, et on **jette la première ligne**,
 * presque toujours tronquée.
 *
 * Le résultat porte `offset` : le client reprend ensuite en incrémental.
 */
export const readTail = (path: string, maxBytes: number, root = "") =>
  Effect.tryPromise({
    try: async (): Promise<TailedSession & { readonly truncated: boolean }> => {
      const handle: FileHandle = await openGuarded(root, path);
      try {
        const stats = await handle.stat();
        const start = Math.max(0, stats.size - maxBytes);
        const length = stats.size - start;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        let text = buffer.subarray(0, bytesRead).toString("utf8");

        let truncated = false;
        if (start > 0) {
          // La première ligne est très probablement coupée en plein milieu.
          const firstNewline = text.indexOf("\n");
          text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
          truncated = true;
        }

        const { lines, pending } = splitCompleteLines(text);
        return {
          entries: lines.map(parseEntry),
          offset: start + bytesRead,
          pending,
          truncated,
        };
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      cause instanceof SessionPathRejected
        ? cause
        : new SessionReadError({
            cause,
            detail: cause instanceof Error ? cause.message : String(cause),
            path,
          }),
  });
