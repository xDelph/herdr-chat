/**
 * API HTTP locale.
 *
 * **Décision D009** : le routage utilise les routes natives de Bun
 * (`Bun.serve({ routes })`) et non `HttpRouter` d'Effect 4. Motif : l'API
 * `HttpRouter` (params ambiants, `make`/`add`) est instable en 4.0.2 et coûte
 * plus qu'elle ne rapporte pour 7 routes. **Effect structure tout le cœur**
 * (services, `Layer`, erreurs typées, concurrence, `Ref`) ; Bun ne fait que le
 * transport. Le spec demande qu'Effect structure le backend, ce qui est le cas.
 *
 * Le flux temps réel est en **SSE**, pas en WebSocket (voir D009) : c'est ce
 * qui donne le rattrapage après coupure, qu'Herdr ne peut pas fournir.
 */
import { Effect, Option, Result, Schema } from "effect";
import type { Cause } from "effect";
import { AgentInfo, WorkspaceInfo } from "@herdr-remote/shared";
import { buildOverview } from "../agents/AgentRegistry.ts";
import type { ServerConfig } from "../config.ts";
import type { EventHubApi } from "../events/EventHub.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import type { PromptSenderApi } from "../send/PromptSender.ts";
import { readAll } from "../sessions/SessionReader.ts";

export interface ApiDeps {
  readonly config: ServerConfig;
  readonly herdr: HerdrApi;
  readonly hub: EventHubApi;
  readonly sender: PromptSenderApi;
  readonly startedAt: number;
}

/** Corps de requête attendu pour l'envoi d'un prompt. */
const PromptBody = Schema.Struct({ text: Schema.String });

/** Emplacement `agent_session` d'un agent, tel que le renvoie Herdr. */
const AgentSessionSlot = Schema.Struct({
  agent_session: Schema.optional(
    Schema.NullOr(Schema.Struct({ kind: Schema.String, value: Schema.String })),
  ),
});

const SnapshotShape = Schema.Struct({
  agents: Schema.Array(AgentInfo),
  protocol: Schema.Number,
  version: Schema.String,
  workspaces: Schema.Array(WorkspaceInfo),
});

const decodeSnapshot = Schema.decodeUnknownOption(SnapshotShape);
const decodePromptBody = Schema.decodeUnknownOption(PromptBody);
const decodeSessionSlot = Schema.decodeUnknownOption(AgentSessionSlot);

export const sessionPathOf = (agent: unknown): string | undefined => {
  const decoded = Option.getOrUndefined(decodeSessionSlot(agent));
  if (decoded === undefined) return undefined;
  const info = decoded.agent_session;
  if (info === undefined || info === null || info.kind !== "path") return undefined;
  return info.value;
};

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Rend lisible n'importe quelle erreur typée d'Effect. */
const describe = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    return JSON.stringify(error);
  }
  return String(error);
};

const describeCause = (cause: Cause.Cause<unknown>): string =>
  cause.reasons.map((reason) => describe(reason)).join(" ; ");

/**
 * Extrait l'**échec** typé d'un `Result`.
 *
 * ⚠️ Piège Effect 4 : `Result.getOrUndefined` renvoie la valeur de **succès**
 * (ou `undefined` sur un échec). Pour lire l'erreur il faut `Result.getFailure`,
 * qui renvoie un `Option<E>`. Utiliser `getOrUndefined` pour lire une erreur
 * produit silencieusement `undefined` et masque la cause réelle.
 */
const failureOf = (result: Result.Result<unknown, unknown>): unknown =>
  Option.getOrUndefined(Result.getFailure(result));

/**
 * Exécute un effet et le convertit en `Response`.
 *
 * Un échec **non typé** (défaut) devient un 500 explicite : on ne renvoie
 * jamais un 200 sur une erreur.
 */
const run = async <A, E>(
  effect: Effect.Effect<A, E>,
  onSuccess: (value: A) => Response,
): Promise<Response> => {
  const result = await Effect.runPromise(Effect.result(effect));
  if (Result.isSuccess(result)) {
    const value = Option.getOrUndefined(Result.getSuccess(result));
    return value === undefined ? json({ error: "résultat illisible" }, 500) : onSuccess(value);
  }
  const failure = failureOf(result);
  return json({ error: failure === undefined ? "échec inconnu" : describe(failure) }, 500);
};

export interface Routes {
  readonly [path: string]: (request: Bun.BunRequest) => Response | Promise<Response>;
}

