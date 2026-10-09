/**
 * Tests de contrat des réponses HTTP.
 *
 * **Ce fichier existe à cause d'un bug réel.** Le handler `/api/health`
 * omettait `reachable` dans sa branche succès, alors que le schéma du client
 * l'exigeait. Résultat sur l'iPhone : « Forme de réponse inattendue : health »
 * puis « Herdr injoignable » — deux symptômes pour un seul défaut, et **aucun
 * test ne l'a vu**.
 *
 * Chaque réponse émise par le serveur est ici validée contre le contrat partagé
 * de `@herdr-remote/shared`. Si un champ disparaît, ce test échoue **avant**
 * que quiconque ouvre l'application.
 *
 * Les deux branches de `/api/health` sont testées : Herdr joignable **et**
 * injoignable. C'est la branche non testée qui portait le bug.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import {
  ApiErrorResponse,
  HealthResponse,
  OverviewResponse,
  PromptSentResponse,
  PromptSuppressedResponse,
  SessionResponse,
  TerminalResponse,
} from "@herdr-remote/shared";
import { makeRoutes } from "./Api.ts";
import type { ServerConfig } from "../config.ts";
import type { EventHubApi } from "../events/EventHub.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import type { HerdrError } from "../herdr/HerdrClient.ts";
import { PromptSender } from "../send/PromptSender.ts";
import type { WatchLoop } from "../events/AgentWatcher.ts";
import { HerdrProtocolError } from "../herdr/HerdrClient.ts";

const config: ServerConfig = {
  duplicateWindowMs: 60_000,
  herdrSocketPath: "/tmp/fake.sock",
  hostname: "127.0.0.1",
  piSessionsRoot: "/tmp/sessions",
  port: 8790,
  uploadDir: "/tmp/uploads",
};

const protocolError = () =>
  new HerdrProtocolError({ code: "x", message: "injoignable", method: "ping" });

const fail = <A>(): Effect.Effect<A, HerdrError> => Effect.fail(protocolError());

/** Client Herdr simulé : `health` décide si `ping` réussit ou non. */
const fakeHerdr = (options: { healthy: boolean }): HerdrApi => {
  return {
    createTab: () =>
      options.healthy ? Effect.succeed({ paneId: "w1:p9", tabId: "w1:t9" }) : fail(),
    getAgent: () => (options.healthy ? Effect.succeed({}) : fail()),
    listAgents: () => (options.healthy ? Effect.succeed({ agents: [], skipped: 0 }) : fail()),
    ping: () =>
      options.healthy
        ? Effect.succeed({ protocol: 22, version: "0.9.3" })
        : Effect.fail(protocolError()),
    promptAgent: () => Effect.succeed({}),
    readAgent: () => Effect.succeed({ text: "sortie", truncated: false }),
    request: () => (options.healthy ? Effect.succeed({}) : fail()),
    startAgent: () => (options.healthy ? Effect.succeed({}) : fail()),
    snapshot: () =>
      options.healthy
        ? Effect.succeed({
            snapshot: { agents: [], protocol: 22, version: "0.9.3", workspaces: [] },
          })
        : fail(),
  };
};

const fakeHub: EventHubApi = {
  lastId: () => Effect.succeed(0),
  publish: (kind, data) => Effect.succeed({ at: Date.now(), data, id: 1, kind }),
  since: () => Effect.succeed({ events: [], resyncRequired: false }),
};

const fakeWatch: WatchLoop = {
  errorCount: () => Effect.succeed(0),
  lastAgents: () => Effect.succeed([]),
  lastAt: () => Effect.succeed(0),
};

const build = async (healthy: boolean) => {
  const herdr = fakeHerdr({ healthy });
  const sender = await Effect.runPromise(PromptSender.make(herdr, 60_000));
  return makeRoutes({
    config,
    herdr,
    hub: fakeHub,
    sender,
    startedAt: Date.now(),
    watch: fakeWatch,
  });
};

/**
 * Récupère un handler de route en échouant explicitement s'il est absent.
 * Évite une assertion non-nulle, qui masquerait une route renommée.
 */
const handler = (routes: ReturnType<typeof makeRoutes>, path: string) => {
  const fn = routes[path];
  if (fn === undefined) throw new Error(`route absente : ${path}`);
  return fn;
};

/** Requête minimale conforme à `RouteRequest` — aucune assertion nécessaire. */
const request = (
  params: Record<string, string | undefined> = {},
  body?: unknown,
  url = "http://127.0.0.1/api/test",
) => ({
  headers: { get: () => null },
  json: async () => body,
  params,
  url,
});

/** Décode le corps d'une réponse contre un schéma du contrat partagé. */
const decodeBody = async <S extends Parameters<typeof Schema.decodeUnknownOption>[0]>(
  response: Response,
  schema: S,
  label: string,
) => {
  const payload: unknown = await response.json();
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(schema)(payload));
  if (decoded === undefined) {
    throw new Error(
      `réponse hors contrat (${label}, HTTP ${response.status}) : ${JSON.stringify(payload)}`,
    );
  }
  return decoded;
};

