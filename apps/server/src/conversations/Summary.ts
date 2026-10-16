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
import {
  fileSize,
  readBefore,
  readTail,
  tailFrom,
  type TailedSession,
} from "../sessions/SessionReader.ts";

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
 * `true` si un libellé est **purement numérique** — « 2 », « 17 ».
 *
 * ⚠️ **Une seule règle pour tout le dépôt.** Herdr nomme ses onglets par défaut
 * « 1 », « 2 »… : un tel libellé n'apprend rien à l'utilisateur. La liste des
 * conversations et les notifications doivent en dire la même chose — et c'est
 * bien la même question, pas deux qui se ressemblent.
 */
export const estNumerique = (label: string): boolean => /^\d+$/.test(label.trim());

/**
 * Libellé d'onglet **purement numérique** = nom par défaut de Herdr.
 *
 * Herdr nomme les onglets « 1 », « 2 »… Un libellé numérique n'apprend rien à
 * l'utilisateur ; le numéro d'onglet, lui, est exact (D012.5).
 */
const isDefaultLabel = (label: string | null | undefined): label is null =>
  label === undefined || label === null || estNumerique(label);

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
  texteDeRole(tailed, "assistant") ?? dernierOutilDeRole(tailed, "assistant");

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
 * Dernier **appel d'outil** de l'agent, résumé en une ligne.
 *
 * ⚠️ **Pourquoi ce repli existe.** Un agent bloqué n'a souvent rien *dit* : il a
 * appelé un outil et attend. Sans ce repli, sa ligne dans la liste — celle de la
 * section « À traiter », justement — restait **vide**, alors que les autres
 * montraient leur dernière demande. L'utilisateur voyait qu'il fallait agir sans
 * voir sur quoi. Mesuré sur un agent codex en attente d'approbation : la fenêtre
 * lue ne contenait que des appels d'outils, donc aucun texte.
 *
 * On ne fabrique toujours rien : sans appel d'outil lisible, `undefined`.
 */
const dernierOutilDeRole = (tailed: TailedSession, role: string): string | undefined => {
  for (let index = tailed.entries.length - 1; index >= 0; index -= 1) {
    const entry = tailed.entries[index];
    if (entry === undefined) continue;
    if (roleDeLigne(entry.raw) !== role) continue;

    const contenu = lire(corpsDeLigne(entry.raw) ?? {}, "content");
    if (!Array.isArray(contenu)) continue;

    for (const bloc of contenu) {
      if (!isRecord(bloc)) continue;
      if (lire(bloc, "type") !== "toolCall") continue;

      const nom = lire(bloc, "name");
      if (typeof nom !== "string" || nom.length === 0) continue;

      const indice = indiceDArguments(lire(bloc, "arguments"));
      return indice === undefined ? nom : `${nom} · ${indice}`;
    }
  }
  return undefined;
};

