/**
 * Client du protocole Herdr.
 *
 * Le client ne suppose **jamais** qu'une méthode existe parce que le schéma la
 * déclare : `events.wait` annonce 19 variantes et n'en implémente qu'une, et
 * `revision` vaut `0` en permanence (E3, `docs/PROTOCOL.md` §10). Les
 * capacités sont mesurées, pas déduites.
 *
 * Aucune donnée entrante n'est forcée par une assertion de type : tout passe
 * par un décodage `Schema`. Une charge utile partielle reste exploitable
 * plutôt que de faire tomber un écran (« fonctionnement dégradé propre »).
 */
import {
  AgentListPayload,
  AgentInfo,
  HerdrReply,
  Method,
  PaneReadPayload,
  PongPayload,
} from "@herdr-remote/shared";
import { Context, Effect, Layer, Option, Schema, pipe } from "effect";
import { TransportTag } from "./Transport.ts";
import type { TransportError } from "./Transport.ts";

/** Le serveur a répondu, mais avec une erreur de protocole. */
export class HerdrProtocolError extends Schema.TaggedError<HerdrProtocolError>()(
  "HerdrProtocolError",
  {
    code: Schema.String,
    message: Schema.String,
    method: Schema.String,
  },
) {}

/** La réponse n'est pas un JSON exploitable, ou pas une enveloppe valide. */
export class HerdrDecodeError extends Schema.TaggedError<HerdrDecodeError>()("HerdrDecodeError", {
  detail: Schema.String,
  method: Schema.String,
  raw: Schema.String,
}) {}

export type HerdrError = TransportError | HerdrProtocolError | HerdrDecodeError;

/** Payload utile d'une réponse : `result` tel quel. */
export type ResultPayload = Readonly<Record<string, unknown>>;

const decodeReply = Schema.decodeUnknownSync(HerdrReply);
const decodeAgentList = Schema.decodeUnknownOption(AgentListPayload);
const decodePaneRead = Schema.decodeUnknownOption(PaneReadPayload);
const decodePong = Schema.decodeUnknownOption(PongPayload);
const decodeAgent = Schema.decodeUnknownOption(AgentInfo);

export interface HerdrApi {
  /** Envoie une requête brute et renvoie le `result` décodé. */
  readonly request: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<ResultPayload, HerdrError>;

  /** `ping` — sert aussi à valider `protocol` et `capabilities`. */
  readonly ping: () => Effect.Effect<
    { readonly protocol: number; readonly version: string },
    HerdrError
  >;

  /** Agents valides. Les entrées non décodables sont écartées, pas fatales. */
  readonly listAgents: () => Effect.Effect<
    { readonly agents: ReadonlyArray<AgentInfo>; readonly skipped: number },
    HerdrError
  >;

  readonly snapshot: () => Effect.Effect<ResultPayload, HerdrError>;
  readonly getAgent: (target: string) => Effect.Effect<ResultPayload, HerdrError>;

  readonly readAgent: (
    target: string,
    lines?: number,
  ) => Effect.Effect<{ readonly text: string; readonly truncated: boolean }, HerdrError>;

  readonly promptAgent: (target: string, text: string) => Effect.Effect<ResultPayload, HerdrError>;
}

export class HerdrClient extends Context.Service<HerdrClient, HerdrApi>()(
  "herdr-remote/herdr/HerdrClient",
) {
  /**
   * Construit le client à partir d'un transport.
   *
   * `make` est séparé du `Layer` : les tests composent le client avec un
   * transport en mémoire, sans toucher au système de fichiers.
   */
  static readonly make = (transport: {
    readonly send: (line: string) => Effect.Effect<string, TransportError>;
  }): HerdrApi => {
    let counter = 0;

    const request = (
      method: string,
      params: Readonly<Record<string, unknown>> = {},
    ): Effect.Effect<ResultPayload, HerdrError> =>
      Effect.gen(function* () {
        const id = yield* Effect.sync(() => `hr-${++counter}`);
        const line = yield* Effect.sync(() => JSON.stringify({ id, method, params }));
        const raw = yield* transport.send(line);

        const reply = yield* Effect.try({
          try: () => decodeReply(JSON.parse(raw)),
          catch: (cause) =>
            new HerdrDecodeError({
              detail: cause instanceof Error ? cause.message : String(cause),
              method,
              raw,
            }),
        });

        if (reply.error !== undefined) {
          return yield* Effect.fail(
            new HerdrProtocolError({
              code: reply.error.code,
              message: reply.error.message,
              method,
            }),
          );
        }

        const result = reply.result;
        if (result === undefined) {
          return yield* Effect.fail(
            new HerdrDecodeError({
              detail: "réponse sans `result` ni `error`",
              method,
              raw,
            }),
          );
        }

        return result;
      }).pipe(Effect.withSpan("HerdrClient.request", { attributes: { method } }));

    const listAgents = () =>
      pipe(
        request(Method.agentList),
        Effect.map((payload) => {
          const decoded = decodeAgentList(payload);
          if (Option.isNone(decoded)) {
            // Le lot entier est illisible : on retente agent par agent pour
            // sauver ce qui peut l'être.
            const rawItems = payload["agents"];
            const items = Schema.is(Schema.Array(Schema.Unknown))(rawItems) ? rawItems : [];
            const agents = items.flatMap((item) => {
              const one = decodeAgent(item);
              return Option.isSome(one) ? [one.value] : [];
            });
            return { agents, skipped: items.length - agents.length };
          }
          return { agents: decoded.value.agents, skipped: 0 };
        }),
      );

    const snapshot = () => request(Method.sessionSnapshot);

    const getAgent = (target: string) => request(Method.agentGet, { target });

    const readAgent = (target: string, lines = 200) =>
      pipe(
        request(Method.agentRead, {
          target,
          source: "recent",
          lines,
          strip_ansi: true,
        }),
        Effect.map((payload) => {
          const decoded = decodePaneRead(payload);
          return {
            text: Option.isSome(decoded) ? (decoded.value.read?.text ?? "") : "",
            truncated: Option.isSome(decoded) ? (decoded.value.read?.truncated ?? false) : false,
          };
        }),
      );

    const promptAgent = (target: string, text: string) =>
      request(Method.agentPrompt, { target, text });

    const ping = () =>
      pipe(
        request(Method.ping),
        Effect.flatMap((payload) => {
          const decoded = decodePong(payload);
          return Option.isSome(decoded)
            ? Effect.succeed(decoded.value)
            : Effect.fail(
                new HerdrDecodeError({
                  detail: "réponse `ping` sans `protocol` ni `version`",
                  method: Method.ping,
                  raw: JSON.stringify(payload),
                }),
              );
        }),
      );

    return HerdrClient.of({
      getAgent,
      listAgents,
      ping,
      promptAgent,
      readAgent,
      request,
      snapshot,
    });
  };

  /** Layer de production : transport réel sur le socket Unix fourni. */
  static readonly layer = (socketPath: string) =>
    Layer.effect(
      HerdrClient,
      Effect.gen(function* () {
        const transport = yield* TransportTag;
        return HerdrClient.make(transport);
      }),
    ).pipe(Layer.provide(TransportTag.layer(socketPath)));
}
