/**
 * Bridge entre `SubscriptionRef` (Effect) et React.
 *
 * Un seul `SubscriptionRef<AppState>` est la source de vérité. Ce hook
 * s'abonne aux changements et ne re-render que si le slice change.
 */
import { useEffect, useState, useRef } from "react";
import { Effect, SubscriptionRef, Fiber, Stream } from "effect";
import type { AppState } from "./state.ts";

export function useSubscriptionRef<S extends AppState, A>(
  ref: SubscriptionRef.SubscriptionRef<S>,
  select: (s: S) => A,
  isEqual: (a: A, b: A) => boolean = Object.is,
): A {
  const [value, setValue] = useState<A>(() => select(Effect.runSync(SubscriptionRef.get(ref))));
  const prevRef = useRef<A>(value);

  useEffect(() => {
    const fiber = Effect.runFork(
      Stream.runForEach(SubscriptionRef.changes(ref), (s) => {
        const next = select(s);
        if (!isEqual(next, prevRef.current)) {
          prevRef.current = next;
          queueMicrotask(() => setValue(next));
        }
        return Effect.void;
      }),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  return value;
}
