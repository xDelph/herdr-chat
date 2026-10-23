import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HerdrClient, HerdrClientTest } from "../src/v2/services/HerdrClient.ts";

describe("HerdrClient service", () => {
  test("HerdrClientTest provides a working layer", async () => {
    const layer = HerdrClientTest({
      // oxlint-disable-next-line no-unsafe-type-assertion
      health: () => Effect.succeed({ ok: true, uptimeMs: 100 } as unknown as never),
    });
    const program = Effect.gen(function* () {
      const client = yield* HerdrClient;
      return yield* client.health();
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toEqual({ ok: true, uptimeMs: 100 });
  });

  test("HerdrClientTest defaults return empty values", async () => {
    const layer = HerdrClientTest({});
    const program = Effect.gen(function* () {
      const client = yield* HerdrClient;
      const kinds = yield* client.fetchAgentKinds();
      return kinds;
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toEqual([]);
  });

  test("HerdrClientTest overrides work independently", async () => {
    const layer = HerdrClientTest({
      // oxlint-disable-next-line no-unsafe-type-assertion
      conversations: () => Effect.succeed([{ paneId: "p1" }] as unknown as never),
      // oxlint-disable-next-line no-unsafe-type-assertion
      health: () => Effect.succeed({ ok: true } as unknown as never),
    });
    const program = Effect.gen(function* () {
      const client = yield* HerdrClient;
      const convs = yield* client.conversations();
      const health = yield* client.health();
      return { convs, health };
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result.convs).toEqual([{ paneId: "p1" }]);
    expect(result.health).toEqual({ ok: true });
  });
});

describe("Refresh service", () => {
  test("cadenceMs returns correct values", async () => {
    const { cadenceMs, DEFAULT_CONFIG } = await import("../src/v2/services/Refresh.ts");
    expect(cadenceMs(DEFAULT_CONFIG, true, false)).toBe(4_000);
    expect(cadenceMs(DEFAULT_CONFIG, false, false)).toBe(60_000);
    expect(cadenceMs(DEFAULT_CONFIG, true, true)).toBe(30_000);
    expect(cadenceMs(DEFAULT_CONFIG, false, true)).toBe(120_000);
  });
});

describe("State service", () => {
  test("initialState has correct shape", async () => {
    const { initialState } = await import("../src/v2/state.ts");
    expect(initialState.chargement).toBe(true);
    expect(initialState.conversations).toEqual([]);
    expect(initialState.overview).toBeNull();
    /*
      ⚠️ `route` a quitté l'état : le fragment d'URL en est le seul propriétaire
      (c'est ce qui rend un lien ouvrable), et le champ doublonnait sans être lu.
    */
    expect("route" in initialState).toBe(false);
  });
});
