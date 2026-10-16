/**
 * Lecture des sessions opencode, depuis leur **base SQLite**.
 *
 * ⚠️ **Le contrat de ce module est celui du lecteur de fichier.** `RawEntry`,
 * `hasMore`, curseur : tout est identique, à une différence près — le curseur
 * avance par **numéro de séquence** au lieu d'un offset d'octets. C'est ce qui
 * permet à la route de session de servir opencode sans connaître SQLite.
 *
 * ⚠️ **`seq` et non `rowid`.** La table porte une colonne `seq` explicite
 * (`session_message.seq`), et c'est elle qui ordonne la conversation. `rowid`
 * suit l'ordre d'insertion, ce qui n'est pas la même chose dès qu'une ligne est
 * réécrite.
 *
 * ⚠️ **Une ligne = une entrée, même quand elle n'est pas traduite.** Le curseur
 * doit avancer sur *toutes* les lignes lues, y compris `idle`, `system` ou
 * `synthetic`. Ne l'avancer que sur les lignes traduites ferait relire les mêmes
 * lignes à chaque tour — indéfiniment — et le rafraîchissement ne s'arrêterait
 * jamais.
 *
 * ⚠️ **Lecture seule, et paramètres liés.** La base est ouverte en `readonly` :
 * ce module ne peut pas écrire, par construction. L'identifiant de session vient
 * d'Herdr et n'est **jamais** interpolé dans le SQL : une valeur liée ne peut pas
 * changer la requête.
 */
import { Database } from "bun:sqlite";
import { ligneOpencodeVersPi } from "@herdr-remote/shared";
import type { RawEntry } from "./SessionReader.ts";

/** Une page de conversation opencode. */
export interface PageOpencode {
  readonly entries: ReadonlyArray<RawEntry>;
  /** Des messages plus anciens existent hors de la fenêtre. */
  readonly hasMore: boolean;
  /**
   * Première ligne de la fenêtre **rendue** — la base du curseur « plus tôt ».
   *
   * ⚠️ Ne pas confondre avec `dernierSeq` : ils sont égaux quand la page tient
   * en une ligne, et le confondre ferait redemander la même page.
   */
  readonly premierSeq: number;
  /** Dernière ligne **lue** — la position du prochain rafraîchissement. */
  readonly dernierSeq: number;
}

/** Une ligne telle que la base la rend. */
interface LigneBrute {
  readonly data: string;
  readonly id: string;
  readonly seq: number;
  readonly time_created: number;
  readonly type: string;
}

/**
 * Ouvre la base **en lecture seule**.
 *
 * ⚠️ `busy_timeout` : opencode écrit pendant qu'on lit. Sans délai d'attente, un
 * verrou pris au mauvais moment ferait échouer la lecture au lieu d'attendre
 * quelques millisecondes.
 */
const ouvrir = (base: string): Database => {
  const db = new Database(base, { readonly: true });
  db.exec("PRAGMA busy_timeout = 3000");
  return db;
};

/** Une ligne de la base → une entrée de session, traduite quand c'est possible. */
const versEntree = (ligne: LigneBrute): RawEntry => {
  let analyse: unknown;
  try {
    analyse = JSON.parse(ligne.data);
  } catch {
    analyse = undefined;
  }

  const traduite = ligneOpencodeVersPi(ligne.type, analyse, ligne.id);
  if (traduite !== undefined) {
    return {
      id: traduite.id,
      parentId: null,
      raw: JSON.stringify(traduite),
      timestamp: traduite.timestamp,
      type: "message",
    };
  }

  // Une ligne non traduite est conservée **telle quelle** : le fil garde sa
  // fidélité, et un type inconnu ne fait pas tomber la lecture. La date vient de
  // la colonne, qui est toujours renseignée.
  const horodatage = new Date(ligne.time_created).toISOString();
  return {
    id: `opencode:${ligne.id}`,
    parentId: null,
    raw: ligne.data,
    timestamp: Number.isFinite(ligne.time_created) ? horodatage : undefined,
    type: ligne.type,
  };
};

/**
 * La session existe-t-elle dans la base ?
 *
 * ⚠️ **C'est une distinction de diagnostic, pas une commodité.** Un identifiant
 * qu'Herdr annonce mais que la base ne connaît pas est une **erreur** (mauvaise
 * base, mauvais identifiant) ; une session connue mais sans message est une
 * session **vide**, ce qui est bénin. Les confondre donnerait soit une erreur
 * rouge sur un agent qui démarre, soit un écran muet sur une vraie panne.
 */
export const sessionExiste = (base: string, sessionId: string): boolean => {
  const db = ouvrir(base);
  try {
    const trouve = db
      .query<{ n: number }, [string]>("SELECT count(*) AS n FROM session_v2 WHERE id = ?")
      .get(sessionId);
    return (trouve?.n ?? 0) > 0;
  } finally {
    db.close();
  }
};

/**
 * Fenêtre des `limite` dernières lignes, en ordre **descendant** (la plus
 * récente d'abord).
 *
 * ⚠️ Lecture descendante parce que ce sont les plus récentes qu'on veut. La
 * remise dans l'ordre de lecture se fait à la fin, une seule fois.
 */
