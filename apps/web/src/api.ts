/**
 * Client de l'API locale.
 *
 * Deux principes issus du protocole (`docs/PROTOCOL.md`) :
 *
 * - un **double envoi** n'est pas une erreur : le serveur répond
 *   `status: "suppressed"` et l'interface le montre comme un état, pas comme un
 *   échec (D007.2) ;
 * - un envoi **non confirmé** n'est **jamais** présenté comme « envoyé » : l'état
 *   exposé est `unknown` (D007.2).
 *
 * Les types sont **dérivés des schémas** (`typeof X.Type`) : impossible de
 * diverger entre le décodage et le type affiché. Aucune assertion de type.
 */
import { Option, Schema } from "effect";
import { erreurLisible } from "./erreurs-demon.ts";
import { delaiDeReprise, SOURCE_OUVERTE } from "./reprise.ts";
// Import **local** : `export type { X } from "…"` ne crée aucune liaison ici.
import type { InstalledKind, RecentImage } from "@herdr-remote/shared";
import {
  AgentFocusedResponse,
  ApiErrorResponse,
  HealthResponse,
  InstalledKindsResponse,
  LaunchAgentResponse,
  ConversationsResponse,
  ModelCatalogResponse,
  RecentImagesResponse,
  OverviewResponse,
  PromptSentResponse,
  PromptFailedResponse,
  PromptSuppressedResponse,
  QuestionAnsweredResponse,
  SessionResponse as SessionResponseSchema,
  TrustRequiredResponse,
  TrustResolvedResponse,
  StopAgentResponse,
} from "@herdr-remote/shared";

/**
 * Le contrat vient de `@herdr-remote/shared` : **une seule définition**,
 * partagée avec le serveur. C'est ce qui empêche la divergence qui a produit le
 * bug « Forme de réponse inattendue : health ».
 */
/**
 * Les types d'agents viennent de `/api/agents/kinds` : ils sont mesurés sur
 * la machine, pas écrits dans le contrat. Voir `fetchAgentKinds`.
 */

export type {
  AgentModel,
  AgentView,
  HealthResponse as Health,
  InstalledKind,
  LaunchAgentResponse,
  ModelCatalogResponse as ModelCatalog,
  OverviewResponse as Overview,
  RecentImage,
  PromptSentResponse,
  PromptFailedResponse,
  PromptSuppressedResponse,
  QuestionAnsweredResponse,
  SessionEntry,
  SessionResponse,
  TrustRequiredResponse as TrustRequired,
  TrustResolvedResponse as TrustResolved,
  StopAgentResponse,
  WorkspaceView,
} from "@herdr-remote/shared";

/**
 * Répond à une invite de confiance.
 *
 * `accepted: false` n'est pas une erreur réseau : le serveur a refused d'envoyer
 * quoi que ce soit, et `detail` dit pourquoi. Les deux cas sont distingués pour
 * que l'interface n'affiche jamais « répondu » quand rien ne l'a été.
 */
/**
 * Réponse à une décision de confiance.
 *
 * ⚠️ `state` est **conservé**, et c'était le défaut : il était décodé depuis la
 * réponse puis jeté, si bien que le client ne pouvait pas distinguer « décision
 * transmise » de « confiance accordée ». L'écran disparaissait dans les deux cas,
 * et l'utilisateur croyait avoir donné une permission permanente.
 *
 * `inconnu` n'est pas un état de Herdr : c'est le nôtre, pour un transport qui
 * n'a rien dit. Un état qu'on ne connaît pas ne vaut jamais un accord.
 */
export type TrustAnswer =
  | {
      readonly accepted: true;
      readonly detail: string;
      readonly state: TrustState;
    }
  | {
      readonly accepted: false;
      readonly detail: string;
      readonly state: TrustState;
    };

/** États de décision de confiance, plus le nôtre pour un transport muet. */
export type TrustState = "transmise" | "acceptee" | "refusee" | "non-applicable" | "inconnu";

