/**
 * Tests de la suppression des doubles envois — les **trois cas** exigés par
 * T3.5 / D007.2.
 *
 * 1. même texte consécutif → le second est supprimé ;
 * 2. premier envoi en échec → le second **passe** ;
 * 3. envoi confirmé puis répété **après la fenêtre** → **passe**.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Layer, Result } from "effect";
import { HerdrClient } from "../herdr/HerdrClient.ts";
import { TransportError, TransportTag } from "../herdr/Transport.ts";
import { PromptSender } from "./PromptSender.ts";

const WINDOW = 60_000;

/** Transport scripté : chaque appel consomme la réponse suivante. */
const makeHerdr = (responses: ReadonlyArray<string | TransportError>) =>
  Layer.effect(
    HerdrClient,
    Effect.gen(function* () {
      const transport = yield* TransportTag;
      return HerdrClient.make(transport);
    }),
  ).pipe(Layer.provide(TransportTag.layerTest(responses)));

const prompted = (id: string) => JSON.stringify({ id, result: { type: "agent_prompted" } });

const senderWith = (responses: ReadonlyArray<string | TransportError>) =>
  Effect.runSync(
    Effect.gen(function* () {
      const herdr = yield* HerdrClient;
      return yield* PromptSender.make(herdr, WINDOW);
    }).pipe(Effect.provide(makeHerdr(responses))),
  );

describe("PromptSender — suppression des doubles envois", () => {
  test("cas 1 : le même texte deux fois de suite → second supprimé", async () => {
    const sender = senderWith([prompted("r1")]);

    const first = await Effect.runPromise(sender.send("w1:p1", "continue", 1_000));
    expect(first.status).toBe("sent");
    expect(first.confirmation).toBe("confirmed");

    const second = await Effect.runPromise(Effect.result(sender.send("w1:p1", "continue", 1_001)));
    expect(Result.isFailure(second)).toBe(true);
    if (Result.isFailure(second)) {
      const option = Result.getFailure(second);
      expect(option._tag).toBe("Some");
    }
  });

  test("cas 1b : le texte DIFFÉRENT passe (seuls les identiques sont supprimés)", async () => {
    const sender = senderWith([prompted("r1"), prompted("r2")]);

    await Effect.runPromise(sender.send("w1:p1", "continue", 1_000));
    const other = await Effect.runPromise(sender.send("w1:p1", "autre chose", 1_001));
    expect(other.status).toBe("sent");
  });

  test("cas 1c : la même texte vers une AUTRE cible passe", async () => {
    const sender = senderWith([prompted("r1"), prompted("r2")]);

    await Effect.runPromise(sender.send("w1:p1", "continue", 1_000));
    const otherTarget = await Effect.runPromise(sender.send("w2:p1", "continue", 1_001));
    expect(otherTarget.status).toBe("sent");
  });

  test("cas 2 : premier envoi en ÉCHEC → le second PASSE", async () => {
    const sender = senderWith([
      new TransportError({
        cause: "coupure",
        detail: "connexion perdue",
        socketPath: "/tmp/x.sock",
      }),
      prompted("r2"),
    ]);

    const first = await Effect.runPromise(Effect.result(sender.send("w1:p1", "continue", 1_000)));
    expect(Result.isFailure(first)).toBe(true);

    const second = await Effect.runPromise(sender.send("w1:p1", "continue", 1_001));
    expect(second.status).toBe("sent");
    expect(second.confirmation).toBe("confirmed");
  });

  test("cas 2b : un échec ne laisse AUCUNE trace bloquante", async () => {
    const sender = senderWith([
      new TransportError({ cause: "x", detail: "échec", socketPath: "/tmp/x.sock" }),
    ]);

    await Effect.runPromise(Effect.result(sender.send("w1:p1", "continue", 1_000)));
    // Rien n'a été confirmé : aucune entrée suivie.
    const tracked = await Effect.runPromise(sender.tracked());
    expect(tracked).toBe(0);
  });

  test("cas 3 : confirmé, puis répété APRÈS la fenêtre → PASSE", async () => {
    const sender = senderWith([prompted("r1"), prompted("r2")]);

    await Effect.runPromise(sender.send("w1:p1", "continue", 1_000));
    // Bien au-delà de la fenêtre de 60 s.
    const later = await Effect.runPromise(sender.send("w1:p1", "continue", 1_000 + WINDOW + 1));
    expect(later.status).toBe("sent");
  });

  test("cas 3b : confirmé, puis répété DANS la fenêtre → supprimé", async () => {
    const sender = senderWith([prompted("r1")]);

    await Effect.runPromise(sender.send("w1:p1", "continue", 1_000));
    const within = await Effect.runPromise(
      Effect.result(sender.send("w1:p1", "continue", 1_000 + WINDOW - 1)),
    );
    expect(Result.isFailure(within)).toBe(true);
  });

  test("une erreur de protocole compte comme non confirmé", async () => {
    const sender = senderWith([
      JSON.stringify({ id: "r1", error: { code: "agent_prompt_failed", message: "refusé" } }),
      prompted("r2"),
    ]);

    const first = await Effect.runPromise(Effect.result(sender.send("w1:p1", "continue", 1_000)));
    expect(Result.isFailure(first)).toBe(true);

    const second = await Effect.runPromise(sender.send("w1:p1", "continue", 1_001));
    expect(second.status).toBe("sent");
  });
});
