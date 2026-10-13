/**
 * Construit les lignes de la liste des conversations (B10).
 *
 * **Source unique pour l'écran d'accueil.** Les règles viennent du tableau
 * « Règles déjà tranchées » du backlog et ne sont négociables nulle part :
 *
 * - **Titre** = premier non vide parmi titre Herdr, libellé d'onglet, libellé
 *   de projet, `paneId`. Jamais de titre inventé : si aucun n'existe, c'est le
 *   `paneId`, qui est exact.
 * - **Aperçu** = dernier message texte de l'agent, facultatif.
 * - **Horodatage** = dernier `timestamp` connu, **absent** plutôt qu'à 0.
 * - **Aucun « non lu »** : Herdr n'expose aucun compteur exploitable.
 */
import { Effect, Option, Result } from "effect";
import type { AgentStatus, ConversationSummary } from "@herdr-remote/shared";
import { readTail, type TailedSession } from "../sessions/SessionReader.ts";

/** Un agent tel que Herdr le décrit, sans ce que le serveur en sait. */
export interface RawPane {
  readonly paneId: string;
  readonly workspaceId: string;
  /** Titre donné par Herdr, s'il y en a un. */
  readonly title?: string | null;
  readonly tabLabel?: string | null;
  readonly workspaceLabel?: string | null;
  readonly agentStatus?: string | null;
  /** Branche git du dossier de travail, résolue par l'appelant. */
  readonly branch?: string | null | undefined;
  /** Chemin du fichier de session, ou `null` si l'agent n'en a pas. */
  readonly sessionPath?: string | null;
}

/**
 * Libellé d'onglet **purement numérique** = nom par défaut de Herdr.
 *
 * Herdr nomme les onglets « 1 », « 2 »… Un libellé numérique n'apprend rien à
 * l'utilisateur ; le numéro d'onglet, lui, est exact (D012.5).
 */
const isDefaultLabel = (label: string | null | undefined): label is null =>
  label === undefined || label === null || /^\d+$/.test(label.trim());

/**
 * États connus de Herdr.
 *
 * Table plutôt que `Set` : la garde de type vérifie que chaque clé est bien un
 * `AgentStatus`, donc ajouter un état au contrat **casse la compilation** ici
 * tant qu'il n'est pas listé.
 */
const CONNUS: Record<string, AgentStatus> = {
  blocked: "blocked",
  done: "done",
  idle: "idle",
  unknown: "unknown",
  working: "working",
};

/**
 * Convertit l'état brut de Herdr en union fermée.
 *
 * Herdr n'ajoute pas d'état sans prévenir, mais un état inconnu ne doit pas
 * fuiter tel quel dans l'interface : il devient `unknown`, qui est **affiché**
 * comme tel. On n'invente pas de nouvel état.
 */
export const toStatus = (brut: string | null | undefined): AgentStatus => {
  if (brut === undefined || brut === null) return "unknown";
  return CONNUS[brut.trim().toLowerCase()] ?? "unknown";
};

/** Premier non vide, dans l'ordre du tableau de règles. */
export const titleOf = (pane: RawPane): string => {
  const titre = pane.title?.trim();
  if (titre !== undefined && titre.length > 0) return titre;

  const onglet = pane.tabLabel;
  if (
    onglet !== undefined &&
    onglet !== null &&
    !isDefaultLabel(onglet) &&
    onglet.trim().length > 0
  )
    return onglet.trim();

  const projet = pane.workspaceLabel?.trim();
  if (projet !== undefined && projet.length > 0) return projet;

  return pane.paneId;
};

/**
 * Dernier texte écrit par l'agent dans la session.
 *
 * On ne **résume** rien et on ne **fabrique** pas de question : si l'agent
 * n'a rien dit, on renvoie `undefined`, pas une phrase plausible (D017.1).
 */
export const previewOf = (tailed: TailedSession): string | undefined =>
  texteDeRole(tailed, "assistant");