const fenetreDescendante = (db: Database, sessionId: string, limite: number): LigneBrute[] =>
  db
    .query<LigneBrute, [string, number]>(
      "SELECT id, type, seq, time_created, data FROM session_message " +
        "WHERE session_id = ? ORDER BY seq DESC LIMIT ?",
    )
    .all(sessionId, limite);

/**
 * Dernière page de la conversation.
 *
 * ⚠️ On lit `limite + 1` lignes **en descendant** pour savoir s'il en existe de
 * plus anciennes — puis on jette la dernière, qui est la plus ancienne. Compter
 * avec un second `count(*)` coûterait une requête de plus sur une base qui peut
 * être grosse.
 */
export const lireDerniere = (base: string, sessionId: string, limite: number): PageOpencode => {
  const db = ouvrir(base);
  try {
    const lignes = fenetreDescendante(db, sessionId, limite + 1);
    const hasMore = lignes.length > limite;
    // `slice(0, limite)` : on garde les plus **récentes** des `limite + 1`.
    const gardees = lignes.slice(0, limite).toReversed();
    return {
      dernierSeq: gardees.at(-1)?.seq ?? 0,
      entries: gardees.map(versEntree),
      hasMore,
      premierSeq: gardees[0]?.seq ?? 0,
    };
  } finally {
    db.close();
  }
};

/**
 * Lignes **à partir** d'un curseur, borne incluse.
 *
 * ⚠️ **`seq >= ?` et non `seq > ?`, et c'est tout le correctif du streaming.**
 * Mesuré sur la base réelle : **1 943 lignes sur 1 993 (97 %) sont réécrites
 * après leur création.** Une réponse d'opencode grossit dans la **même** ligne
 * pendant plusieurs secondes (mesuré : 7,8 s sur un message) — son `seq` ne
 * bouge pas. Un `>` strict ne renvoyait donc **rien** tant qu'une nouvelle ligne
 * n'apparaissait pas : la réponse n'arrivait qu'en rouvrant la conversation,
 * c'est-à-dire en relisant une page initiale complète.
 *
 * Le coût de l'inclusion est d'**une ligne relue** par rafraîchissement, et il
 * est assumé : c'est le seul moyen de voir une ligne changer sans le flux
 * d'événements d'opencode, que nous ne lisons pas. En contrepartie, le client
 * doit **remplacer par identifiant** au lieu d'empiler — ce qu'il fait
 * désormais.
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
        "SELECT id, type, seq, time_created, data FROM session_message " +
          "WHERE session_id = ? AND seq >= ? ORDER BY seq LIMIT ?",
      )
      .all(sessionId, depuis, limite);
    const derniere = lignes.at(-1);
    return {
      dernierSeq: derniere?.seq ?? depuis,
      entries: lignes.map(versEntree),
      // Une page pleine peut cacher la suite : on ne l'affirme pas, on la signale.
      hasMore: lignes.length >= limite,
      premierSeq: lignes[0]?.seq ?? depuis,
    };
  } finally {
    db.close();
  }
};

/**
 * Page **antérieure** (« charger plus tôt »).
 *
 * ⚠️ Lecture descendante puis remise dans l'ordre : c'est la page qui **précède**
 * le curseur, donc les `limite` lignes juste avant lui. Lire en montant depuis 0
 * renverrait le début de la conversation, pas la page d'avant.
 */
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
        "SELECT id, type, seq, time_created, data FROM session_message " +
          "WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
      )
      .all(sessionId, avant, limite + 1);
    const hasMore = lignes.length > limite;
    // Même règle que pour la dernière page : la ligne en trop est la plus
    // ancienne, donc la **dernière** de la lecture descendante.
    const gardees = lignes.slice(0, limite).toReversed();
    return {
      dernierSeq: gardees.at(-1)?.seq ?? avant,
      entries: gardees.map(versEntree),
      hasMore,
      premierSeq: gardees[0]?.seq ?? avant,
    };
  } finally {
    db.close();
  }
};

/** Ce qu'on demande à une session opencode. */
export interface DemandeOpencode {
  /** Page **antérieure** au curseur (« charger plus tôt »). */
  readonly avant?: number | undefined;
  /** Rafraîchissement : lignes **postérieures** à ce numéro. */
  readonly depuis?: number | undefined;
  readonly lignes: number;
}

/**
 * Une page prête à mettre dans la réponse HTTP, sans plomberie de transport.
 *
 * ⚠️ **Pure, et c'est voulu** : c'est ce qui permet de la tester sur une base
 * fabriquée sans monter un serveur ni un agent. La route ne fait plus que
 * l'encodage du curseur et la sérialisation.
 */
export interface ReponseOpencode {
  /** Position à reporter dans le curseur rendu au client. */
  readonly curseur: number;
  readonly entries: ReadonlyArray<RawEntry>;
  readonly hasMore: boolean;
  readonly incremental: boolean;
  /** Position de la page précédente, quand il en reste une. */
  readonly previousSeq: number | undefined;
}

export const pageSessionOpencode = (
  source: { readonly base: string; readonly sessionId: string },
  demande: DemandeOpencode,
): ReponseOpencode => {
  if (demande.avant !== undefined) {
    const page = lireAvant(source.base, source.sessionId, demande.avant, demande.lignes);
    return {
      // Le curseur du client ne bouge pas : c'est **lui** qui reste la position
      // courante, et la page d'avant est décrite par `previousSeq`.
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