export const answerTrust = async (paneId: string, accept: boolean): Promise<TrustAnswer> => {
  const response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/trust`, {
    body: JSON.stringify({ accept }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const failure = decodeError(payload);
    return {
      accepted: false,
      detail:
        failure === undefined ? `échec (${String(response.status)})` : erreurLisible(failure.error),
      state: "inconnu",
    };
  }
  const decoded = decoderOf(TrustResolvedResponse)(payload);
  if (decoded === undefined) {
    // Réponse illisible : on ne la lit pas comme un refus, ni comme un accord.
    return { accepted: false, detail: "réponse illisible", state: "inconnu" };
  }
  return {
    accepted: decoded.accepted,
    detail: decoded.accepted ? "ok" : "refused",
    state: decoded.state,
  };
};

/**
 * Invite de confiance rencontrée au lancement.
 *
 * Levée quand le serveur répond `409` avec `trust-required`. On la distingue
 * d'une vraie erreur : l'agent n'a pas échoué, il attend une décision.
 */
export class TrustRequiredError extends Error {
  readonly request: TrustRequiredResponse;

  constructor(value: TrustRequiredResponse) {
    super(value.message);
    this.name = "TrustRequiredError";
    this.request = value;
  }
}

const HealthSchema = HealthResponse;
const OverviewSchema = OverviewResponse;

/**
 * Lance un agent dans un projet.
 *
 * Deux étapes côté serveur (onglet puis agent), une seule action côté client.
 * Un projet qui a déjà un agent est **refused** : lancer un second agent est un
 * choix explicite, pas un effet de bord.
 */
export const launchAgent = async (
  workspaceId: string,
  kind: string,
  options: { readonly model?: string; readonly thinking?: string } = {},
): Promise<LaunchAgentResponse> => {
  const body: Record<string, string> = { kind };
  // ⚠️ On n'envoie que ce qui a été **choisi** : un champ absent laisse l'agent
  // sur ses propres valeurs, alors qu'une chaîne vide lui ferait choisir « rien ».
  if (options.model !== undefined && options.model.length > 0) body["model"] = options.model;
  if (options.thinking !== undefined && options.thinking.length > 0) {
    body["thinking"] = options.thinking;
  }

  /*
    ⚠️ Le 409 `trust-required` **n'est pas** une erreur d'API : c'est une
    question posée à l'utilisateur. On la remonte comme telle, sinon elle
    s'afficherait comme un échec rouge et l'agent resterait bloqué sans issue.
    On lit donc le corps **avant** de décider de l'échec.
  */
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/agents`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = await readJson(response);

  if (response.status === 409) {
    const trust = decoderOf(TrustRequiredResponse)(payload);
    if (trust !== undefined) throw new TrustRequiredError(trust);
  }
  if (!response.ok) {
    throw new Error(erreurDe(payload, response.status));
  }

  const decoded = decoderOf(LaunchAgentResponse)(payload);
  if (decoded === undefined) {
    throw new Error("forme de réponse inattendue : lancement");
  }
  return decoded;
};

/**
 * Catalogue de modèles d'un type d'agent.
 *
 * Renvoie **la mesure**, source comprise. Un kind non mesuré arrive avec
 * `models: []` et une raison : l'interface affiche l'absence.
 */
export const fetchModelCatalog = (kind: string): Promise<ModelCatalogResponse> =>
  decoded(
    `/api/agents/${encodeURIComponent(kind)}/models`,
    decoderOf(ModelCatalogResponse),
    "model catalog",
  );

/**
 * Résultat d'un envoi (B05).
 *
 * `state` distingue les trois échecs, parce qu'ils ne se corrigent pas de la
 * même façon : en `attente` le message est **peut-être parti** et il faut
 * pouvoir le renvoyer ; en `erreur` il est perdu et il faut le retaper.
 */
export type SendResult =
  | { kind: "sent"; confirmation: "confirmed" | "unknown"; fingerprint: string }
  | { kind: "suppressed"; reason: string }
  | {
      kind: "failed";
      message: string;
      /** `hors-ligne` est le nôtre : l'appareil n'avait pas de réseau. */
      state: "attente" | "erreur" | "inconnu" | "hors-ligne";
    };

const ErrorPayload = ApiErrorResponse;
const SuppressedPayload = PromptSuppressedResponse;
const SentPayload = PromptSentResponse;
const FailedPayload = PromptFailedResponse;

/**
 * Construit un décodeur non-générique pour un schéma concret.
 *
 * On évite volontairement un helper `<A>(schema: Schema.Schema<A>)` : la
 * signature réelle de `decodeUnknownOption` exige un `ConstraintDecoder`, et
 * un `Schema<A>` générique ne s'y conforme pas.
 */
