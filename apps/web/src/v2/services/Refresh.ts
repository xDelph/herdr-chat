/**
 * Service Effect : boucle de rafraîchissement.
 *
 * Fournit une fonction `demarrer` qui lance la boucle et retourne un
 * `Effect` d'interruption (cleanup). La cadence suit `Schedule`-like logic
 * via `Effect.sleep`.
 */
import { Effect, Duration } from "effect";

export interface RefreshConfig {
  readonly visibleMs: number;
  readonly hiddenMs: number;
  readonly sseLiveVisibleMs: number;
  readonly sseLiveHiddenMs: number;
}

export const DEFAULT_CONFIG: RefreshConfig = {
  hiddenMs: 60_000,
  sseLiveHiddenMs: 120_000,
  sseLiveVisibleMs: 30_000,
  visibleMs: 4_000,
};

export const cadenceMs = (config: RefreshConfig, visible: boolean, sseLive: boolean): number =>
  sseLive
    ? visible
      ? config.sseLiveVisibleMs
      : config.sseLiveHiddenMs
    : visible
      ? config.visibleMs
      : config.hiddenMs;

/**
 * Lance la boucle de rafraîchissement. Retourne un Effect qui, quand il est
 * interrompu, arrête la boucle.
 */
export const refreshLoop = (
  refresh: () => Promise<void>,
  isSseLive: () => boolean,
  config: RefreshConfig = DEFAULT_CONFIG,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Premier rafraîchissement immédiat
    yield* Effect.tryPromise(() => refresh()).pipe(Effect.ignore);

    // Boucle infinie avec cadence dynamique
    while (true) {
      const visible = typeof document !== "undefined" && document.visibilityState === "visible";
      const ms = cadenceMs(config, visible, isSseLive());
      yield* Effect.sleep(Duration.millis(ms));
      yield* Effect.tryPromise(() => refresh()).pipe(Effect.ignore);
    }
  });
