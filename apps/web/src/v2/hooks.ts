/* eslint-disable react-hooks/exhaustive-deps */
/**
 * Hooks React pour consommer les services Effect.
 *
 * ⚠️ **La frontière.** Les composants React ne voient jamais d'`Effect`
 * directement : ces hooks exécutent le programme et rendent le résultat
 * (valeur ou erreur) dans un état React. La logique métier reste dans les
 * services, testables sans React.
 */
import { useEffect, useState, useCallback } from "react";
import { Effect } from "effect";
import type { HerdrClientService } from "./services/HerdrClient.ts";
import { HerdrClientLiveLayer } from "./services/HerdrClientLive.ts";
// EventStream imported when needed

// Runtime not needed — we use Effect.runPromise with Effect.provide directly.

/** Exécute un programme Effect et rend le résultat. */
export function useRunEffect<A, E>(
  program: Effect.Effect<A, E, HerdrClientService>,
  deps: ReadonlyArray<unknown>,
): { readonly value: A | null; readonly error: unknown; readonly loading: boolean } {
  const [value, setValue] = useState<A | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const v = await Effect.runPromise(program.pipe(Effect.provide(HerdrClientLiveLayer)));
        if (!cancelled) {
          setValue(v);
          setError(null);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { value, error, loading };
}

/** Exécute un programme Effect à la demande. */
export function useRunEffectCallback<A, E, Args extends ReadonlyArray<unknown>>(
  program: (...args: Args) => Effect.Effect<A, E, HerdrClientService>,
): {
  readonly run: (...args: Args) => Promise<A>;
  readonly loading: boolean;
  readonly error: unknown;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(
    async (...args: Args): Promise<A> => {
      setLoading(true);
      setError(null);
      try {
        const result = await Effect.runPromise(
          program(...args).pipe(Effect.provide(HerdrClientLiveLayer)),
        );
        setLoading(false);
        return result;
      } catch (e) {
        setError(e);
        setLoading(false);
        throw e;
      }
    },
    [program],
  );

  return { run, loading, error };
}
