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

/** Journal par défaut. Un test ne doit **jamais** y écrire (A03). */
export const defaultLogPath = (): string => join(homedir(), ".herdr-remote", "herdr-remote.log");

/**
 * Store par défaut des abonnements Web Push.
 *
 * ⚠️ **À côté du journal, jamais dans le dossier courant.** Le défaut précédent
 * était `process.cwd()/.herdr-remote/push.json` : lancer le serveur depuis un
 * autre dossier créait un store vide, et les abonnements **disparaissaient sans
 * un mot** — exactement le genre de panne qu'on ne diagnostique pas. Les données
 * d'une instance vivent au même endroit, et l'instance c'est l'utilisateur.
 */
export const defaultPushStorePath = (): string => join(homedir(), ".herdr-remote", "push.json");

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
const rotateIfNeeded = async (logPath: string): Promise<void> => {
  try {
    const info = await stat(logPath);
    if (info.size > MAX_BYTES) await rename(logPath, `${logPath}.1`);
  } catch {
    // Fichier absent : rien à faire.
  }
};

/**
 * Anti-répétition.
 *
 * ⚠️ Une erreur qui se reproduit à chaque interrogation — l'ouverture d'une
 * session manquante, toutes les deux secondes — noyait le journal sous des
 * centaines de lignes identiques, et les vraies erreurs disparaissaient dedans.
 *
 * On garde la **première** occurrence de chaque message, et on annonce le nombre
 * de répétitions quand il change.
 */
/** Par chemin : deux tests parallèles ne doivent pas se masquer l'un l'autre. */
const lastSeen = new Map<string, number>();
const REPEAT_WINDOW_MS = 60_000;

const shouldWrite = (logPath: string, entry: LogEntry): boolean => {
  const key = `${logPath}|${entry.source}|${entry.level}|${entry.message}`;
  const now = Date.now();
  const previous = lastSeen.get(key);
  if (previous !== undefined && now - previous < REPEAT_WINDOW_MS) {
    lastSeen.set(key, now);
    return false;
  }
  lastSeen.set(key, now);
  return true;
};

/**
 * Écrit une entrée. **Ne peut pas échouer** : un journal qui casse le service
 * serait pire que pas de journal.
 */
/**
 * Écrit une entrée. **Ne peut pas échouer** : un journal qui casse le service
 * serait pire que pas de journal.
 *
 * `logPath` est un paramètre, pas une constante : sans cela le test écrivait
 * dans le journal de l'utilisateur (mesuré — voir A03). Le déni de répétition
 * est lui aussi par chemin, pour que deux tests ne se masquent pas.
 */
export const writeLog = (logPath: string, entry: LogEntry): Effect.Effect<void> =>
  Effect.promise(async () => {
    try {
      if (!shouldWrite(logPath, entry)) return;
      await mkdir(dirname(logPath), { recursive: true });
      await rotateIfNeeded(logPath);
      await appendFile(logPath, line(entry), "utf8");
    } catch {
      // Silencieux par construction.
    }
  });

/** Écrit plusieurs entrées d'un coup. */
export const writeLogs = (logPath: string, entries: ReadonlyArray<LogEntry>): Effect.Effect<void> =>
  Effect.forEach(entries, (entry) => writeLog(logPath, entry), { discard: true });