export const makeRoutes = (deps: ApiDeps): Routes => {
  const { config, herdr, hub, sender, startedAt } = deps;

  const health = (): Promise<Response> =>
    run(
      Effect.gen(function* () {
        const ping = yield* herdr.ping();
        return {
          herdr: {
            protocol: ping.protocol,
            socket: config.herdrSocketPath,
            version: ping.version,
          },
          ok: true,
          uptimeMs: Date.now() - startedAt,
        };
      }),
      (body) => json(body),
    );

  const overview = (): Promise<Response> =>
    run(
      Effect.gen(function* () {
        const payload = yield* herdr.snapshot();
        const snapshot = Option.getOrUndefined(decodeSnapshot(payload["snapshot"]));
        if (snapshot === undefined) {
          return yield* Effect.fail({ message: "snapshot Herdr illisible (forme inattendue)" });
        }
        return yield* buildOverview(snapshot);
      }),
      (body) => json(body),
    );

  const terminal = (request: Bun.BunRequest): Promise<Response> =>
    run(
      Effect.gen(function* () {
        const paneId = request.params["paneId"] ?? "";
        return yield* herdr.readAgent(paneId);
      }),
      (body) => json(body),
    );

  const session = async (request: Bun.BunRequest): Promise<Response> => {
    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const paneId = request.params["paneId"] ?? "";
          const payload = yield* herdr.getAgent(paneId);
          const path = sessionPathOf(payload["agent"]);
          if (path === undefined) {
            return { kind: "no-session" as const };
          }
          // Contenu depuis le JSONL Pi — jamais depuis Herdr (D008.1).
          const tailed = yield* readAll(path);
          return { kind: "ok" as const, path, tailed };
        }),
      ),
    );
    {
      if (Result.isFailure(result)) {
        const failure = failureOf(result);
        return json({ error: failure === undefined ? "échec inconnu" : describe(failure) }, 502);
      }
      const value = Option.getOrUndefined(Result.getSuccess(result));
      if (value === undefined) {
        return json({ error: "résultat de session illisible" }, 500);
      }
      if (value.kind === "no-session") {
        return json({ error: "aucun chemin de session exploitable pour cet agent" }, 404);
      }
      return json({
        entries: value.tailed.entries,
        offset: value.tailed.offset,
        sessionPath: value.path,
      });
    }
  };

  const prompt = async (request: Bun.BunRequest): Promise<Response> => {
    const raw: unknown = await request.json().catch(() => undefined);
    const body = Option.getOrUndefined(decodePromptBody(raw));
    if (body === undefined) {
      return json({ error: "corps invalide : `text` (chaîne) requis" }, 400);
    }
    const paneId = request.params["paneId"] ?? "";

    const result = await Effect.runPromise(Effect.result(sender.send(paneId, body.text)));

    if (Result.isSuccess(result)) {
      const outcome = Option.getOrUndefined(Result.getSuccess(result));
      if (outcome === undefined) {
        return json({ error: "résultat d'envoi illisible" }, 500);
      }
      await Effect.runPromise(hub.publish("prompt", { paneId, ...outcome }));
      return json(outcome);
    }

    const failure = failureOf(result);
    // Un double envoi n'est pas une erreur serveur : c'est un no-op assumé (D007.2).
    if (failure !== undefined && isDuplicate(failure)) {
      await Effect.runPromise(
        hub.publish("prompt-suppressed", { paneId, reason: "envoi identique consécutif" }),
      );
      return json({
        reason: "envoi identique déjà confirmé dans la fenêtre",
        status: "suppressed",
      });
    }
    return json(
      { error: `envoi non confirmé : ${failure === undefined ? "inconnu" : describe(failure)}` },
      502,
    );
  };

  /**
   * Flux SSE avec rattrapage.
   *
   * `EventSource` rejoue `Last-Event-ID` à la reconnexion : le client reçoit
   * exactement les événements manqués. Si le journal a été tronqué, un
   * événement `resync` est émis plutôt que de laisser un trou silencieux.
   */
  const events = (request: Request): Response => {
    const header = request.headers.get("last-event-id");
    const parsed = header === null ? 0 : Number.parseInt(header, 10);
    let cursor = Number.isInteger(parsed) ? parsed : 0;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Signal de vie immédiat : le client sait que le flux est établi.
        controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`));
        let closed = false;
        // Séquence volontaire : on interroge le journal, on émet, PUIS on
        // attend. Paralléliser n'aurait pas de sens ici — c'est une boucle de
        // scrutation, pas une collecte de promesses indépendantes.
        /* oxlint-disable no-await-in-loop */
        while (!closed) {
          try {
            const catchUp = await Effect.runPromise(hub.since(cursor));
            let buffer = "";
            if (catchUp.resyncRequired) {
              buffer += `event: resync\ndata: {"reason":"journal tronqué"}\n\n`;
            }
            for (const event of catchUp.events) {
              buffer += `id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;
            }
            if (catchUp.events.length > 0) {
              cursor = catchUp.events[catchUp.events.length - 1]?.id ?? cursor;
            }
            if (buffer.length > 0) controller.enqueue(encoder.encode(buffer));
            await Bun.sleep(300);
          } catch (cause) {
            closed = true;
            controller.error(cause);
          }
        }
        /* oxlint-enable no-await-in-loop */
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      },
    });
  };

  return {
    "/api/agents/:paneId/prompt": prompt,
    "/api/agents/:paneId/session": session,
    "/api/agents/:paneId/terminal": terminal,
    "/api/events": events,
    "/api/health": health,
    "/api/overview": overview,
  };
};

/** Reconnaît le refus de double envoi sans dépendre du typage de l'union. */
const isDuplicate = (failure: unknown): boolean =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "DuplicatePrompt";

export { describeCause };