describe("contrat HTTP — /api/health", () => {
  test("Herdr joignable : 200 conforme, avec `reachable: true`", async () => {
    const routes = await build(true);
    const response = await handler(routes, "/api/health")(request());

    expect(response.status).toBe(200);
    const body = await decodeBody(response, HealthResponse, "health/ok");
    expect(body.ok).toBe(true);
    // Le champ qui manquait et cassait tout le décodage côté client.
    expect(body.herdr.reachable).toBe(true);
    expect(body.herdr.version).toBe("0.9.3");
    expect(body.herdr.protocol).toBe(22);
  });

  test("Herdr injoignable : 503 conforme, avec `reachable: false`", async () => {
    const routes = await build(false);
    const response = await handler(routes, "/api/health")(request());

    expect(response.status).toBe(503);
    const body = await decodeBody(response, HealthResponse, "health/ko");
    expect(body.ok).toBe(false);
    expect(body.herdr.reachable).toBe(false);
    // On ne prétend pas connaître la version quand on ne peut pas la lire.
    expect(body.herdr.version).toBeUndefined();
  });
});

describe("contrat HTTP — /api/overview", () => {
  test("réponse conforme au contrat", async () => {
    const routes = await build(true);
    const response = await handler(routes, "/api/overview")(request());

    expect(response.status).toBe(200);
    const body = await decodeBody(response, OverviewResponse, "overview");
    expect(body.herdrVersion).toBe("0.9.3");
    expect(body.agents).toEqual([]);
    expect(body.withoutSession).toBe(0);
  });

  test("Herdr injoignable : erreur conforme, jamais une 200 trompeuse", async () => {
    const routes = await build(false);
    const response = await handler(routes, "/api/overview")(request());

    expect(response.status).not.toBe(200);
    await decodeBody(response, ApiErrorResponse, "overview/erreur");
  });
});

describe("contrat HTTP — /api/agents/:paneId/terminal", () => {
  test("réponse conforme, avec texte et troncature", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/agents/:paneId/terminal",
    )(request({ paneId: "w1:p1" }));

    const body = await decodeBody(response, TerminalResponse, "terminal");
    expect(body.text).toBe("sortie");
    expect(body.truncated).toBe(false);
  });
});

describe("contrat HTTP — /api/agents/:paneId/session", () => {
  test("agent sans chemin de session : 404 conforme, aucune donnée inventée", async () => {
    const routes = await build(true);
    // `getAgent` simulé renvoie `{}` : aucun `agent_session` exploitable.
    const response = await handler(
      routes,
      "/api/agents/:paneId/session",
    )(request({ paneId: "w1:p1" }));

    expect(response.status).toBe(404);
    await decodeBody(response, ApiErrorResponse, "session/sans-chemin");
  });
});

describe("contrat HTTP — /api/agents/:paneId/prompt", () => {
  test("corps invalide : 400 conforme", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/agents/:paneId/prompt",
    )(request({ paneId: "w1:p1" }, { pasText: 1 }));

    expect(response.status).toBe(400);
    await decodeBody(response, ApiErrorResponse, "prompt/corps-invalide");
  });

  test("envoi confirmé : 200 conforme", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/agents/:paneId/prompt",
    )(request({ paneId: "w1:p1" }, { text: "bonjour" }));

    expect(response.status).toBe(200);
    const body = await decodeBody(response, PromptSentResponse, "prompt/envoye");
    expect(body.status).toBe("sent");
    expect(body.confirmation).toBe("confirmed");
  });

  test("double envoi identique : 200 `suppressed`, ce n'est pas une erreur", async () => {
    const routes = await build(true);
    await handler(
      routes,
      "/api/agents/:paneId/prompt",
    )(request({ paneId: "w1:p1" }, { text: "bonjour" }));
    const response = await handler(
      routes,
      "/api/agents/:paneId/prompt",
    )(request({ paneId: "w1:p1" }, { text: "bonjour" }));

    expect(response.status).toBe(200);
    const body = await decodeBody(response, PromptSuppressedResponse, "prompt/supprime");
    expect(body.status).toBe("suppressed");
  });
});

/**
 * Garde-fou anti-régression ciblé : vérifie que **les deux branches** de
 * `/api/health` contiennent bien tous les champs requis par le contrat.
 * Un champ retiré d'une seule branche fait échouer ce test.
 */
describe("garde-fou : aucune branche de /api/health n'omet un champ requis", () => {
  for (const healthy of [true, false]) {
    test(`branche healthy=${String(healthy)}`, async () => {
      const routes = await build(healthy);
      const response = await handler(routes, "/api/health")(request());
      const payload: unknown = await response.json();
      const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(HealthResponse)(payload));
      // Le décodage par le contrat échouerait si un champ requis manquait.
      expect(decoded).toBeDefined();
      if (decoded === undefined) return;
      expect(decoded.ok).toBe(healthy);
      expect(decoded.herdr.reachable).toBe(healthy);
      expect(typeof decoded.herdr.socket).toBe("string");
      // `uptimeMs` doit être présent sur les deux branches : le client l'affiche.
      expect(typeof decoded.uptimeMs).toBe("number");
    });
  }
});

export { decodeBody, SessionResponse };
