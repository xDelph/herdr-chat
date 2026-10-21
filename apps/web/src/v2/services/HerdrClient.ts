/**
 * Service Effect : client HTTP vers le démon Rust.
 *
 * ⚠️ **Ce module est la seule porte d'entrée vers le réseau.** Aucun composant
 * ne fait de `fetch` direct ; tout passe par ce service, qui expose des
 * `Effect<A, E>` avec des erreurs typées. Les tests swappent la layer `Live`
 * contre `Test` sans toucher au code des composants.
 */
import { Context, Data, Effect, Layer } from "effect";
import type { Health, InstalledKind, Overview } from "../../api.ts";
import type { ConversationSummary } from "@herdr-remote/shared";

/** Erreurs typées — jamais de `string` brute. */
export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly cause: unknown;
}> {}

export class HttpError extends Data.TaggedError("HttpError")<{
  readonly status: number;
  readonly body: string;
}> {}

export class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly field: string;
  readonly cause: unknown;
}> {}

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly ms: number;
}> {}

export type HerdrError = NetworkError | HttpError | DecodeError | TimeoutError;

/** L'interface du service — ce que les composants consomment. */
export interface HerdrClientService {
  readonly health: () => Effect.Effect<Health, HerdrError>;
  readonly overview: () => Effect.Effect<Overview, HerdrError>;
  readonly conversations: () => Effect.Effect<ReadonlyArray<ConversationSummary>, HerdrError>;
  readonly fetchAgentKinds: () => Effect.Effect<ReadonlyArray<InstalledKind>, HerdrError>;
}

export const HerdrClient = Context.Service<HerdrClientService>("HerdrClient");

/** Layer de test : client scriptable, zéro réseau. */
export const HerdrClientTest = (
  impl: Partial<HerdrClientService>,
): Layer.Layer<HerdrClientService> =>
  Layer.succeed(HerdrClient, {
    // oxlint-disable-next-line no-unsafe-type-assertion
    health: () => Effect.succeed({} as Health),
    // oxlint-disable-next-line no-unsafe-type-assertion
    overview: () => Effect.succeed({} as Overview),
    conversations: () => Effect.succeed([]),
    fetchAgentKinds: () => Effect.succeed([]),
    ...impl,
  });
