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

const AgentViewSchema = Schema.Struct({
  agent: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  focused: Schema.Boolean,
  paneId: Schema.String,
  parentSession: Schema.NullOr(Schema.String),
  sessionCwd: Schema.NullOr(Schema.String),
  /** `null` = non vérifiable, volontairement distinct de `false`. */
  sessionCwdMatches: Schema.NullOr(Schema.Boolean),
  sessionId: Schema.NullOr(Schema.String),
  sessionKind: Schema.NullOr(Schema.Literals(["id", "path"])),
  sessionPath: Schema.NullOr(Schema.String),
  status: Schema.String,
  tabId: Schema.String,
  title: Schema.NullOr(Schema.String),
  workspaceId: Schema.String,
});
export type AgentView = typeof AgentViewSchema.Type;

const WorkspaceViewSchema = Schema.Struct({
  agentStatus: Schema.NullOr(Schema.String),
  focused: Schema.Boolean,
  label: Schema.NullOr(Schema.String),
  paneCount: Schema.Number,
  tabCount: Schema.Number,
  workspaceId: Schema.String,
});
export type WorkspaceView = typeof WorkspaceViewSchema.Type;

const HealthSchema = Schema.Struct({
  herdr: Schema.Struct({
    protocol: Schema.optional(Schema.Number),
    reachable: Schema.Boolean,
    socket: Schema.String,
    version: Schema.optional(Schema.String),
  }),
  ok: Schema.Boolean,
  uptimeMs: Schema.Number,
});
export type Health = typeof HealthSchema.Type;

const OverviewSchema = Schema.Struct({
  agents: Schema.Array(AgentViewSchema),
  herdrProtocol: Schema.Number,
  herdrVersion: Schema.String,
  withoutSession: Schema.Number,
  workspaces: Schema.Array(WorkspaceViewSchema),
});
export type Overview = typeof OverviewSchema.Type;

const SessionEntrySchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  raw: Schema.String,
  timestamp: Schema.optional(Schema.String),
  type: Schema.String,
});
export type SessionEntry = typeof SessionEntrySchema.Type;

const SessionResponseSchema = Schema.Struct({
  entries: Schema.Array(SessionEntrySchema),
  offset: Schema.Number,
  sessionPath: Schema.String,
});
export type SessionResponse = typeof SessionResponseSchema.Type;

const TerminalSchema = Schema.Struct({ text: Schema.String, truncated: Schema.Boolean });
export type Terminal = typeof TerminalSchema.Type;

const ErrorPayload = Schema.Struct({ error: Schema.String });
const SuppressedPayload = Schema.Struct({ reason: Schema.String, status: Schema.String });
const SentPayload = Schema.Struct({
  confirmation: Schema.String,
  fingerprint: Schema.String,
  status: Schema.String,
});

export type SendResult =
  | { kind: "sent"; confirmation: "confirmed" | "unknown"; fingerprint: string }
  | { kind: "suppressed"; reason: string }
  | { kind: "failed"; message: string };

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

export const fetchSession = (paneId: string) =>
  decoded(
    `/api/agents/${encodeURIComponent(paneId)}/session`,
    decoderOf(SessionResponseSchema),
    "session",
  );

export const fetchTerminal = (paneId: string) =>
  decoded(
    `/api/agents/${encodeURIComponent(paneId)}/terminal`,
    decoderOf(TerminalSchema),
    "terminal",
  );

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

  source.addEventListener("open", () => handlers.onStatus("live"));
  source.addEventListener("error", () => handlers.onStatus("down"));
  source.addEventListener("ready", () => handlers.onStatus("live"));
  source.addEventListener("resync", () => handlers.onResync());

  const forward = (kind: string) => (event: MessageEvent<string>) => {
    let data: unknown = event.data;
    try {
      data = JSON.parse(event.data);
    } catch {
      // On transmet la chaîne brute plutôt que de perdre l'événement.
    }
    handlers.onEvent(kind, data);
  };

  for (const kind of ["prompt", "prompt-suppressed", "agent_status"]) {
    source.addEventListener(kind, forward(kind));
  }

  return () => source.close();
};
