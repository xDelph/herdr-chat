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
import {
  estLigneDeConversationClaude,
  estObjet,
  ligneClaudeVersPi,
  ligneCodexVersPi,
  reglageCodexVersPi,
  sansMessage,
  SESSION_HEADER_BYTES,
} from "@herdr-remote/shared";
import { describeRejection, resolveWithin } from "./PathGuard.ts";
import { estAbsence } from "./ReadCause.ts";

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
const openGuarded = async (
  root: string | ReadonlyArray<string>,
  path: string,
): Promise<FileHandle> => {
  // Une liste vide (ou une chaîne vide) = aucun confinement, pour les tests.
  if (root === "" || (Array.isArray(root) && root.length === 0)) return open(path, "r");

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
export const isMissingFile = (error: unknown): boolean => estAbsence(error);

export interface RawEntry {
  readonly type: string;
  readonly id: string | undefined;
  readonly parentId: string | null | undefined;
  readonly timestamp: string | undefined;
  /** Ligne brute, conservée telle quelle : c'est la donnée de fidélité. */
  readonly raw: string;
}

/** Identité du fichier sous-jacent : c'est ce qui distingue un vrai curseur. */
export interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

export interface TailedSession {
  /** Entrées complètes lues depuis l'offset précédent. */
  readonly entries: ReadonlyArray<RawEntry>;
  /**
   * Position **après le dernier saut de ligne complet**.
   *
   * Une ligne partielle ne fait pas avancer l'offset : elle est conservée
   * dans `pending` et recollée au prochain appel. Avancer ici tronquerait la
   * ligne à jamais.
   */
  readonly offset: number;
  /** Début de la fenêtre, pour produire un curseur de pagination antérieure. */
  readonly startOffset?: number;
  /** Ligne incomplète conservée (sera recollée au prochain appel). */
  readonly pending: string;
  /**
   * `true` quand des entrées antérieures à la fenêtre n'ont pas été renvoyées.
   * Le client sait qu'il ne voit pas toute la conversation.
   */
  readonly hasMore: boolean;
  /** Identité du fichier, à reporter dans le curseur. */
  readonly identity: FileIdentity;
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
    return {
      id: undefined,
      parentId: null,
      raw: line,
      timestamp: undefined,
      type: "unknown",
    };
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

  // ⚠️ **Le seul point d'entrée.** Une ligne codex est traduite ici, une fois,
  // en forme pi : tout ce qui suit — aperçu, titre, blocs, curseur — n'a pas à
  // savoir d'où vient la ligne. Un second décodeur plus loin aurait dupliqué
  // chaque décision d'affichage.
  const traduite = ligneCodexVersPi(parsed);
  if (traduite !== undefined) return toRawEntry(traduite, JSON.stringify(traduite));

  /*
    ⚠️ **Les réglages codex passent par ici, et pas par la ligne de message.**
    Mesure : codex écrit le modèle dans des **événements** (`turn_context`,
    `thread_settings_applied`), jamais sur ses messages. La ligne produite est de
    forme pi (`model_change`), donc `reglagesOf` la lit sans rien savoir de
    codex — c'est la règle du point d'entrée unique. Un second décodeur plus
    loin aurait dupliqué chaque décision de format.
  */
  const reglage = reglageCodexVersPi(parsed);
  if (reglage !== undefined) return toRawEntry(reglage, JSON.stringify(reglage));

  /*
    ⚠️ Claude Code a son propre adaptateur, et il est indispensable : sa forme
    ressemble a celle de Pi, mais `api-request-blob` porte un `message` de role
    `user` dont le contenu est le prompt systeme. Sans ce tri, chaque
    conversation s'ouvrirait sur les consignes injectees.
  */
  const claude = ligneClaudeVersPi(parsed);
  if (claude !== undefined) return toRawEntry(claude, JSON.stringify(claude));

  /*
    ⚠️ **Une ligne de conversation claude refusée ne doit pas rester lisible.**
    Elle retombait sur `toRawEntry(parsed, line)` — la règle générale, et elle est
    bonne pour une ligne illisible. Mais la forme d'une ligne claude est celle de
    pi : elle porte `message.role`. L'aperçu de la liste relisait donc ce que
    l'adaptateur venait d'écarter, et annonçait `[Request interrupted by user]`
    comme « la dernière demande de l'utilisateur » — alors que le filtre
    marchait. On garde la ligne, privée de son message : ses autres champs
    survivent, et plus rien ne la lit comme un message.
  */
  if (estLigneDeConversationClaude(parsed)) {
    const comptabilite = estObjet(parsed) ? sansMessage(parsed) : parsed;
    return toRawEntry(comptabilite, JSON.stringify(comptabilite));
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
        const buffer = Buffer.alloc(SESSION_HEADER_BYTES);
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
export const tailFrom = (
  path: string,
  offset: number,
  pending: string,
  root: string | ReadonlyArray<string> = "",
) =>
  Effect.tryPromise({
    try: async (): Promise<TailedSession> => {
      const handle: FileHandle = await openGuarded(root, path);
      try {
        const stats = await handle.stat();
        if (stats.size <= offset) {
          return {
            entries: [],
            hasMore: false,
            identity: { dev: stats.dev, ino: stats.ino },
            offset,
            pending,
          };
        }
        const length = stats.size - offset;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        const text = pending + buffer.subarray(0, bytesRead).toString("utf8");
        const { lines, pending: rest } = splitCompleteLines(text);
        const completeBytes = Buffer.byteLength(text, "utf8") - Buffer.byteLength(rest, "utf8");
        return {
          entries: lines.map(parseEntry),
          hasMore: false,
          identity: { dev: stats.dev, ino: stats.ino },
          // Idem : une ligne partielle ne fait **pas** avancer le curseur.
          offset: offset + Math.max(0, completeBytes),
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
export const readTail = (
  path: string,
  maxBytes: number,
  root: string | ReadonlyArray<string> = "",
) =>
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
        let alignedStart = start;
        if (start > 0) {
          // La première ligne est très probablement coupée en plein milieu.
          const firstNewline = text.indexOf("\n");
          if (firstNewline !== -1) {
            const prefix = text.slice(0, firstNewline + 1);
            alignedStart += Buffer.byteLength(prefix, "utf8");
            text = text.slice(firstNewline + 1);
          } else {
            text = "";
          }
          truncated = true;
        }

        const { lines, pending } = splitCompleteLines(text);
        // ⚠️ L'offset doit désigner la fin du **dernier saut de ligne complet**,
        // pas la fin du bloc lu. Si `pending` existe, le curseur revient en
        // arrière : la ligne incomplète sera recollée au prochain appel.
        const completeBytes = Buffer.byteLength(text, "utf8") - Buffer.byteLength(pending, "utf8");
        return {
          entries: lines.map(parseEntry),
          hasMore: truncated,
          identity: { dev: stats.dev, ino: stats.ino },
          offset: alignedStart + Math.max(0, completeBytes),
          startOffset: alignedStart,
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

/** Lit la page de session qui précède un curseur opaque. */
export const readBefore = (
  path: string,
  beforeOffset: number,
  maxBytes: number,
  root: string | ReadonlyArray<string> = "",
) =>
  Effect.tryPromise({
    try: async () => {
      const handle = await openGuarded(root, path);
      try {
        const stats = await handle.stat();
        const end = Math.min(beforeOffset, stats.size);
        const start = Math.max(0, end - maxBytes);
        const buffer = Buffer.alloc(end - start);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        let text = buffer.subarray(0, bytesRead).toString("utf8");
        let firstLineOffset = start;

        if (start > 0) {
          const firstNewline = text.indexOf("\n");
          if (firstNewline === -1) {
            return {
              entries: [],
              hasMore: start > 0,
              identity: { dev: stats.dev, ino: stats.ino },
              offset: start,
            };
          }
          firstLineOffset += Buffer.byteLength(text.slice(0, firstNewline + 1), "utf8");
          text = text.slice(firstNewline + 1);
        }

        const { lines } = splitCompleteLines(text);
        // Un seul saut de ligne en fin de fenêtre peut appartenir à une
        // entrée plus longue que `maxBytes`. La ligne est tronquée : ne la
        // renvoie pas et recule au début de la fenêtre pour que l'appelant
        // puisse continuer à chercher dans les octets précédents.
        if (lines.length === 0 && start > 0) {
          return {
            entries: [],
            hasMore: true,
            identity: { dev: stats.dev, ino: stats.ino },
            offset: start,
          };
        }
        return {
          entries: lines.map(parseEntry),
          hasMore: firstLineOffset > 0,
          identity: { dev: stats.dev, ino: stats.ino },
          offset: firstLineOffset,
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
 * Identité et taille du fichier, sans le lire.
 *
 * Sert à valider un curseur **avant** de l'utiliser : rotation et troncature
 * se détectent sur `dev`/`ino` et sur la taille, sans transferer le contenu.
 */
export const fileSize = (path: string, root: string | ReadonlyArray<string> = "") =>
  Effect.tryPromise({
    try: async (): Promise<{ identity: FileIdentity; size: number }> => {
      const handle = await openGuarded(root, path);
      try {
        const stats = await handle.stat();
        return {
          identity: { dev: stats.dev, ino: stats.ino },
          size: stats.size,
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
