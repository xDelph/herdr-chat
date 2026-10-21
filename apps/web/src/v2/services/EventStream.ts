/**
 * Service Effect : flux SSE comme `Stream`.
 *
 * Queue unbounded + Stream.fromQueue. L'interruption ferme l'EventSource.
 */
import { Effect, Stream, Queue } from "effect";
import { openEventStream } from "../../api.ts";

export type SseMessage =
  | { readonly _tag: "event"; readonly kind: string; readonly data: unknown }
  | { readonly _tag: "resync" }
  | { readonly _tag: "status"; readonly value: "live" | "down" };

export interface EventStreamService {
  readonly messages: Stream.Stream<SseMessage>;
}

export const createEventStream = (): Effect.Effect<EventStreamService> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<SseMessage>();

    const close = openEventStream({
      onEvent: (kind, data) => {
        Effect.runSync(Queue.offer(queue, { _tag: "event", kind, data }));
      },
      onResync: () => {
        Effect.runSync(Queue.offer(queue, { _tag: "resync" }));
      },
      onStatus: (s) => {
        Effect.runSync(Queue.offer(queue, { _tag: "status", value: s }));
      },
    });

    const messages = Stream.fromQueue(queue).pipe(Stream.ensuring(Effect.sync(() => close())));

    return { messages };
  });
