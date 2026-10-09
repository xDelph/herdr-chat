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

/** En-tête de session, tel qu'écrit en première ligne. */
const HeaderLine = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  parentSession: Schema.optional(Schema.String),
  version: Schema.optional(Schema.Number),
});

const decodeUnknown = Schema.decodeUnknownOption(HeaderLine);

/** Session illisible : fichier absent, disparu, ou illisible. */
export class SessionReadError extends Schema.TaggedError<SessionReadError>()("SessionReadError", {
  cause: Schema.Defect(),
  detail: Schema.String,
  path: Schema.String,
}) {}

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
export const readHeader = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      const handle = await open(path, "r");
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
      new SessionReadError({
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
export const tailFrom = (path: string, offset: number, pending: string) =>
  Effect.tryPromise({
    try: async (): Promise<TailedSession> => {
      const handle: FileHandle = await open(path, "r");
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
      new SessionReadError({
        cause,
        detail: cause instanceof Error ? cause.message : String(cause),
        path,
      }),
  });

/** Lit tout le fichier. Réservé au premier chargement d'une session courte. */
export const readAll = (path: string) => tailFrom(path, 0, "");
