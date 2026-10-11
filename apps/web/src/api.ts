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
  ModelCatalogResponse,
  RecentImagesResponse,
  OverviewResponse,
  PromptSentResponse,
  PromptSuppressedResponse,
  SessionResponse as SessionResponseSchema,
  TrustRequiredResponse,
  TrustResolvedResponse,
  TerminalResponse,
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
  PromptSuppressedResponse,
  SessionEntry,
  SessionResponse,
  TerminalResponse as Terminal,
  TrustRequiredResponse as TrustRequired,
  TrustResolvedResponse as TrustResolved,
  WorkspaceView,
} from "@herdr-remote/shared";

/**
 * Répond à une invite de confiance.
 *
 * `accepted: false` n'est pas une erreur réseau : le serveur a refusé d'envoyer
 * quoi que ce soit, et `detail` dit pourquoi. Les deux cas sont distingués pour
 * que l'interface n'affiche jamais « répondu » quand rien ne l'a été.
 */
export type TrustAnswer =
  | { readonly accepted: true; readonly detail: string }
  | { readonly accepted: false; readonly detail: string };

export const answerTrust = async (paneId: string, accept: boolean): Promise<TrustAnswer> => {
  const response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/trust`, {
    body: JSON.stringify({ accept }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const failure = decodeError(payload);
    return { accepted: false, detail: failure?.error ?? `échec ${String(response.status)}` };
  }
  const decoded = decoderOf(TrustResolvedResponse)(payload);
  if (decoded === undefined) {
    return { accepted: false, detail: "réponse illisible" };
  }
  return { accepted: decoded.accepted, detail: decoded.accepted ? "ok" : "refusé" };
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
const TerminalSchema = TerminalResponse;

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

export type SendResult =
  | { kind: "sent"; confirmation: "confirmed" | "unknown"; fingerprint: string }
  | { kind: "suppressed"; reason: string }
  | { kind: "failed"; message: string };

const ErrorPayload = ApiErrorResponse;
const SuppressedPayload = PromptSuppressedResponse;
const SentPayload = PromptSentResponse;

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
export const fetchOverview = () => decoded("/api/overview", decoderOf(OverviewSchema), "overview");

/**
 * Charge une session.
 *
 * - **premier affichage** : `tail` lit la fin du fichier. Sans cela, une session
 *   de 1,8 Mo bloque la première peinture.
 * - **rafraîchissement** : `since` ne renvoie que le nouveau. Sans cela, le chat
 *   re-téléchargeait 1,8 Mo toutes les 2,5 s et ne s'affichait jamais.
 */
export const fetchSession = (
  paneId: string,
  options: { readonly since?: number; readonly tail?: number } = {},
) => {
  const query = new URLSearchParams();
  if (options.since !== undefined) query.set("since", String(options.since));
  if (options.tail !== undefined) query.set("tail", String(options.tail));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return decoded(
    `/api/agents/${encodeURIComponent(paneId)}/session${suffix}`,
    decoderOf(SessionResponseSchema),
    "session",
  );
};

export const fetchTerminal = (paneId: string) =>
  decoded(
    `/api/agents/${encodeURIComponent(paneId)}/terminal`,
    decoderOf(TerminalSchema),
    "terminal",
  );

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
    return { kind: "failed", message: `réponse illisible (${response.status})` };
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

  const failure = decodeError(payload);
  return { kind: "failed", message: failure?.error ?? `échec ${response.status}` };
};

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
  const source = new EventSource("/api/events");

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

  source.addEventListener("open", markLive);
  source.addEventListener("error", markDownSoon);
  source.addEventListener("ready", markLive);
  source.addEventListener("resync", () => handlers.onResync());

  // Un événement reçu prouve que le flux vit, même après un `error`.
  source.addEventListener("message", markLive);

  const forward = (kind: string) => (event: MessageEvent<string>) => {
    let data: unknown = event.data;
    try {
      data = JSON.parse(event.data);
    } catch {
      // On transmet la chaîne brute plutôt que de perdre l'événement.
    }
    handlers.onEvent(kind, data);
  };

  for (const kind of ["agent_status", "prompt", "prompt-suppressed", "resync", "ready"]) {
    if (kind === "resync" || kind === "ready") continue;
    source.addEventListener(kind, forward(kind));
  }

  return () => {
    if (downTimer !== undefined) clearTimeout(downTimer);
    source.close();
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
