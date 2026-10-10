/**
 * Journal d'erreurs, consultable.
 *
 * **Pourquoi.** Des avertissements et des erreurs s'affichaient dans
 * l'application sans laisser de trace nulle part. Impossible de les retrouver
 * après coup, donc impossible de les corriger — l'utilisateur devenait mon
 * seul témoin.
 *
 * Tout ce qui est anormal est désormais écrit **au même endroit** :
 * `~/.herdr-remote/herdr-remote.log`. Côté serveur comme côté client : une
 * erreur vue dans le navigateur est renvoyée ici, car c'est souvent là que la
 * cause réelle se trouve.
 *
 * Le fichier est **append-only** et borné en taille : un journal ne doit pas
 * remplir le disque.
 */
import { Effect } from "effect";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LOG_PATH = join(homedir(), ".herdr-remote", "herdr-remote.log");

/** Au-delà, le fichier est renommé : on garde une génération précédente. */
const MAX_BYTES = 4 * 1024 * 1024;

export type LogLevel = "error" | "warn" | "info";

export interface LogEntry {
  readonly level: LogLevel;
  /** Origine : `server` ou `client`. */
  readonly source: string;
  readonly message: string;
  readonly detail?: unknown;
}

const line = (entry: LogEntry): string => {
  const at = new Date().toISOString();
  const detail = entry.detail === undefined ? "" : ` | ${safeJson(entry.detail)}`;
  return `${at} [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}${detail}\n`;
};

const safeJson = (value: unknown): string => {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text.slice(0, 2000);
  } catch {
    // Référence circulaire : on ne perd pas l'entrée pour autant.
    return String(value);
  }
};

/** Rotation : le fichier courant devient `.1`, et on repart de zéro. */
const rotateIfNeeded = async (): Promise<void> => {
  try {
    const info = await stat(LOG_PATH);
    if (info.size > MAX_BYTES) await rename(LOG_PATH, `${LOG_PATH}.1`);
  } catch {
    // Fichier absent : rien à faire.
  }
};

/**
 * Écrit une entrée. **Ne peut pas échouer** : un journal qui casse le service
 * serait pire que pas de journal.
 */
export const writeLog = (entry: LogEntry): Effect.Effect<void> =>
  Effect.promise(async () => {
    try {
      await mkdir(dirname(LOG_PATH), { recursive: true });
      await rotateIfNeeded();
      await appendFile(LOG_PATH, line(entry), "utf8");
    } catch {
      // Silencieux par construction.
    }
  });

/** Écrit plusieurs entrées d'un coup. */
export const writeLogs = (entries: ReadonlyArray<LogEntry>): Effect.Effect<void> =>
  Effect.forEach(entries, writeLog, { discard: true });