const decoderOf =
  <S extends Parameters<typeof Schema.decodeUnknownOption>[0]>(schema: S) =>
  (payload: unknown): S["Type"] | undefined =>
    Option.getOrUndefined(Schema.decodeUnknownOption(schema)(payload));

const decodeError = decoderOf(ErrorPayload);

/** L'appareil se dit hors ligne (`navigator.onLine`, absent hors navigateur). */
export const horsLigne = (): boolean =>
  typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine;

/** La cause d'une réponse d'erreur, traduite quand on la reconnaît (`erreurs-demon.ts`). */
const erreurDe = (payload: unknown, statut: number): string => {
  const failure = decodeError(payload);
  return failure === undefined ? `échec (${String(statut)})` : erreurLisible(failure.error);
};

/** Lit le corps une seule fois et le renvoie analysé, ou lève une erreur lisible. */
const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`réponse illisible (${response.status})`);
  }
};

/**
 * Le délai d'une lecture.
 *
 * ⚠️ Sans délai, une lecture bloquée (démon figé, réseau qui ne répond plus
 * sans couper) laissait la liste « en chargement » pour toujours, et le vol
 * unique bloquait toutes les relectures derrière elle.
 */
export const DELAI_LECTURE_MS = 10_000;

const request = async (path: string, init?: RequestInit): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(DELAI_LECTURE_MS),
      ...init,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "TimeoutError") {
      throw new Error(`Le démon n'a pas répondu en ${String(DELAI_LECTURE_MS / 1000)} s`, {
        cause,
      });
    }
    if (horsLigne()) throw new Error("Hors ligne : l'appareil n'a pas de réseau", { cause });
    throw new Error(erreurLisible(cause instanceof Error ? cause.message : String(cause)), {
      cause,
    });
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const failure = decodeError(payload);
    throw new Error(
      failure === undefined ? `échec (${String(response.status)})` : erreurLisible(failure.error),
    );
  }
  return payload;
};

/** Décode une réponse d'un endpoint dont la forme est connue. */
const decoded = async <A>(
  path: string,
  decodePayload: (payload: unknown) => A | undefined,
  label: string,
): Promise<A> => {
  const payload = await request(path);
  const value = decodePayload(payload);
  if (value === undefined) {
    throw new Error(`forme de réponse inattendue : ${label}`);
  }
  return value;
};

export const fetchHealth = () => decoded("/api/health", decoderOf(HealthSchema), "health");

/**
 * Lignes de la liste des conversations (U17).
 *
 * ⚠️ **Une seule requête pour tout ce qu'affiche une ligne** : la demande de
 * l'utilisateur, le modèle, la branche, l'horodatage. Les prendre sur
 * `/api/overview` aurait laissé chaque ligne chercher sa session, donc N
 * lectures de fichiers par rafraîchissement.
 */
export const fetchConversations = () =>
  decoded("/api/conversations", decoderOf(ConversationsResponse), "conversations");
export const fetchOverview = () => decoded("/api/overview", decoderOf(OverviewSchema), "overview");

/**
 * Charge une session.
 *
 * - **premier affichage** : `tail` lit la fin du fichier. Sans cela, une session
 *   de 1,8 Mo bloque la première peinture.
 * - **rafraîchissement** : `cursor` ne renvoie que le nouveau. Sans cela, le chat
 *   re-téléchargeait 1,8 Mo toutes les 2,5 s et ne s'affichait jamais.
 *
 * ⚠️ Le curseur est **opaque** (B01) : le client le ressort tel quel, sans le
 * lire ni le construire. Un offset nu ne dit pas quel fichier il désigne.
 */
export const fetchSession = (
  paneId: string,
  options: {
    readonly before?: string;
    readonly cursor?: string;
    readonly tail?: number;
  } = {},
) => {
  const query = new URLSearchParams();
  if (options.before !== undefined) query.set("before", options.before);
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  if (options.tail !== undefined) query.set("tail", String(options.tail));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return decoded(
    `/api/agents/${encodeURIComponent(paneId)}/session${suffix}`,
    decoderOf(SessionResponseSchema),
    "session",
  );
};

/** Types d'agents installés sur la machine, d'après Herdr. */
export const fetchAgentKinds = async (): Promise<ReadonlyArray<InstalledKind>> => {
  const payload = await request("/api/agents/kinds");
  const kinds = decoderOf(InstalledKindsResponse)(payload);
  if (kinds === undefined) throw new Error("forme de réponse inattendue : types d'agents");
  return kinds.kinds;
};

