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
import { DUPLICATE_WINDOW_MS } from "@herdr-remote/shared";

/** La fenêtre vient du contrat partagé (S06), pas d’un littéral local. */
const WINDOW = DUPLICATE_WINDOW_MS;

/** Transport scripté : chaque appel consomme la réponse suivante. */
const makeHerdr = (responses: ReadonlyArray<string | TransportError>, trace?: Array<string>) =>
  Layer.effect(
    HerdrClient,
    Effect.gen(function* () {
      const transport = yield* TransportTag;
      return HerdrClient.make(transport);
    }),
  ).pipe(Layer.provide(TransportTag.layerTest(responses, trace)));

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

/**
 * Le mode « frappes » — et sa preuve.
 *
 * ⚠️ **Pourquoi ce test existe.** Herdr refuse `agent.prompt` sur un agent
 * bloqué sur une invite interactive ; c'est lui qui le dit, mesuré le
 * 2026-10-16 : « agent … is blocked and requires interactive input ». Le seul
 * chemin pour répondre à une question ouverte (« type your own answer ») est
 * donc d'**écrire dans le pane**, puis de valider.
 *
 * ⚠️ On ne se contente pas de vérifier que « ça a marché » : on vérifie QUELLE
 * méthode est partie. Un prompt et une saisie sont deux primitives différentes,
 * et le succès de l'une ne dit rien de l'autre.
 */
const senderTrace = (trace: Array<string>, responses: ReadonlyArray<string | TransportError>) =>
  Effect.runSync(
    Effect.gen(function* () {
      const herdr = yield* HerdrClient;
      return yield* PromptSender.make(herdr, WINDOW);
    }).pipe(Effect.provide(makeHerdr(responses, trace))),
  );

describe("PromptSender — prompt ou frappes, jamais confondus", () => {
  test("le mode normal envoie un PROMPT, et rien d'autre", async () => {
    const trace: Array<string> = [];
    const sender = senderTrace(trace, [prompted("r1")]);

    const outcome = await Effect.runPromise(sender.send("w1:p1", "continue", 1_000));

    expect(outcome.status).toBe("sent");
    expect(trace).toEqual(["agent.prompt"]);
  });

  test("le mode saisie écrit du TEXTE puis valide — deux appels, dans cet ordre", async () => {
    const trace: Array<string> = [];
    const sender = senderTrace(trace, [prompted("r1"), prompted("r2")]);

    const outcome = await Effect.runPromise(sender.send("w1:p1", "ma réponse", 1_000, true));

    expect(outcome.status).toBe("sent");
    expect(trace).toEqual(["pane.send_text", "agent.send_keys"]);
  });

  test("le mode saisie n'essaie JAMAIS `agent.prompt`", async () => {
    // ⚠️ C'est tout l'objet du mode : sur un agent bloqué, `agent.prompt` est
    // refusé par Herdr. L'envoyer d'abord ferait échouer un envoi qui pouvait
    // réussir.
    const trace: Array<string> = [];
    const sender = senderTrace(trace, [prompted("r1"), prompted("r2")]);

    await Effect.runPromise(sender.send("w1:p1", "ma réponse", 1_000, true));

    expect(trace).not.toContain("agent.prompt");
  });

  test("une saisie en échec ne bloque pas l'envoi suivant", async () => {
    // Même règle que pour un prompt : rien n'est enregistré si l'envoi échoue.
    const trace: Array<string> = [];
    const sender = senderTrace(trace, [
      new TransportError({ cause: "socket fermé", detail: "(test)", socketPath: "(test)" }),
      prompted("r1"),
      prompted("r2"),
    ]);

    const premier = await Effect.runPromise(
      Effect.result(sender.send("w1:p1", "ma réponse", 1_000, true)),
    );
    expect(Result.isFailure(premier)).toBe(true);

    const second = await Effect.runPromise(sender.send("w1:p1", "ma réponse", 2_000, true));
    expect(second.status).toBe("sent");
  });
});
