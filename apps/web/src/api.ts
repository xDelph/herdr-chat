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
// Import **local** : `export type { X } from "…"` ne crée aucune liaison ici.
import type { InstalledKind, RecentImage } from "@herdr-remote/shared";
import {
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
 * `accepted: false` n'est pas une erreur réseau : le serveur a refusé d'envoyer
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
      detail: failure?.error ?? `échec ${String(response.status)}`,
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
    detail: decoded.accepted ? "ok" : "refusé",
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
 * Un projet qui a déjà un agent est **refusé** : lancer un second agent est un
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
    const failure = decodeError(payload);
    throw new Error(failure?.error ?? `échec ${String(response.status)}`);
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
    "catalogue de modèles",
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
      state: "attente" | "erreur" | "inconnu";
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

/** Lit le corps une seule fois et le renvoie analysé, ou lève une erreur lisible. */
const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`réponse illisible (${response.status})`);
  }
};

const request = async (path: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const failure = decodeError(payload);
    throw new Error(failure?.error ?? `échec ${response.status}`);
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

export const sendPrompt = async (paneId: string, text: string): Promise<SendResult> => {
  const response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/prompt`, {
    body: JSON.stringify({ text }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

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
    return { kind: "failed", message: named.detail, state: named.state };
  }
  const failure = decodeError(payload);
  return {
    kind: "failed",
    message: failure?.error ?? `échec ${response.status}`,
    state: "inconnu",
  };
};

/** Envoie une demande d'interruption à un agent que Herdr voit en cours. */
export const stopAgent = (paneId: string): Promise<StopAgentResponse> =>
  decoded(
    `/api/agents/${encodeURIComponent(paneId)}/stop`,
    decoderOf(StopAgentResponse),
    "arrêt d'agent",
  );

/**
 * Ouvre le flux d'événements.
 *
 * `EventSource` rejoue `Last-Event-ID` automatiquement à la reconnexion : c'est
 * le rattrapage, et c'est pourquoi le flux est en SSE et non en WebSocket
 * (D009). Un événement `resync` signifie que la continuité est rompue : il faut
 * recharger l'état complet plutôt que de croire à un flux continu.
 */
export const openEventStream = (handlers: {
  onEvent: (kind: string, data: unknown) => void;
  onResync: () => void;
  onStatus: (status: "live" | "down") => void;
}): (() => void) => {
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
  let downTimer: ReturnType<typeof setTimeout> | undefined;

  const markLive = () => {
    if (downTimer !== undefined) {
      clearTimeout(downTimer);
      downTimer = undefined;
    }
    handlers.onStatus("live");
  };

  const markDownSoon = () => {
    if (downTimer !== undefined) return;
    downTimer = setTimeout(() => {
      downTimer = undefined;
      handlers.onStatus("down");
    }, 6_000);
  };

  /**
   * Un événement **nommé** prouve lui aussi que le flux vit.
   *
   * `message` ne se déclenche que pour les événements sans nom — or le trafic
   * utile ici est nommé (`agent_status`, `prompt`…). Sans cette ligne, une
   * coupure de trois secondes suivie d'un `agent_status` bien reçu laissait
   * l'indicateur « hors ligne » alors que le flux fonctionnait.
   */
  const forward = (kind: string) => (event: MessageEvent<string>) => {
    markLive();
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
  /** `EventSource.CLOSED`, sans dépendre de la classe (absente d'un double de test). */
  const CLOSED = 2;

  let courant: EventSource | undefined;
  let ferme = false;
  let reprise: ReturnType<typeof setTimeout> | undefined;
  let essais = 0;

  /**
   * Recrée le flux, avec un délai qui double puis plafonne.
   *
   * ⚠️ **`EventSource` ne se reconnecte PAS toujours tout seul.** Il réessaie
   * tant que la coupure est un simple incident réseau, mais si le serveur a
   * répondu une **erreur HTTP** (statut non-2xx, ou type de contenu inattendu),
   * il passe en `CLOSED` et **abandonne définitivement**. Mesuré à l'usage : le
   * bandeau « hors ligne » restait affiché indéfiniment, et seul un redémarrage
   * de l'application rétablissait la connexion.
   *
   * On reprend donc la main : c'est la seule façon de garantir une reconnexion
   * qui n'attende pas de l'utilisateur qu'il ferme l'app.
   */
  const planifierReprise = () => {
    if (ferme || reprise !== undefined) return;
    const delai = Math.min(1_000 * 2 ** essais, 15_000);
    essais += 1;
    reprise = setTimeout(() => {
      reprise = undefined;
      courant?.close();
      connect();
    }, delai);
  };

  const connect = () => {
    if (ferme) return;
    const source = new EventSource("/api/events");
    courant = source;

    source.addEventListener("open", () => {
      // Le flux est reparti : le prochain incident repartira du délai court.
      essais = 0;
      markLive();
    });
    source.addEventListener("error", () => {
      markDownSoon();
      if (source.readyState === CLOSED) planifierReprise();
    });
    source.addEventListener("ready", markLive);
    source.addEventListener("resync", () => handlers.onResync());
    source.addEventListener("message", markLive);
    for (const kind of EVENEMENTS_SUIVIS) source.addEventListener(kind, forward(kind));
  };

  connect();

  return () => {
    ferme = true;
    if (downTimer !== undefined) clearTimeout(downTimer);
    if (reprise !== undefined) clearTimeout(reprise);
    courant?.close();
  };
};

/**
 * URL de lecture d'un fichier du projet.
 *
 * Le serveur n'accepte que les chemins **sous les dossiers de travail des
 * projets** : un chemin hors de là est refusé (403), pas servi.
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
 * Acquitte la réponse d'un agent en posant le focus sur son pane.
 *
 * ⚠️ **C'est le focus qui acquitte, et rien d'autre.** `agent.view.set` répond
 * `{active: true}` sans changer le statut — mesuré deux fois. Sans cet appel,
 * la liste garde « terminé » pour une réponse qu'on vient de lire.
 *
 * ⚠️ L'effet est réel sur le Mac : le pane prend le focus dans Herdr. C'est le
 * prix de l'acquittement, et il n'y a pas d'autre chemin.
 *
 * ⚠️ Ne lève **jamais** : l'acquittement est un confort d'affichage, il ne doit
 * pas empêcher d'ouvrir une conversation.
 */
export const focusAgent = async (paneId: string): Promise<void> => {
  try {
    await fetch(`/api/agents/${encodeURIComponent(paneId)}/focus`, {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch {
    // Volontairement muet : voir le commentaire ci-dessus.
  }
};