/**
 * Dernier **message de l'utilisateur**, pour la ligne de la liste.
 *
 * ⚠️ C'est la demande, pas la réponse : c'est ce que l'utilisateur a écrit et
 * qu'il reconnaît. Une liste qui montrerait la réponse de l'agent obligerait à
 * la relire pour se rappeler ce qu'on avait demandé.
 */
export const lastPromptOf = (tailed: TailedSession): string | undefined =>
  texteDeRole(tailed, "user");

/** Dernier texte d'un rôle donné, en remontant le fil. */
const texteDeRole = (tailed: TailedSession, role: string): string | undefined => {
  for (let index = tailed.entries.length - 1; index >= 0; index -= 1) {
    const entry = tailed.entries[index];
    if (entry === undefined) continue;
    if (roleDeLigne(entry.raw) !== role) continue;
    const texte = extractText(entry.raw);
    if (texte !== undefined && texte.length > 0) return texte;
  }
  return undefined;
};

/**
 * Modèle et niveau de raisonnement **en vigueur**.
 *
 * ⚠️ La session les porte comme des **changements** (`model_change`,
 * `thinking_level_change`), pas comme un état courant. On remonte donc le fil
 * jusqu'au dernier de chaque, et on ne déduit rien : sans changement, le champ
 * reste absent — l'agent n'a pas forcément déclaré son modèle.
 */
export const reglagesOf = (
  tailed: TailedSession,
): {
  readonly model?: string;
  readonly thinking?: string;
} => {
  let model: string | undefined;
  let thinking: string | undefined;
  for (let index = tailed.entries.length - 1; index >= 0; index -= 1) {
    const entry = tailed.entries[index];
    if (entry === undefined) continue;
    // Les deux peuvent être trouvés dans la même passe : on ne s'arrête que
    // lorsque les deux sont connus, pour ne pas relire la session deux fois.
    if (model === undefined && entry.type === "model_change") {
      const lu = lireChamp(entry.raw, "modelId");
      if (lu !== undefined) model = lu;
    }
    if (thinking === undefined && entry.type === "thinking_level_change") {
      const lu = lireChamp(entry.raw, "thinkingLevel");
      if (lu !== undefined) thinking = lu;
    }
    if (model !== undefined && thinking !== undefined) break;
  }
  return {
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking }),
  };
};

/** Champ texte de premier niveau d'une ligne, ou `undefined`. */
const lireChamp = (raw: string, cle: string): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const valeur = lire(parsed, cle);
  return typeof valeur === "string" && valeur.trim().length > 0 ? valeur.trim() : undefined;
};

/** Dernier horodatage connu. Jamais remplacé par la date du jour. */
export const timestampOf = (tailed: TailedSession): number | undefined => {
  for (let index = tailed.entries.length - 1; index >= 0; index -= 1) {
    const at = tailed.entries[index]?.timestamp;
    if (at === undefined) continue;
    /*
      ⚠️ Les horodatages Pi sont des **chaînes ISO**, pas des nombres. `Number()`
      sur `"2026-10-09T15:08:21.784Z"` donne `NaN`, donc l'horodatage était
      silencieusement perdu — la liste n'affichait aucune date, et rien ne le
      signalait.
    */
    const valeur = Date.parse(at);
    if (Number.isFinite(valeur)) return valeur;
  }
  return undefined;
};

/**
 * Extrait le texte d'une entrée d'assistant.
 *
 * Une ligne illisible donne `undefined` : mieux vaut un aperçu absent qu'un
 * aperçu composé de balises JSON.
 */
/** `true` si la valeur est un objet exploitable par clé. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Lit une clé d'un objet JSON sans assertion de type. */
const lire = (source: Record<string, unknown>, cle: string): unknown => source[cle];

/**
 * Corps `message` d'une ligne de session.
 *
 * ⚠️ Une ligne Pi a la forme `{ type: "message", message: { role, content } }`.
 * Les champs utiles sont **un niveau plus bas** que la ligne : lire `content` à
 * la racine ne trouve rien, et c'est exactement le défaut qui faisait que
 * l'aperçu n'apparaissait **jamais** dans la liste.
 */
