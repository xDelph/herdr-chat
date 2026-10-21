import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { refreshLoop, cadenceMs, DEFAULT_CONFIG } from "../src/v2/services/Refresh.ts";

describe("Refresh service (Effect)", () => {
  test("cadenceMs returns correct values for all combinations", () => {
    expect(cadenceMs(DEFAULT_CONFIG, true, false)).toBe(4_000);
    expect(cadenceMs(DEFAULT_CONFIG, false, false)).toBe(60_000);
    expect(cadenceMs(DEFAULT_CONFIG, true, true)).toBe(30_000);
    expect(cadenceMs(DEFAULT_CONFIG, false, true)).toBe(120_000);
  });

  test("refreshLoop calls refresh immediately", async () => {
    let count = 0;
    const refresh = async () => {
      count++;
    };
    const fiber = Effect.runFork(
      refreshLoop(refresh, () => false, { ...DEFAULT_CONFIG, visibleMs: 1000 }),
    );
    await new Promise((r) => setTimeout(r, 50));
    Effect.runSync(Fiber.interrupt(fiber));
    const result = count;
    expect(result).toBeGreaterThanOrEqual(1);
  });
});