/** Images récentes des dossiers autorisés — captures comprises. */
export const fetchRecentImages = async (): Promise<ReadonlyArray<RecentImage>> => {
  const payload = await request("/api/images");
  const images = decoderOf(RecentImagesResponse)(payload);
  if (images === undefined) throw new Error("forme de réponse inattendue : images");
  return images.images;
};

/**
 * Signale une erreur au serveur, pour qu'elle soit **journalisée**.
 *
 * Une barre rouge disparaît au rechargement : sans ce canal, une erreur vue
 * dans le navigateur n'existait plus au moment de la diagnostiquer.
 */
export const reportError = (message: string, detail?: unknown): void => {
  void (async () => {
    try {
      await fetch("/api/log", {
        body: JSON.stringify(
          detail === undefined ? { level: "error", message } : { detail, level: "error", message },
        ),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } catch {
      // Signaler une erreur ne doit jamais en produire une : on abandonne.
    }
  })();
};

/**
 * Le délai d'un envoi.
 *
 * ⚠️ 15 s : très au-delà d'un aller-retour normal (mesuré ~1 ms côté serveur),
 * donc un dépassement signale un vrai blocage — et non une lenteur passagère.
 */
const DELAI_ENVOI_MS = 15_000;

export const sendPrompt = async (paneId: string, text: string): Promise<SendResult> => {
  /*
    ⚠️ **Un envoi DOIT finir, même si le serveur ne répond pas.** Sans délai, une
    requête bloquée laissait l'envoi en `sending` pour toujours : le composeur se
    verrouillait (« impossible d'envoyer »), et aucune action n'était possible.
    Un envoi expiré n'est pas un échec : le message est **peut-être parti**
    (`attente`) — le présenter comme perdu ferait renvoyer un doublon.
  */
  let response: Response;
  try {
    response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/prompt`, {
      body: JSON.stringify({ text }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(DELAI_ENVOI_MS),
    });
  } catch (cause) {
    const expire = cause instanceof DOMException && cause.name === "TimeoutError";
    /*
      ⚠️ **Hors ligne, rien n'est parti.** WebKit rejette `fetch` avec « Load
      failed » quand l'appareil n'a pas de réseau : la bulle disait « Herdr n'a
      pas confirmé à temps — peut-être parti », ce qui est faux. Sans réseau,
      la requête n'a pas quitté le téléphone.
    */
    if (!expire && horsLigne()) {
      return { kind: "failed", message: "", state: "hors-ligne" };
    }
    return {
      kind: "failed",
      message: expire
        ? "Herdr n'a pas répondu dans les 15 s."
        : `Connexion au démon interrompue (${cause instanceof Error ? cause.message : String(cause)}).`,
      state: "attente",
    };
  }

  let payload: unknown;
  try {
    payload = await readJson(response);
  } catch {
    return {
      kind: "failed",
      message: `réponse illisible (${response.status})`,
      state: "inconnu",
    };
  }

  // Un double envoi supprimé n'est pas un échec (D007.2).
  const suppressed = decoderOf(SuppressedPayload)(payload);
  if (suppressed !== undefined) {
    return { kind: "suppressed", reason: suppressed.reason };
  }

  if (response.ok) {
    const sent = decoderOf(SentPayload)(payload);
    if (sent !== undefined) {
      // `confirmation` vient du serveur : on ne décide pas ici si c'est confirmé.
      return {
        confirmation: sent.confirmation === "confirmed" ? "confirmed" : "unknown",
        fingerprint: sent.fingerprint,
        kind: "sent",
      };
    }
  }

  // Un échec nommé par le serveur prime sur le message générique : `state`
  // pilote l'action proposée à l'utilisateur.
  const named = decoderOf(FailedPayload)(payload);
  if (named !== undefined) {
    return { kind: "failed", message: erreurLisible(named.detail), state: named.state };
  }
  return {
    kind: "failed",
    message: erreurDe(payload, response.status),
    state: "inconnu",
  };
};

/** Envoie une demande d'interruption à un agent que Herdr voit en cours. */
export const stopAgent = async (paneId: string): Promise<StopAgentResponse> => {
  /*
    ⚠️ **Un POST, comme toute action.** L'arrêt passait par `decoded()`, qui
    fait un GET : les deux démons répondent 405 « method not allowed on this
    route » et Stop n'a jamais pu fonctionner. La route exige aussi un
    Content-Type JSON (corps ignoré, comme `/focus`).
  */
  const response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/stop`, {
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(erreurDe(payload, response.status));
  }
  const lu = decoderOf(StopAgentResponse)(payload);
  if (lu === undefined) throw new Error("forme de réponse inattendue : arrêt");
  return lu;
};

/** Ce qu'une sonde du flux de session a appris (`flux-session.ts`). */
export interface VerdictSondeFlux {
  readonly nature: "route-absente" | "pane" | "passager";
  readonly detail: string | null;
}

/**
 * Qualifie un flux de session qui n'a pas pu s'ouvrir, par une requête HTTP
 * sur la même URL — `EventSource` ne dit jamais pourquoi il échoue.
 *
 * ⚠️ **Le corps tranche, pas le statut seul.** Un `404` JSON portant une erreur
 * de domaine (pane inconnu, `no_source`) est un problème de **ce** pane ; un
 * `404 route inconnue`, un `405`, une réponse non JSON ou la page HTML que le
 * démon TS sert en `200` pour toute adresse inconnue disent que la **route**
 * manque. Un flux qui répond (`text/event-stream`) ou un `503` (plafond de
 * flux) est passager. Le corps d'un flux n'est jamais lu : la requête est
 * abandonnée dès les en-têtes.
 */
export const sondeFluxSession = async (url: string): Promise<VerdictSondeFlux> => {
  const arret = new AbortController();
  const minuterie = setTimeout(() => arret.abort(), 5_000);
  try {
    const reponse = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal: arret.signal,
    });
    const type = reponse.headers.get("content-type") ?? "";
    if (reponse.ok) {
      return type.includes("text/event-stream")
        ? { detail: null, nature: "passager" }
        : {
            detail: `réponse ${type.length > 0 ? type : "sans type"} au lieu d'un flux`,
            nature: "route-absente",
          };
    }
    let corps: unknown;
    try {
      corps = JSON.parse(await reponse.text());
    } catch {
      corps = undefined;
    }
    const erreur = decodeError(corps);
    if (reponse.status === 404 || reponse.status === 405) {
      if (reponse.status === 405 || erreur === undefined || erreur.error === "route inconnue") {
        return { detail: erreur?.error ?? null, nature: "route-absente" };
      }
      return { detail: erreur.error, nature: "pane" };
    }
    if (reponse.status >= 500) return { detail: erreur?.error ?? null, nature: "passager" };
    return { detail: erreur?.error ?? `HTTP ${String(reponse.status)}`, nature: "pane" };
  } catch {
    return { detail: null, nature: "passager" };
  } finally {
    clearTimeout(minuterie);
    // Un flux qui a répondu ne doit pas rester ouvert : la sonde n'en lit rien.
    arret.abort();
  }
};

/** Ce que le flux global attend d'un `EventSource` — rien de plus. */
export interface SourceGlobale {
  readonly readyState?: number;
  addEventListener(type: string, ecouteur: (evenement: MessageEvent<string>) => void): void;
  close(): void;
}

/** Ce qui est injecté dans le flux global — par défaut, la plateforme. */
export interface DependancesFluxGlobal {
  readonly ouvre?: (url: string) => SourceGlobale;
  readonly planifie?: (action: () => void, delai: number) => () => void;
  /** S'abonne au retour du réseau et au retour au premier plan ; rend le désabonnement. */
  readonly ecouteReveil?: (reveil: () => void) => () => void;
  readonly visible?: () => boolean;
}

const planifieParDefaut = (action: () => void, delai: number): (() => void) => {
  const minuterie = setTimeout(action, delai);
  return () => clearTimeout(minuterie);
};

const ecouteReveilParDefaut = (reveil: () => void): (() => void) => {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  window.addEventListener("online", reveil);
  document.addEventListener("visibilitychange", reveil);
  return () => {
    window.removeEventListener("online", reveil);
    document.removeEventListener("visibilitychange", reveil);
  };
};

/**
 * Ouvre le flux d'événements.
 *
 * `EventSource` rejoue `Last-Event-ID` automatiquement à la reconnexion : c'est
 * le rattrapage, et c'est pourquoi le flux est en SSE et non en WebSocket
 * (D009). Un événement `resync` signifie que la continuité est rompue : il faut
 * recharger l'état complet plutôt que de croire à un flux continu.
 *
 * ⚠️ **Un flux tombé est recréé par nous** (`reprise.ts`) : 1 s, 2 s, 5 s, puis
 * 10 s, et tout de suite au retour du réseau ou au premier plan s'il n'est pas
 * ouvert. Un flux recréé n'a pas l'identifiant du dernier événement : à sa
 * première manifestation, la liste est relue (`onResync`).
 */
export const openEventStream = (
  handlers: {
    onEvent: (kind: string, data: unknown) => void;
    onResync: () => void;
    onStatus: (status: "live" | "down") => void;
  },
  deps: DependancesFluxGlobal = {},
): (() => void) => {
  const ouvre = deps.ouvre ?? ((url: string): SourceGlobale => new EventSource(url));
  const planifie = deps.planifie ?? planifieParDefaut;
  const visible =
    deps.visible ??
    (() => typeof document === "undefined" || document.visibilityState === "visible");

  /**
   * Anti-clignotement du statut.
   *
   * `EventSource` déclenche `error` à **chaque** tentative de reconnexion, y
   * compris quand tout va bien : le réseau change, l'onglet sort de veille, le
   * serveur répond un peu lentement. Marquer « hors ligne » immédiatement
   * faisait clignoter l'indicateur en permanence.
   *
   * On attend donc quelques secondes sans rétablissement avant de l'annoncer.
   */
  let annuleBaisse: (() => void) | null = null;
  let annuleReprise: (() => void) | null = null;
  let courant: SourceGlobale | undefined;
  let ferme = false;
  let essais = 0;
  let aDejaVecu = false;
  let resynchroniser = false;

  const markLive = () => {
    annuleBaisse?.();
    annuleBaisse = null;
    handlers.onStatus("live");
  };

  const markDownSoon = () => {
    if (annuleBaisse !== null) return;
    annuleBaisse = planifie(() => {
      annuleBaisse = null;
      handlers.onStatus("down");
    }, 6_000);
  };

  /**
   * Un signe de vie — `open`, ou n'importe quel événement (un mandataire peut
   * retenir `open` jusqu'au premier octet). Il annule la recréation prévue, et
   * un flux RECRÉÉ se resynchronise une fois.
   */
  const signeDeVie = () => {
    annuleReprise?.();
    annuleReprise = null;
    essais = 0;
    aDejaVecu = true;
    markLive();
    if (resynchroniser) {
      resynchroniser = false;
      handlers.onResync();
    }
  };

  const recree = () => {
    if (ferme) return;
    annuleReprise?.();
    annuleReprise = null;
    courant?.close();
    // L'ancien objet emporte son `Last-Event-ID` : le nouveau devra relire.
    if (aDejaVecu) resynchroniser = true;
    connect();
  };

  const planifierReprise = () => {
    if (ferme || annuleReprise !== null) return;
    const delai = delaiDeReprise(essais);
    essais += 1;
    annuleReprise = planifie(() => {
      annuleReprise = null;
      recree();
    }, delai);
  };

  /**
   * Un événement **nommé** prouve lui aussi que le flux vit.
   *
   * `message` ne se déclenche que pour les événements sans nom — or le trafic
   * utile ici est nommé (`agent_status`, `prompt`…).
   */
  const forward = (source: SourceGlobale, kind: string) => (event: MessageEvent<string>) => {
    if (ferme || courant !== source) return;
    signeDeVie();
    let data: unknown = event.data;
    try {
      data = JSON.parse(event.data);
    } catch {
      // On transmet la chaîne brute plutôt que de perdre l'événement.
    }
    handlers.onEvent(kind, data);
  };

  const EVENEMENTS_SUIVIS = [
    "agent_status",
    "prompt",
    "prompt-suppressed",
    "agent-launched",
    "session_changed",
  ];

  function connect(): void {
    if (ferme) return;
    const source = ouvre("/api/events");
    courant = source;
    const actuelle = () => !ferme && courant === source;
    source.addEventListener("open", () => {
      if (actuelle()) signeDeVie();
    });
    source.addEventListener("error", () => {
      if (!actuelle()) return;
      markDownSoon();
      planifierReprise();
    });
    source.addEventListener("ready", () => {
      if (actuelle()) signeDeVie();
    });
    source.addEventListener("resync", () => {
      if (actuelle()) handlers.onResync();
    });
    source.addEventListener("message", () => {
      if (actuelle()) signeDeVie();
    });
    for (const kind of EVENEMENTS_SUIVIS) source.addEventListener(kind, forward(source, kind));
  }

  // Retour du réseau ou au premier plan : un flux qui n'est pas ouvert est
  // recréé tout de suite, sans attendre la prochaine reprise.
  const arreteReveil = (deps.ecouteReveil ?? ecouteReveilParDefaut)(() => {
    if (ferme || !visible()) return;
    if (courant?.readyState !== SOURCE_OUVERTE) recree();
  });

  connect();

  return () => {
    ferme = true;
    annuleBaisse?.();
    annuleReprise?.();
    arreteReveil();
    courant?.close();
  };
};

/**
 * URL de lecture d'un fichier du projet.
 *
 * Le serveur n'accepte que les chemins **sous les dossiers de travail des
 * projets** : un chemin hors de là est refused (403), pas servi.
 */
export const fileUrl = (path: string): string => `/api/file?path=${encodeURIComponent(path)}`;

/** `true` si le chemin désigne une image que le navigateur sait rendre. */
export const isImagePath = (path: string): boolean => /\.(png|jpe?g|gif|webp|avif)$/i.test(path);

/** `true` si le chemin désigne un texte que l'on peut afficher en ligne. */
export const isTextPath = (path: string): boolean =>
  /\.(md|txt|log|json|jsonl|diff|patch|ya?ml|toml|tsv|csv)$/i.test(path);

/** Dernier segment d'un chemin, sans identifiant interne. */
export const baseName = (path: string): string => {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
};

/** Ce que la réponse à une question a donné. Mêmes nuances que l'envoi (B06). */
export interface AnswerResult {
  readonly state: "appliquee" | "transmise" | "refusee";
  readonly detail: string;
}

/**
 * Répond à la question affichée sur un pane.
 *
 * ⚠️ Le serveur **valide le numéro contre les choix réellement à l'écran** : un
 * numéro qui n'est pas offert ne part jamais. L'interface n'a donc pas à
 * protéger cette décision — elle ne peut offrir que ce qui existe.
 */
export const answerQuestion = async (
  paneId: string,
  numero: number,
  texte?: string,
): Promise<AnswerResult> => {
  const response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/answer`, {
    // ⚠️ `texte` n'est pas un ornement : l'option de saisie libre d'opencode
    // ouvre un champ, et le choix **seul** le laisserait vide.
    body: JSON.stringify(
      texte === undefined || texte.length === 0 ? { numero } : { numero, texte },
    ),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  let payload: unknown;
  try {
    payload = await readJson(response);
  } catch {
    return {
      detail: `réponse illisible (${response.status})`,
      state: "refusee",
    };
  }

  if (response.status !== 200) {
    // Le refus porte toujours sa cause : le serveur n'en produit jamais de vide.
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `échec (${response.status})`;
    return {
      detail: message.length > 0 ? message : `échec (${response.status})`,
      state: "refusee",
    };
  }

  const decode = Schema.decodeUnknownOption(QuestionAnsweredResponse);
  const valeur = Option.getOrUndefined(decode(payload));
  return valeur === undefined
    ? {
        detail: "réponse illisible : l'état n'a pas pu être lu",
        state: "refusee",
      }
    : { detail: valeur.detail, state: valeur.state };
};

/**
 * Montre le pane sur le Mac (`POST /focus`) — **geste explicite uniquement**.
 *
 * ⚠️ L'effet est réel sur le Mac : le pane prend le focus dans Herdr, et un
 * agent `done` passe `idle`. Ce n'était pas un geste mais un effet de bord de
 * la lecture (défilement d'une conversation terminée) : lire sur le téléphone
 * volait le clavier du Mac. Il n'est plus appelé que par le menu « Afficher sur
 * le Mac ».
 *
 * ⚠️ **Lève sur un échec**, avec la cause : un focus qui n'a pas eu lieu ne se
 * présente pas comme fait.
 */
export const focusAgent = async (paneId: string): Promise<AgentFocusedResponse> => {
  const response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/focus`, {
    body: JSON.stringify({}),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(erreurDe(payload, response.status));
  }
  const lu = decoderOf(AgentFocusedResponse)(payload);
  if (lu === undefined) throw new Error("forme de réponse inattendue : focus");
  if (!lu.focused) throw new Error("Herdr n'a pas appliqué le focus");
  return lu;
};