const corpsDeLigne = (raw: string): Record<string, unknown> | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const corps = lire(parsed, "message");
  return isRecord(corps) ? corps : undefined;
};

/** Rôle déclaré par une ligne, ou `undefined`. */
const roleDeLigne = (raw: string): string | undefined => {
  const corps = corpsDeLigne(raw);
  if (corps === undefined) return undefined;
  const role = lire(corps, "role");
  return typeof role === "string" ? role : undefined;
};

/**
 * Texte d'un **corps de message**.
 *
 * Une ligne illisible donne `undefined` : mieux vaut un aperçu absent qu'un
 * aperçu composé de balises JSON.
 */
const extractText = (raw: string): string | undefined => {
  const parsed = corpsDeLigne(raw);
  if (parsed === undefined) return undefined;

  const direct = lire(parsed, "text");
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();

  const contenu = lire(parsed, "content");
  if (typeof contenu === "string" && contenu.trim().length > 0) return contenu.trim();
  if (Array.isArray(contenu)) {
    // Une réponse d'agent est structurée : texte, outils, réflexion. On ne
    // garde que les blocs **textuels** — un aperçu composé de JSON d'outils
    // n'apprendrait rien dans la liste.
    const morceaux: Array<string> = [];
    for (const bloc of contenu) {
      if (!isRecord(bloc)) continue;
      const texte = lire(bloc, "text");
      if (typeof texte === "string" && texte.trim().length > 0) morceaux.push(texte.trim());
    }
    return morceaux.length > 0 ? morceaux.join(" ") : undefined;
  }
  return undefined;
};

/** Réexporté depuis le contrat partagé (S06). */
export { PREVIEW_BYTES } from "@herdr-remote/shared";

import { PREVIEW_BYTES as PREVIEW } from "@herdr-remote/shared";

/**
 * Construit la ligne d'un pane.
 *
 * L'absence de session n'est pas une erreur : le JSONL naît au premier
 * message. On distingue donc trois états, et `error` reste distingué de
 * `absent` pour qu'une session illisible ne passe pas pour neuve.
 */
export const summaryOf = (
  pane: RawPane,
  read: (path: string) => Effect.Effect<TailedSession, unknown>,
): Effect.Effect<ConversationSummary> =>
  Effect.gen(function* () {
    const base = {
      status: toStatus(pane.agentStatus),
      title: titleOf(pane),
      workspaceId: pane.workspaceId,
      paneId: pane.paneId,
      ...(pane.branch === undefined || pane.branch === null ? {} : { branch: pane.branch }),
    };

    const path = pane.sessionPath ?? null;
    if (path === null) {
      // Pas de session du tout : ni aperçu, ni horodatage, pas de `sessionPath`
      // inventé. Le champ reste **absent**.
      return { ...base, sessionState: "absent" as const };
    }

    const tailed = yield* Effect.result(read(path));
    if (Result.isFailure(tailed)) {
      return { ...base, sessionState: "error" as const };
    }

    const value = Option.getOrUndefined(Result.getSuccess(tailed));
    if (value === undefined) {
      return { ...base, sessionState: "error" as const };
    }
    if (value.entries.length === 0) {
      // Le fichier existe mais ne contient rien : `absent` est réservé au
      // fichier qui n'existe pas, donc l'état reste « disponible et vide ».
      return { ...base, sessionState: "available" as const };
    }

    const preview = previewOf(value);
    const lastPrompt = lastPromptOf(value);
    const timestamp = timestampOf(value);
    return {
      ...base,
      ...(preview === undefined ? {} : { preview }),
      ...(lastPrompt === undefined ? {} : { lastPrompt }),
      ...reglagesOf(value),
      sessionState: "available" as const,
      ...(timestamp === undefined ? {} : { timestamp }),
    };
  });

/** Lecteur par défaut : la fin du fichier, bornée. */
export const defaultRead =
  (root: string | ReadonlyArray<string>) =>
  (path: string): Effect.Effect<TailedSession, unknown> =>
    readTail(path, PREVIEW, root);
