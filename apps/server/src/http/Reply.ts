/**
 * Socle HTTP — réponse, décodage, journalisation.
 *
 * **Pourquoi ce fichier existe (A01).** Tout était dans `Api.ts`, qui dépassait
 * 1100 lignes : y retrouver la définition d'une réponse demandait de fouiller.
 * Ces briques sont le vocabulaire commun de **tous** les handlers, donc elles
 * n'ont rien à faire dans un module de routes.
 *
 * ⚠️ **Déplacement seul, aucun changement de comportement.** Les règles qui
 * valent ici ne sont pas des préférences :
 *
 * - `json` journalise **toute** réponse >= 400. Une erreur affichée sans trace
 *   est indiagnosticable après coup, et l'utilisateur devient le seul témoin.
 * - `respond` valide la réponse contre le contrat partagé **avant** de l'émettre.
 *   C'est la garantie structurelle qui a attrapé le bug D011 (`reachable`
 *   absent de la branche succès de `/api/health`).
 * - `stripIdentifiers` retire les identifiants Herdr des messages destinés à
 *   l'écran : l'utilisateur voit « le nouvel onglet », pas `wB:p4`.
 */
import { Effect, Option, Result, Schema } from "effect";
import { byteLengthUtf8, SnapshotPayload } from "@herdr-remote/shared";

export { byteLengthUtf8 };
import { writeLog } from "../logging/LogFile.ts";

/**
 * Requête minimale dont un handler a besoin.
 *
 * Volontairement plus étroite que `Bun.BunRequest` : cela évite toute assertion
 * de type dans les tests, qui peuvent construire un objet littéral conforme.
 */
export interface RouteRequest {
  readonly params: Record<string, string | undefined>;
  /** Méthode HTTP. Le 405 l'exige : sans elle, un client ne peut pas se corriger. */
  readonly method?: string;
  readonly headers: { get(name: string): string | null };
  readonly url: string;
  json(): Promise<unknown>;
}

export interface Routes {
  readonly [path: string]: (request: RouteRequest) => Response | Promise<Response>;
}

/** Rend lisible n'importe quelle erreur typée d'Effect. */
export const describe = (error: unknown): string => {
  const value = describeCause(error);
  return value.trim().length > 0 ? value : "erreur sans message";
};

export const describeCause = (cause: unknown): string => {
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      Schema.Struct({
        detail: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
      }),
    )(cause),
  );
  const readable = decoded?.detail ?? decoded?.message;
  if (readable !== undefined && readable.trim().length > 0) return stripIdentifiers(readable);

  // Dernier recours : une sérialisation, ou le type, mais jamais rien.
  try {
    const serialized = JSON.stringify(cause);
    if (serialized !== undefined && serialized !== "{}" && serialized.length > 2) {
      return serialized.slice(0, 300);
    }
  } catch {
    // Sérialisation impossible (référence circulaire) : on continue.
  }
  return `failure without a message (${cause === null ? "null" : typeof cause})`;
};

/**
 * Retire les identifiants internes d'un message destiné à l'écran.
 *
 * ⚠️ Herdr parle en `wB:p4` ; l'utilisateur, lui, voit « le nouvel onglet ». Un
 * identifiant dans une phrase d'erreur ne l'aide pas, et l'a mis en colère à
 * juste titre.
 */
export const stripIdentifiers = (message: string): string =>
  message
    .replace(/\bw[0-9A-Za-z]*:p[0-9A-Za-z]+\b/g, "le nouvel onglet")
    .replace(/\bw[0-9A-Za-z]*:t[0-9A-Za-z]+\b/g, "son onglet")
    .replace(/\b(?:pane|tab|workspace)_id=\S+/g, "");

export const failureOf = (result: Result.Result<unknown, unknown>): unknown =>
  Result.isFailure(result) ? Option.getOrUndefined(Result.getFailure(result)) : undefined;

/**
 * Réponse JSON, **et journalisation automatique des erreurs**.
 *
 * `logPath` vient de la configuration : c'est lui qui empêche les tests
 * d'écrire dans le journal de l'utilisateur (A03).
 */
export const json = (logPath: string, body: unknown, status = 200): Response => {
  if (status >= 400) {
    const described = describeCause(body);
    // Trace console **en plus** du fichier : `verify` capture stderr, le
    // journal seul ne se voit pas dans un test.
    console.error(`[http ${String(status)}] ${described}`);
    void Effect.runPromise(
      writeLog(logPath, {
        level: status >= 500 ? "error" : "warn",
        message: `HTTP ${String(status)}`,
        source: "server",
        detail: body,
      }),
    );
  }
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
};

/**
 * Sérialise une réponse **en la validant contre le contrat partagé**.
 *
 * C'est la garantie structurelle : le serveur ne peut plus émettre une réponse
 * que le client refusera de décoder. Une réponse hors contrat devient un 500
 * **nommant le fichier du contrat**, au lieu d'un objet silencieusement
 * incomplet qui se manifests plus tard comme « Herdr injoignable ».
 */
export const respond = (
  logPath: string,
  decodeBody: (payload: unknown) => unknown,
  body: unknown,
  status = 200,
): Response => {
  const value = decodeBody(body);
  if (value === undefined) {
    return json(
      logPath,
      {
        error: "the server produced a response outside the contract",
        hint: "voir packages/shared/src/api.ts — le contrat fait foi",
      },
      500,
    );
  }
  return json(logPath, value, status);
};

/**
 * Exécute un effet et rend une réponse.
 *
 * Un échec **non typé** (défaut) devient un 500 explicite : on ne renvoie
 * jamais un 200 sur une erreur.
 */
export const run = async <A, E>(
  logPath: string,
  effect: Effect.Effect<A, E>,
  onSuccess: (value: A) => Response,
): Promise<Response> => {
  const result = await Effect.runPromise(Effect.result(effect));
  if (Result.isSuccess(result)) {
    const value = Option.getOrUndefined(Result.getSuccess(result));
    return value === undefined
      ? json(logPath, { error: "unreadable result" }, 500)
      : onSuccess(value);
  }
  const failure = failureOf(result);
  return json(
    logPath,
    { error: failure === undefined ? "unknown failure" : describe(failure) },
    500,
  );
};

/** Décodeur tolérant : renvoie `undefined` plutôt que de lever. */
export const decoderOf =
  <S extends Parameters<typeof Schema.decodeUnknownOption>[0]>(schema: S) =>
  (payload: unknown): S["Type"] | undefined =>
    Option.getOrUndefined(Schema.decodeUnknownOption(schema)(payload));
/**
 * Décodeur du snapshot Herdr.
 *
 * ⚠️ `session.snapshot` renvoie `{ snapshot: {...} }`, pas l'objet direct. Lire
 * `payload["agents"]` comparait une liste **vide** à chaque tour, en silence : le
 * cache semblait toujours vide sans jamais le dire (D012.4). Cette forme
 * inattendue est donc signalée par un échec explicite, jamais convertie en liste
 * vide.
 */
export const decodeSnapshot = Schema.decodeUnknownOption(SnapshotPayload);
