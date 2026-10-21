/**
 * Implémentation Live du service HerdrClient — fetch natif wrappé en Effect.
 */
import { Effect } from "effect";
import { NetworkError, DecodeError, type HerdrClientService } from "./HerdrClient.ts";
import { fetchHealth, fetchOverview, fetchConversations, fetchAgentKinds } from "../../api.ts";

const toEffect = <A>(promise: Promise<A>): Effect.Effect<A, NetworkError | DecodeError> =>
  Effect.tryPromise({
    try: () => promise,
    catch: (cause) => {
      if (cause instanceof Error && cause.message.includes("unexpected response shape")) {
        return new DecodeError({ cause, field: "response" });
      }
      return new NetworkError({ cause });
    },
  });

export const HerdrClientLive: HerdrClientService = {
  health: () => toEffect(fetchHealth()),
  overview: () => toEffect(fetchOverview()),
  conversations: () => toEffect(fetchConversations()).pipe(Effect.map((r) => r.conversations)),
  fetchAgentKinds: () => toEffect(fetchAgentKinds()),
};

/** Layer Live pour injection. */
import { Layer } from "effect";
import { HerdrClient } from "./HerdrClient.ts";

export const HerdrClientLiveLayer = Layer.succeed(HerdrClient, HerdrClientLive);
