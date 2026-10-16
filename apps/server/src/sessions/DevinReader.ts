/**
 * Lecture des sessions devin, depuis leur **base SQLite**.
 *
 * ⚠️ **Jumeau d'`OpencodeReader`, et pas par goût de la copie.** Les deux
 * magasins se ressemblent — une table, un curseur monotone, un JSON par ligne —
 * mais aucun des deux n'est un cas particulier de l'autre : les tables, les
 * colonnes et les décodeurs diffèrent, et **c'est là que vit toute la logique**.
 * Ce qui est commun n'est pas du code, c'est une **décision** : une ligne = une
 * entrée, le curseur avance sur *toutes* les lignes, la borne du rafraîchissement
 * est incluse. Chaque décision est donc testée **des deux côtés** — un test de
 * chaque côté qui la tient vaut mieux qu'une abstraction qui la cache.
 *
 * Mesuré sur `~/.local/share/devin/cli/sessions.db` (devin 3000.11.92,
 * 2026-10-16) :
 *
 * ```sql
 * CREATE TABLE sessions (id TEXT PRIMARY KEY, …, title TEXT, …);
 * CREATE TABLE message_nodes (
 *   row_id INTEGER PRIMARY KEY AUTOINCREMENT,   -- le curseur
 *   session_id TEXT NOT NULL,
 *   node_id INTEGER NOT NULL,                   -- rang dans la forêt
 *   parent_node_id INTEGER,                     -- NULL pour une racine
 *   chat_message TEXT NOT NULL,                 -- le contenu, en JSON
 *   created_at INTEGER NOT NULL, metadata TEXT, UNIQUE(session_id, node_id));
 * ```
 *
 * ⚠️ **`row_id` et non `node_id`.** `node_id` est un rang **dans la forêt de
 * cette session** : deux sessions ont chacune leur `node_id` 1. S'en servir comme
 * curseur ferait relire la mauvaise conversation dès qu'on change d'agent.
 * `row_id` est unique à la table, et c'est l'ordre d'écriture.
 *
 * ⚠️ **Lecture seule, valeur liée.** La base est ouverte en `readonly` : ce
 * module ne peut pas écrire, par construction. L'identifiant vient d'Herdr et
 * n'est **jamais** interpolé dans le SQL.
 */
import { Database } from "bun:sqlite";
import { ligneDevinVersPi } from "@herdr-remote/shared";
import type { RawEntry } from "./SessionReader.ts";
import type { PageOpencode, DemandeOpencode, ReponseOpencode } from "./OpencodeReader.ts";

/** Racine des données locales de devin. */
export const baseDevin = (): string =>
  process.env["DEVIN_DB"] ?? `${process.env["HOME"] ?? ""}/.local/share/devin/cli/sessions.db`;

/** Une ligne de `message_nodes`, telle que la base la rend. */
interface LigneBrute {
  readonly chat_message: string;
  readonly created_at: number;
  readonly row_id: number;
}

const ouvrir = (base: string): Database => {
  const db = new Database(base, { readonly: true });
  // devin écrit pendant qu'on lit.
  db.exec("PRAGMA busy_timeout = 3000");
  return db;
};

/** Une ligne → une entrée, traduite quand c'est possible. */
const versEntree = (ligne: LigneBrute): RawEntry => {
  let analyse: unknown;
  try {
    analyse = JSON.parse(ligne.chat_message);
  } catch {
    analyse = undefined;
  }

  const traduite = ligneDevinVersPi(analyse, String(ligne.row_id));
  if (traduite !== undefined) {
    return {
      id: traduite.id,
      parentId: null,
      raw: JSON.stringify(traduite),
      timestamp: traduite.timestamp,
      type: "message",
    };
  }

  // Non traduite (`system`, rôle inconnu, JSON illisible) : conservée **telle
  // quelle**. Le fil garde sa fidélité, et l'affichage ignore ce qu'il ne
  // connaît pas.
  const role =
    typeof analyse === "object" && analyse !== null ? Reflect.get(analyse, "role") : null;
  return {
    id: `devin:${String(ligne.row_id)}`,
    parentId: null,
    raw: ligne.chat_message,
    timestamp: Number.isFinite(ligne.created_at)
      ? new Date(ligne.created_at).toISOString()
      : undefined,
    type: typeof role === "string" ? role : "unknown",
  };
};

/**
 * La session existe-t-elle ?
 *
 * ⚠️ Même distinction qu'opencode : un identifiant qu'Herdr annonce mais que la
 * base ignore est une **panne** ; une session connue sans message est une session
 * **vide**, ce qui est bénin.
 */