/** Indice lisible dans les arguments d'un outil — jamais de JSON déversé. */
const indiceDArguments = (args: unknown): string | undefined => {
  if (typeof args === "string") {
    const premiere = args.split("\n")[0]?.trim() ?? "";
    return premiere.length === 0 ? undefined : premiere.slice(0, 80);
  }
  if (!isRecord(args)) return undefined;
  // `title` d'abord : c'est le libellé que l'agent donne lui-même à son action.
  for (const cle of ["title", "cmd", "command", "path", "code"]) {
    const valeur = lire(args, cle);
    if (typeof valeur === "string" && valeur.trim().length > 0) return valeur.trim().slice(0, 80);
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
  readonly provider?: string;
  readonly thinking?: string;
} => {
  let model: string | undefined;
  let provider: string | undefined;
  let thinking: string | undefined;
  for (let index = tailed.entries.length - 1; index >= 0; index -= 1) {
    const entry = tailed.entries[index];
    if (entry === undefined) continue;
    // Les deux peuvent être trouvés dans la même passe : on ne s'arrête que
    // lorsque les deux sont connus, pour ne pas relire la session deux fois.
    if (model === undefined && entry.type === "model_change") {
      const lu = lireChamp(entry.raw, "modelId");
      if (lu !== undefined) {
        model = lu;
        provider = lireChamp(entry.raw, "provider");
      }
    }
    if (thinking === undefined && entry.type === "thinking_level_change") {
      const lu = lireChamp(entry.raw, "thinkingLevel");
      if (lu !== undefined) thinking = lu;
    }
    if (model !== undefined && thinking !== undefined) break;
  }
  return {
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
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
  read: (path: string) => Effect.Effect<SummaryRead, unknown>,
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
    if (value.entries.length === 0 && value.summaryMetadata === undefined) {
      // Le fichier existe mais ne contient rien : `absent` est réservé au
      // fichier qui n'existe pas, donc l'état reste « disponible et vide ».
      return { ...base, sessionState: "available" as const };
    }

    const metadata = value.summaryMetadata ?? metadataOf(value);
    return {
      ...base,
      ...(metadata.preview === undefined ? {} : { preview: metadata.preview }),
      ...(metadata.lastPrompt === undefined ? {} : { lastPrompt: metadata.lastPrompt }),
      ...(metadata.model === undefined ? {} : { model: metadata.model }),
      ...(metadata.provider === undefined ? {} : { provider: metadata.provider }),
      ...(metadata.thinking === undefined ? {} : { thinking: metadata.thinking }),
      sessionState: "available" as const,
      ...(metadata.timestamp === undefined ? {} : { timestamp: metadata.timestamp }),
    };
  });

interface SummaryMetadata {
  readonly lastPrompt?: string;
  readonly model?: string;
  readonly preview?: string;
  readonly provider?: string;
  readonly thinking?: string;
  readonly timestamp?: number;
}

interface SummaryRead extends TailedSession {
  readonly summaryMetadata?: SummaryMetadata;
}

interface SummaryCacheEntry {
  readonly identity: TailedSession["identity"];
  readonly metadata: SummaryMetadata;
  readonly offset: number;
  readonly pending: string;
  readonly size: number;
}

const CACHE_MAX_ENTRIES = 256;

/**
 * Budget de remontée pour retrouver les réglages en vigueur.
 *
 * ⚠️ **Borné, et c'est un choix assumé.** Sans plafond, ouvrir une session de
 * 31 Mo coûterait jusqu'à 31 Mo de lecture pour un réglage qui peut ne pas y
 * être. Le budget est de **2 Mo** (32 fenêtres de 64 Ko), payé **une fois** par
 * session — l'entrée est mise en cache ensuite.
 *
 * Mesuré le 2026-10-14 sur deux sessions réelles :
 *
 * | session        | taille | `model_change` | `thinking_level_change` |
 * |----------------|--------|----------------|-------------------------|
 * | prusa-pi-setup | 31 Mo  | 608 Ko         | 641 Ko                  |
 * | herdr-pwa      | 9 Mo   | dans la queue  | ~9 Mo (9 octobre)       |
 *
 * ⚠️ **La dernière ligne est la limite, et elle est réelle** : un niveau de
 * pensée inchangé depuis des jours peut être plus loin que le budget. Il reste
 * alors **absent**, et l'interface dit déjà qu'un réglage non déclaré n'est pas
 * connu — c'est honnête. La solution exacte serait de lire la barre d'état de
 * l'agent plutôt que son journal, ce qui est un autre travail.
 *
 * ⚠️ **`preview` remonte le fil pour la même raison, et c'est un cas mesuré.**
 * Une session claude réelle avait **94 % de son fichier en comptabilité**
 * (`api-request-blob`, `api-request`, `attachment`…) : sur 511 Kio, 481 Kio ne
 * portent pas la conversation. La fenêtre de 64 Kio ne contenait donc **aucune
 * ligne d'assistant**, et l'agent — qui avait pourtant parlé — s'affichait sans
 * aperçu. Il manquait le dernier champ à cette remontée.
 */
const FENETRES_REGLAGES = 32;

const metadataOf = (tailed: TailedSession): SummaryMetadata => {
  const preview = previewOf(tailed);
  const lastPrompt = lastPromptOf(tailed);
  const timestamp = timestampOf(tailed);
  return {
    ...(preview === undefined ? {} : { preview }),
    ...(lastPrompt === undefined ? {} : { lastPrompt }),
    ...reglagesOf(tailed),
    ...(timestamp === undefined ? {} : { timestamp }),
  };
};

const metadataWithNewEntries = (
  previous: SummaryMetadata,
  newEntries: TailedSession,
): SummaryMetadata => {
  const next = metadataOf(newEntries);
  const preview = next.preview ?? previous.preview;
  const lastPrompt = next.lastPrompt ?? previous.lastPrompt;
  const model = next.model ?? previous.model;
  const provider = next.model === undefined ? previous.provider : next.provider;
  const thinking = next.thinking ?? previous.thinking;
  const timestamp = next.timestamp ?? previous.timestamp;
  return {
    ...(preview === undefined ? {} : { preview }),
    ...(lastPrompt === undefined ? {} : { lastPrompt }),
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(timestamp === undefined ? {} : { timestamp }),
  };
};

/**
 * Lecteur de résumé avec cache incrémental par session.
 *
 * Le prompt peut se trouver bien avant les derniers messages quand l'agent
 * produit beaucoup d'outils ou de texte. On remonte donc une seule fois par
 * fichier jusqu'au dernier prompt utilisateur, puis on ne lit que les ajouts.
 * Le cache est en mémoire du serveur et borné en nombre de sessions.
 */
export const defaultRead = (root: string | ReadonlyArray<string>) => {
  const cache = new Map<string, SummaryCacheEntry>();

  const remember = (path: string, value: SummaryCacheEntry): void => {
    cache.delete(path);
    cache.set(path, value);
    if (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  return (path: string): Effect.Effect<SummaryRead, unknown> =>
    Effect.gen(function* () {
      const current = yield* fileSize(path, root);
      const previous = cache.get(path);
      if (
        previous !== undefined &&
        previous.identity.dev === current.identity.dev &&
        previous.identity.ino === current.identity.ino &&
        current.size >= previous.size
      ) {
        if (current.size === previous.size) {
          remember(path, previous);
          return {
            entries: [],
            hasMore: false,
            identity: previous.identity,
            offset: previous.offset,
            pending: previous.pending,
            summaryMetadata: previous.metadata,
          };
        }

        const appended = yield* tailFrom(path, previous.offset, previous.pending, root);
        const metadata = metadataWithNewEntries(previous.metadata, appended);
        const size = appended.offset + Buffer.byteLength(appended.pending, "utf8");
        const next: SummaryCacheEntry = {
          identity: appended.identity,
          metadata,
          offset: appended.offset,
          pending: appended.pending,
          size,
        };
        remember(path, next);
        return { ...appended, summaryMetadata: metadata };
      }

      const initial = yield* readTail(path, PREVIEW, root);
      const metadata = metadataOf(initial);

      /*
        ⚠️ **Remonter le fil pour les réglages en vigueur.**

        Le modèle et le niveau de pensée ne sont écrits qu'en **changements**
        (`model_change`, `thinking_level_change`) : la session ne les répète pas.
        Dans une longue conversation, le dernier est donc loin de la fin —
        mesuré à **369 Ko du bord** sur une session de 31 Mo, alors que l'aperçu
        n'en lit que 64 Ko. Conséquence visible : l'agent ne déclarait aucun
        modèle, et la feuille de changement s'ouvrait **sans rien
        présélectionner** — ce qui se lisait comme un défaut d'interface alors
        que l'information existait.

        ⚠️ La **première** occurrence rencontrée en remontant est la plus
        récente : c'est elle qui vaut. Une fenêtre plus ancienne ne doit donc
        jamais écraser une valeur déjà trouvée — d'où les `=== undefined`.
      */
      let beforeOffset = initial.startOffset ?? 0;
      let fenetres = 0;
      const incomplet = (): boolean =>
        (metadata.model === undefined ||
          metadata.thinking === undefined ||
          metadata.lastPrompt === undefined ||
          metadata.preview === undefined) &&
        beforeOffset > 0 &&
        fenetres < FENETRES_REGLAGES;
      while (incomplet()) {
        const older = yield* readBefore(path, beforeOffset, PREVIEW, root);
        const plus = metadataOf({ ...older, pending: "" });
        if (metadata.model === undefined && plus.model !== undefined) {
          Object.assign(metadata, { model: plus.model });
        }
        if (metadata.provider === undefined && plus.provider !== undefined) {
          Object.assign(metadata, { provider: plus.provider });
        }
        if (metadata.thinking === undefined && plus.thinking !== undefined) {
          Object.assign(metadata, { thinking: plus.thinking });
        }
        if (metadata.lastPrompt === undefined && plus.lastPrompt !== undefined) {
          Object.assign(metadata, { lastPrompt: plus.lastPrompt });
        }
        if (metadata.preview === undefined && plus.preview !== undefined) {
          Object.assign(metadata, { preview: plus.preview });
        }
        if (older.offset >= beforeOffset) break;
        beforeOffset = older.offset;
        fenetres += 1;
      }

      const size = initial.offset + Buffer.byteLength(initial.pending, "utf8");
      const next: SummaryCacheEntry = {
        identity: initial.identity,
        metadata,
        offset: initial.offset,
        pending: initial.pending,
        size,
      };
      remember(path, next);
      return { ...initial, summaryMetadata: metadata };
    });
};
