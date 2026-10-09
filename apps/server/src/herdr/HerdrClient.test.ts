/**
 * Tests du client Herdr — **aucun Herdr requis**.
 *
 * Le transport est remplacé par une file de réponses scriptées. C'est ce qui
 * permet de tester succès, erreur de protocole, réponse malformée, charge utile
 * partielle et panne de transport, sans machine configurée (exigence T3.2).
 */
import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option, Result } from "effect";
import { HerdrClient, HerdrDecodeError, HerdrProtocolError } from "./HerdrClient.ts";
import { TransportError, TransportTag } from "./Transport.ts";

/** Agent minimal mais **complet** : satisfait les champs requis d'`AgentInfo`. */
const agent = (paneId: string) => ({
  agent: "pi",
  agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: `/s/${paneId}.jsonl` },
  agent_status: "idle",
  focused: false,
  pane_id: paneId,
  revision: 0,
  tab_id: "w1:t1",
  terminal_id: `term_${paneId}`,
  workspace_id: "w1",
});

const reply = (id: string, result: unknown) => JSON.stringify({ id, result });

/**
 * Extrait l'erreur typée d'un `Result` en échec.
 *
 * ⚠️ En Effect 4, `Result.getFailure` renvoie un `Option<E>` (et non `E` comme
 * en v3). C'est une différence d'API qui ne se voit qu'à l'exécution.
 */
const failureOf = (result: Result.Result<unknown, unknown>): unknown => {
  if (!Result.isFailure(result)) throw new Error("attendu en échec, obtenu un succès");
  const option = Result.getFailure(result);
  if (Option.isNone(option)) throw new Error("échec sans erreur typée (défaut ou interruption)");
  return option.value;
};

/**
 * Exécute un effet et rend un `Result` : plus besoin d'inspecter `Cause`.
 * `Effect.result` transforme l'échec typé en valeur de succès.
 */
const run = <A, E>(
  responses: ReadonlyArray<string | TransportError>,
  body: (client: HerdrClient["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const client = yield* HerdrClient;
        return yield* body(client);
      }),
    ).pipe(
      Effect.provide(
        Layer.effect(
          HerdrClient,
          Effect.gen(function* () {
            const transport = yield* TransportTag;
            return HerdrClient.make(transport);
          }),
        ).pipe(Layer.provide(TransportTag.layerTest(responses))),
      ),
    ),
  );

describe("HerdrClient", () => {
  test("décode une liste d'agents complète", async () => {
    const result = await run(
      [reply("hr-1", { type: "agent_list", agents: [agent("w1:p1")] })],
      (client) => client.listAgents(),
    );

    expect(Result.isSuccess(result)).toBe(true);
    const value = Result.getOrThrow(result);
    expect(value.agents).toHaveLength(1);
    expect(value.skipped).toBe(0);
    expect(value.agents[0]?.pane_id).toBe("w1:p1");
    expect(value.agents[0]?.agent_session?.kind).toBe("path");
  });

  test("écarte un agent incomplet sans faire tomber tout le lot", async () => {
    const result = await run(
      [
        reply("hr-1", {
          type: "agent_list",
          agents: [agent("w1:p1"), { pane_id: "incomplet" }],
        }),
      ],
      (client) => client.listAgents(),
    );

    const value = Result.getOrThrow(result);
    expect(value.agents).toHaveLength(1);
    expect(value.skipped).toBe(1);
  });

  test("propage une erreur de protocole avec son code et sa méthode", async () => {
    const result = await run(
      [
        JSON.stringify({
          id: "hr-1",
          error: { code: "unsupported_event_wait_match", message: "seul le statut est géré" },
        }),
      ],
      (client) => client.request("events.wait"),
    );

    const error = failureOf(result);
    expect(error).toBeInstanceOf(HerdrProtocolError);
    if (error instanceof HerdrProtocolError) {
      expect(error.code).toBe("unsupported_event_wait_match");
      expect(error.method).toBe("events.wait");
    }
  });

  test("rejette une réponse non-JSON sans planter", async () => {
    const result = await run(["ceci n'est pas du json"], (client) => client.ping());

    expect(failureOf(result)).toBeInstanceOf(HerdrDecodeError);
  });

  test("rejette une enveloppe sans result ni error", async () => {
    const result = await run([JSON.stringify({ id: "hr-1" })], (client) => client.ping());

    expect(failureOf(result)).toBeInstanceOf(HerdrDecodeError);
  });

  test("remonte une erreur de transport", async () => {
    const result = await run(
      [
        new TransportError({
          cause: "ENOENT",
          detail: "socket introuvable",
          socketPath: "/tmp/absent.sock",
        }),
      ],
      (client) => client.ping(),
    );

    expect(failureOf(result)).toBeInstanceOf(TransportError);
  });

  test("readAgent tolère une charge utile partielle", async () => {
    const result = await run(
      [reply("hr-1", { type: "pane_read", read: { pane_id: "w1:p1" } })],
      (client) => client.readAgent("w1:p1"),
    );

    const value = Result.getOrThrow(result);
    expect(value.text).toBe("");
    expect(value.truncated).toBe(false);
  });

  test("ping lit protocol et version", async () => {
    const result = await run(
      [reply("hr-1", { type: "pong", protocol: 22, version: "0.9.3" })],
      (client) => client.ping(),
    );

    const value = Result.getOrThrow(result);
    expect(value.protocol).toBe(22);
    expect(value.version).toBe("0.9.3");
  });

  test("un ping sans version échoue explicitement", async () => {
    const result = await run([reply("hr-1", { type: "pong", protocol: 22 })], (client) =>
      client.ping(),
    );

    expect(failureOf(result)).toBeInstanceOf(HerdrDecodeError);
  });

  test("conserve les champs non déclarés du result", async () => {
    const result = await run(
      [reply("hr-1", { type: "session_snapshot", snapshot: { protocol: 22 }, extra: "gardé" })],
      (client) => client.snapshot(),
    );

    const value = Result.getOrThrow(result);
    // Le décodage ne doit pas retirer ce qui n'est pas modélisé.
    expect(value["extra"]).toBe("gardé");
    expect(value["type"]).toBe("session_snapshot");
  });
});