export const sessionExiste = (base: string, sessionId: string): boolean => {
  const db = ouvrir(base);
  try {
    const trouve = db
      .query<{ n: number }, [string]>("SELECT count(*) AS n FROM sessions WHERE id = ?")
      .get(sessionId);
    return (trouve?.n ?? 0) > 0;
  } finally {
    db.close();
  }
};

const COLONNES = "SELECT row_id, chat_message, created_at FROM message_nodes";

/** Dernière page : lecture **descendante**, remise dans l'ordre de lecture. */
export const lireDerniere = (base: string, sessionId: string, limite: number): PageOpencode => {
  const db = ouvrir(base);
  try {
    const lignes = db
      .query<LigneBrute, [string, number]>(
        `${COLONNES} WHERE session_id = ? ORDER BY row_id DESC LIMIT ?`,
      )
      .all(sessionId, limite + 1);
    const hasMore = lignes.length > limite;
    // La ligne en trop est la plus **ancienne**, donc la dernière en descendant.
    const gardees = lignes.slice(0, limite).toReversed();
    return {
      dernierSeq: gardees.at(-1)?.row_id ?? 0,
      entries: gardees.map(versEntree),
      hasMore,
      premierSeq: gardees[0]?.row_id ?? 0,
    };
  } finally {
    db.close();
  }
};

/**
 * Lignes **à partir** d'un curseur, borne incluse.
 *
 * ⚠️ **Borne incluse, et c'est la même raison qu'opencode.** devin réécrit une
 * ligne quand une génération se termine : son `row_id` ne bouge pas, donc un `>`
 * strict ne renverrait rien. Le client fusionne par identifiant, donc relire est
 * sans danger.
 */
export const lireDepuis = (
  base: string,
  sessionId: string,
  depuis: number,
  limite: number,
): PageOpencode => {
  const db = ouvrir(base);
  try {
    const lignes = db
      .query<LigneBrute, [string, number, number]>(
        `${COLONNES} WHERE session_id = ? AND row_id >= ? ORDER BY row_id LIMIT ?`,
      )
      .all(sessionId, depuis, limite);
    return {
      dernierSeq: lignes.at(-1)?.row_id ?? depuis,
      entries: lignes.map(versEntree),
      hasMore: lignes.length >= limite,
      premierSeq: lignes[0]?.row_id ?? depuis,
    };
  } finally {
    db.close();
  }
};

/** Page **antérieure** au curseur (« charger plus tôt »). */
export const lireAvant = (
  base: string,
  sessionId: string,
  avant: number,
  limite: number,
): PageOpencode => {
  const db = ouvrir(base);
  try {
    const lignes = db
      .query<LigneBrute, [string, number, number]>(
        `${COLONNES} WHERE session_id = ? AND row_id < ? ORDER BY row_id DESC LIMIT ?`,
      )
      .all(sessionId, avant, limite + 1);
    const hasMore = lignes.length > limite;
    const gardees = lignes.slice(0, limite).toReversed();
    return {
      dernierSeq: gardees.at(-1)?.row_id ?? avant,
      entries: gardees.map(versEntree),
      hasMore,
      premierSeq: gardees[0]?.row_id ?? avant,
    };
  } finally {
    db.close();
  }
};

/**
 * Une page prête à mettre dans la réponse HTTP.
 *
 * ⚠️ **Même forme que celle d'opencode**, pour que la route n'ait qu'un chemin :
 * elle choisit un moteur, puis appelle la même fonction.
 */
export const pageSession = (
  source: { readonly base: string; readonly sessionId: string },
  demande: DemandeOpencode,
): ReponseOpencode => {
  if (demande.avant !== undefined) {
    const page = lireAvant(source.base, source.sessionId, demande.avant, demande.lignes);
    return {
      curseur: demande.avant,
      entries: page.entries,
      hasMore: page.hasMore,
      incremental: false,
      previousSeq: page.hasMore ? page.premierSeq : undefined,
    };
  }
  if (demande.depuis !== undefined) {
    const page = lireDepuis(source.base, source.sessionId, demande.depuis, demande.lignes);
    return {
      curseur: page.dernierSeq,
      entries: page.entries,
      hasMore: page.hasMore,
      incremental: true,
      previousSeq: page.hasMore ? page.premierSeq : undefined,
    };
  }
  const page = lireDerniere(source.base, source.sessionId, demande.lignes);
  return {
    curseur: page.dernierSeq,
    entries: page.entries,
    hasMore: page.hasMore,
    incremental: false,
    previousSeq: page.hasMore ? page.premierSeq : undefined,
  };
};

/** Le moteur devin, sous la forme qu'attend la route. */
export const moteurDevin = {
  lireDerniere,
  pageSession,
  sessionExiste,
} as const;
