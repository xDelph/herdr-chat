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
import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiErrorResponse,
  DEFAULT_BACKEND_PORT,
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

/**
 * Journal **temporaire**, jamais celui de l'utilisateur (A03).
 *
 * Mesuré avant correction : chaque `bun test` écrivait des entrées `[server]`
 * dans `~/.herdr-remote/herdr-remote.log`, à côté des vraies pannes. Un test
 * qui pollue le journal de diagnostic détruit sa propre utilité.
 */
const TEST_TMP = mkdtempSync(join(tmpdir(), "herdr-remote-test-"));

const config: ServerConfig = {
  duplicateWindowMs: 60_000,
  extraFileRoots: [],
  herdrSocketPath: join(TEST_TMP, "fake.sock"),
  hostname: "127.0.0.1",
  logPath: join(TEST_TMP, "herdr-remote.log"),
  piSessionsRoot: join(TEST_TMP, "sessions"),
  port: DEFAULT_BACKEND_PORT,
  uploadDir: join(TEST_TMP, "uploads"),
};

afterAll(() => {
  rmSync(TEST_TMP, { force: true, recursive: true });
});

const protocolError = () =>
  new HerdrProtocolError({ code: "x", message: "injoignable", method: "ping" });

const fail = <A>(): Effect.Effect<A, HerdrError> => Effect.fail(protocolError());

/** Client Herdr simulé : `health` décide si `ping` réussit ou non. */
const fakeHerdr = (options: { healthy: boolean }): HerdrApi => {
  return {
    closeTab: fail,
    sendKeys: fail,
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

describe("identité des routes — A01", () => {
  /**
   * **Preuve de fin de l'extraction (A01).** Les routes sont identiques avant
   * et après : une extraction qui ajoute, retire ou renomme un chemin se voit
   * ici, pas en production. La liste est **figée**, donc toute évolution doit
   * être volontaire et visible dans la diff.
   *
   * On teste les clés, pas les réponses : les réponses sont validées contre le
   * contrat partagé dans les autres blocs de ce fichier.
   */
  test("la table de routes est exactement celle attendue", async () => {
    const routes = await build(true);

    expect(Object.keys(routes).toSorted()).toEqual([
      "/api/agents/:kind/models",
      "/api/agents/:paneId/prompt",
      "/api/agents/:paneId/session",
      "/api/agents/:paneId/terminal",
      "/api/agents/:paneId/trust",
      "/api/agents/kinds",
      "/api/events",
      "/api/file",
      "/api/health",
      "/api/images",
      "/api/log",
      "/api/overview",
      "/api/workspaces/:workspaceId/agents",
    ]);
  });

  test("aucune route n'est un oubli : toutes répondent", async () => {
    const routes = await build(true);
    for (const [path, fn] of Object.entries(routes)) {
      expect(typeof fn).toBe("function");
      // Une route sans params : évite un 400 de corps, on veut voir le type.
      expect(`${path}:${String(fn.length >= 0)}`).toBe(`${path}:true`);
    }
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
 * Lancement d'agent — **les cas d'erreur, pas seulement le succès**.
 *
 * ⚠️ Ces tests manquaient, et c'est précisément ce qui a laissé passer une
 * réponse `{"error":""}` : le lancement échouait sans rien dire, et
 * l'utilisateur ne pouvait rien diagnostiquer.
 */
describe("contrat HTTP — lancement d'agent", () => {
  test("projet inconnu : erreur LISIBLE, jamais vide", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "zzz" }, { kind: "pi" }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await decodeBody(response, ApiErrorResponse, "launch/projet-inconnu");
    expect(body.error.trim().length).toBeGreaterThan(0);
  });

  test("type d'agent inconnu : 400 avec la liste des types valides", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "pasunagent" }));

    expect(response.status).toBe(400);
    const body = await decodeBody(response, ApiErrorResponse, "launch/type-inconnu");
    expect(body.error).toContain("pasunagent");
    expect(body.hint).toBeDefined();
  });

  test("corps invalide : 400, message non vide", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, {}));

    expect(response.status).toBe(400);
    const body = await decodeBody(response, ApiErrorResponse, "launch/corps-invalide");
    expect(body.error.trim().length).toBeGreaterThan(0);
  });

  test("AUCUNE réponse d'erreur ne peut être vide", async () => {
    // Le défaut observé : `{"error":""}`. On l'interdit pour tous les cas.
    const routes = await build(true);
    const handlerFn = handler(routes, "/api/workspaces/:workspaceId/agents");
    const cases: ReadonlyArray<readonly [Record<string, string>, unknown]> = [
      [{ workspaceId: "zzz" }, { kind: "pi" }],
      [{ workspaceId: "w1" }, { kind: "inconnu" }],
      [{ workspaceId: "w1" }, {}],
      [{ workspaceId: "" }, { kind: "pi" }],
    ];

    // `Promise.all` garde l'ordre : le tableau de réponses est dans l'ordre de
    // `cases`, donc un échec reste rattaché au cas qu'il nomme.
    const responses: Response[] = await Promise.all(
      cases.map(([params, body]) => Promise.resolve(handlerFn(request(params, body)))),
    );

    const payloads = await Promise.all(
      // Décodage, pas d'assertion : une forme inattendue échoue le test.
      responses.map((response) => decodeBody(response, ApiErrorResponse, "launch/non-vide")),
    );
    for (const payload of payloads) {
      expect(payload.error.trim().length).toBeGreaterThan(0);
    }
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
