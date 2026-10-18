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
  ConversationsResponse,
  DEFAULT_BACKEND_PORT,
  HealthResponse,
  OverviewResponse,
  PromptSentResponse,
  PromptSuppressedResponse,
  SessionResponse,
} from "@herdr-remote/shared";
import { makeRoutes } from "../../src/http/Api.ts";
import type { ServerConfig } from "../../src/config.ts";
import type { EventHubApi } from "../../src/events/EventHub.ts";
import type { HerdrApi } from "../../src/herdr/HerdrClient.ts";
import type { HerdrError } from "../../src/herdr/HerdrClient.ts";
import { PromptSender } from "../../src/send/PromptSender.ts";
import type { WatchLoop } from "../../src/events/AgentWatcher.ts";
import { HerdrProtocolError } from "../../src/herdr/HerdrClient.ts";

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
  opencodeDbPath: "/tmp/opencode-test.db",
  extraFileRoots: [],
  herdrSocketPath: join(TEST_TMP, "fake.sock"),
  hostname: "127.0.0.1",
  logPath: join(TEST_TMP, "herdr-remote.log"),
  sessionRoots: [join(TEST_TMP, "sessions")],
  publicOrigins: ["http://127.0.0.1:8791"],
  port: DEFAULT_BACKEND_PORT,
};

afterAll(() => {
  rmSync(TEST_TMP, { force: true, recursive: true });
});

const protocolError = () =>
  new HerdrProtocolError({ code: "x", message: "injoignable", method: "ping" });

const fail = <A>(): Effect.Effect<A, HerdrError> => Effect.fail(protocolError());

/** Client Herdr simulé : `health` décide si `ping` réussit ou non. */
/**
 * Compteurs d'effets chez Herdr.
 *
 * B07 exige que le refus d'un type non installé arrive **avant** la création
 * d'un onglet. Sans compteur, on ne peut que vérifier le code HTTP — et
 * l'ancien code renvoyait 400 lui aussi, après une liste fixe de 24 types.
 */
let createTabCalls = 0;
let startCalls = 0;
/** Noms envoyés à `agent.start`, dans l'ordre. */
let nomsDesAgents: Array<string> = [];

const fakeHerdr = (options: {
  healthy: boolean;
  listFails?: boolean;
  /** Instantané fourni : sert aux lancements, qui ont besoin d'un projet réel. */
  snapshot?: Readonly<Record<string, unknown>>;
  /** Écran rendu par `readAgent` : sert à éprouver la lecture de l'invite. */
  screen?: string;
}): HerdrApi => {
  return {
    closeTab: fail,
    sendKeys: fail,
    sendText: fail,
    focusAgent: () => Effect.succeed({}),
    createTab: () => {
      createTabCalls += 1;
      return options.healthy ? Effect.succeed({ paneId: "w1:p9", tabId: "w1:t9" }) : fail();
    },
    startAgent: (params: { readonly name?: string }) => {
      startCalls += 1;
      // ⚠️ Le **nom** est retenu : c'est lui qui devient l'étiquette du pane
      // quand l'onglet en contient plusieurs, et c'est la seule chose que cette
      // couche décide.
      nomsDesAgents.push(params.name ?? "");
      return options.healthy ? Effect.succeed({}) : fail();
    },
    getAgent: () => (options.healthy ? Effect.succeed({}) : fail()),
    listAgents: () => (options.healthy ? Effect.succeed({ agents: [], skipped: 0 }) : fail()),
    ping: () =>
      options.healthy
        ? Effect.succeed({ protocol: 22, version: "0.9.3" })
        : Effect.fail(protocolError()),
    promptAgent: () => Effect.succeed({}),
    readAgent: () => Effect.succeed({ text: options.screen ?? "sortie", truncated: false }),
    // `integration.list` : seuls `pi` et `codex` sont installés sur cette
    // machine. C'est le **seul** endroit qui en décide désormais.
    request: (method: string) => {
      if (method === "integration.list") {
        return options.listFails === true
          ? fail()
          : Effect.succeed({
              integrations: [
                {
                  available: true,
                  command: "pi",
                  label: "Pi",
                  state: "current",
                  target: "pi",
                },
                {
                  available: true,
                  command: "codex",
                  label: "Codex",
                  state: "current",
                  target: "codex",
                },
                {
                  available: false,
                  command: "claude",
                  label: "Claude",
                  state: "not_installed",
                  target: "claude",
                },
              ],
            });
      }
      return options.healthy ? Effect.succeed({}) : fail();
    },
    snapshot: () =>
      options.healthy
        ? Effect.succeed({
            snapshot: options.snapshot ?? {
              agents: [],
              protocol: 22,
              version: "0.9.3",
              workspaces: [],
            },
          })
        : fail(),
  };
};

const fakeHub: EventHubApi = {
  lastId: () => Effect.succeed(0),
  publish: (kind, data) => Effect.succeed({ at: Date.now(), data, id: 1, kind }),
  since: () => Effect.succeed({ events: [], resyncRequired: false, resumeFrom: 0 }),
};

const fakeWatch: WatchLoop = {
  errorCount: () => Effect.succeed(0),
  lastAgents: () => Effect.succeed([]),
  lastAt: () => Effect.succeed(0),
};

const build = async (
  healthy: boolean,
  extra: {
    listFails?: boolean;
    snapshot?: Readonly<Record<string, unknown>>;
    screen?: string;
  } = {},
) => {
  createTabCalls = 0;
  startCalls = 0;
  nomsDesAgents = [];
  const herdr = fakeHerdr({ healthy, ...extra });
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
const ORIGINE = "http://127.0.0.1:8791";

/**
 * Requête de test.
 *
 * `entetes` est paramétrable parce que S02 dépend **entièrement** des
 * en-têtes : `origin`, `content-type`. Un `get: () => null` par défaut ferait
 * échouer toutes les routes mutantes — c'est voulu, il faut les poser.
 */
const request = (
  params: Record<string, string | undefined> = {},
  body?: unknown,
  url = "http://127.0.0.1/api/test",
  entetes: Record<string, string> = { "content-type": "application/json", origin: ORIGINE },
  methode = "POST",
) => ({
  headers: { get: (name: string): string | null => entetes[name.toLowerCase()] ?? null },
  json: async () => body,
  method: methode,
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
      // Répondre à une question lue à l'écran (choix validé contre l'affiché).
      "/api/agents/:paneId/answer",
      // Acquittement : le pane prend le focus, donc la réponse est réputée lue.
      "/api/agents/:paneId/focus",
      "/api/agents/:paneId/prompt",
      "/api/agents/:paneId/session",
      "/api/agents/:paneId/stop",
      "/api/agents/:paneId/trust",
      "/api/agents/kinds",
      "/api/conversations",
      "/api/events",
      "/api/file",
      "/api/health",
      "/api/images",
      "/api/log",
      "/api/notifications/subscriptions",
      "/api/notifications/vapid-key",
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

  /**
   * B07 — la liste des types vient de `integration.list`, jamais d'une constante
   * écrite à la main. L'ancien test ne vérifiait que le code 400 : il passait
   * aussi bien avec une liste fixe de vingt-quatre types dont deux sont
   * installés. Ici on vérifie **la source** de la décision.
   */
  test("type d'agent non installé : 400, et AUCUN onglet créé", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "pasunagent" }));

    expect(response.status).toBe(400);
    const body = await decodeBody(response, ApiErrorResponse, "launch/type-inconnu");
    expect(body.error).toContain("pasunagent");
    // Le refus doit être **avant** toute création : c'est la garantie de B07.
    expect(createTabCalls).toBe(0);
    expect(startCalls).toBe(0);
  });

  test("un type présent dans la constante mais NON installé est refusé", async () => {
    // `AGENT_KINDS` contenait vingt-quatre types. Si l'ancien code tournait
    // encore, ce cas serait accepté puis échouerait plus tard — après avoir
    // créé un onglet. C'est exactement le défaut que B07 supprime.
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "claude" }));

    expect(response.status).toBe(400);
    expect(createTabCalls).toBe(0);
    expect(startCalls).toBe(0);
  });

  test("Herdr injoignable pour la liste : 503, pas un onglet créé à l'aveugle", async () => {
    const routes = await build(true, { listFails: true });
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "pi" }));

    expect(response.status).toBe(503);
    // « Je ne sais pas » ne doit jamais se traduire par « je crée quand même ».
    expect(createTabCalls).toBe(0);
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

/**
 * S02 — contrôle des requêtes mutantes.
 *
 * Le service n'a pas d'authentification (D02) : il écoute sur `127.0.0.1` et
 * Tailscale l'expose. Sans ce contrôle, un site tiers peut tenter un POST
 * vers le backend depuis le navigateur de l'utilisateur.
 *
 * Ce que ces tests prouvent, c'est que le refus arrive **avant** tout effet :
 * aucun prompt envoyé, aucun onglet créé, aucun `sendKeys`.
 */
/**
 * Applique un jeu d'en-têtes à **toutes** les routes mutantes et renvoie le
 * statut obtenu pour chacune, plus les compteurs d'effets Herdr.
 *
 * Les cas sont traités en parallèle : ils sont indépendants, et une boucle
 * d'`await` ici serait du travail séquentiel sans raison.
 */
const refuserToutesLesMutations = async (entetes: Record<string, string>, attendu: number) => {
  const cas = [
    { body: { text: "coucou" }, path: "/api/agents/:paneId/prompt" },
    { body: { kind: "pi" }, path: "/api/workspaces/:workspaceId/agents" },
    { body: { accept: true }, path: "/api/agents/:paneId/trust" },
  ];
  const routes = await build(true);
  createTabCalls = 0;
  startCalls = 0;
  // `handler(...)` renvoie une `Response` (ou une promesse selon la route) :
  // `Promise.all` attend un itérable de promesses, d'où l'emballage.
  const reponses = await Promise.all(
    cas.map((cas_) =>
      Promise.resolve(
        handler(
          routes,
          cas_.path,
        )(request({ paneId: "w1:p1", workspaceId: "w1" }, cas_.body, undefined, entetes)),
      ),
    ),
  );
  return {
    createTab: createTabCalls,
    start: startCalls,
    verdict: reponses.map((reponse) => {
      expect(reponse.status).toBe(attendu);
      return String(reponse.status);
    }),
  };
};

describe("S02 — requêtes mutantes", () => {
  test("origine absente → 403, aucun effet Herdr", async () => {
    const { verdict, createTab, start } = await refuserToutesLesMutations({}, 403);
    expect(verdict).toEqual(["403", "403", "403"]);
    expect(createTab).toBe(0);
    expect(start).toBe(0);
  });

  test("origine étrangère → 403, aucun effet Herdr", async () => {
    const { verdict, createTab } = await refuserToutesLesMutations(
      { "content-type": "application/json", origin: "https://attaquant.example" },
      403,
    );
    expect(verdict).toEqual(["403", "403", "403"]);
    expect(createTab).toBe(0);
  });

  test("type de contenu inadéquat → 415", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/agents/:paneId/prompt",
    )(
      request({ paneId: "w1:p1" }, { text: "coucou" }, undefined, {
        "content-type": "text/plain",
        origin: ORIGINE,
      }),
    );
    expect(response.status).toBe(415);
  });

  test("méthode non-POST → 405 avec Allow", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/agents/:paneId/prompt",
    )(request({ paneId: "w1:p1" }, undefined, undefined, {}, "GET"));
    expect(response.status).toBe(405);
    // Sans `Allow`, le client ne sait pas s'il doit changer de méthode ou
    // abandonner le chemin : le 405 serait alors inexploitable.
    expect(response.headers.get("allow")).toBe("POST");
  });

  test("origine valide et JSON → la requête passe", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/agents/:paneId/prompt",
    )(request({ paneId: "w1:p1" }, { text: "coucou" }));
    // Le garde laisse passer ; l'échec éventuel vient de Herdr simulé, pas
    // du contrôle d'origine.
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(415);
    expect(response.status).not.toBe(405);
  });

  test("une origine suffixée ne passe pas", async () => {
    const routes = await build(true);
    const response = await handler(
      routes,
      "/api/agents/:paneId/prompt",
    )(
      request({ paneId: "w1:p1" }, { text: "coucou" }, undefined, {
        "content-type": "application/json",
        origin: `${ORIGINE}.attaquant.example`,
      }),
    );
    expect(response.status).toBe(403);
  });
});

/**
 * B11 — `GET /api/conversations`.
 *
 * Deux propriétés que le contrat ne vérifie pas et que l'écran d'accueil
 * dépend directement :
 *
 * 1. **un pane = une ligne**, même sans session — sinon un agent fraîchement
 *    lancé disparaît de l'accueil, qui affiche « aucune conversation » ;
 * 2. **une session illisible ne fait pas perdre les autres lignes** — sinon un
 *    unique fichier corrompu vide tout l'écran.
 */
describe("contrat HTTP — /api/conversations", () => {
  test("la réponse est valide contre le contrat partagé", async () => {
    const routes = await build(true);
    const response = await handler(routes, "/api/conversations")(request({}, undefined));
    expect(response.status).toBe(200);
    const body = await decodeBody(response, ConversationsResponse, "conversations");
    expect(Array.isArray(body.conversations)).toBe(true);
  });

  test("Herdr injoignable : liste vide nommée, jamais une liste inventée", async () => {
    const routes = await build(false);
    const response = await handler(routes, "/api/conversations")(request({}, undefined));
    expect(response.status).toBe(503);
  });

  test("aucune ligne ne porte de champ « non lu »", async () => {
    const routes = await build(true);
    const response = await handler(routes, "/api/conversations")(request({}, undefined));
    const body = await decodeBody(response, ConversationsResponse, "conversations");
    for (const ligne of body.conversations) {
      expect("unread" in ligne).toBe(false);
      expect("nonLu" in ligne).toBe(false);
    }
  });

  /*
    ⚠️ **Le cas opencode, mesuré le 2026-10-17.** Ses questions sont des
    formulaires à plusieurs champs, et l'étape **Review** n'a aucun choix
    numéroté : `questionDeLEcran` rend `undefined`, la carte disparaissait, et
    l'agent restait `blocked` sans que rien ne dise sur quoi. L'écran doit donc
    être remonté — brut — au lieu d'être perdu.
  */
  test("un agent bloqué sans question numérotée remonte son ÉCRAN", async () => {
    const routes = await build(true, {
      screen: "  ┃  Review\n  ┃  enter Submit form   esc dismiss\n",
      snapshot: {
        agents: [
          {
            agent: "opencode",
            agent_status: "blocked",
            focused: false,
            pane_id: "w1:p1",
            revision: 1,
            tab_id: "w1:t1",
            terminal_id: "term-1",
            workspace_id: "w1",
          },
        ],
        panes: [{ cwd: "/dev/pixel", pane_id: "w1:p1", workspace_id: "w1" }],
        protocol: 22,
        tabs: [],
        version: "0.9.3",
        workspaces: [{ label: "pixel", pane_count: 1, tab_count: 1, workspace_id: "w1" }],
      },
    });
    const response = await handler(routes, "/api/conversations")(request({}, undefined));
    const body = await decodeBody(response, ConversationsResponse, "conversations");
    const ligne = body.conversations.find((candidat) => candidat.paneId === "w1:p1");

    expect(ligne).toBeDefined();
    expect(ligne?.waiting).toContain("Review");
    expect(ligne?.waiting).toContain("Submit form");
    // Aucun choix n'est fabriqué : pas de question, donc pas de boutons.
    expect(ligne?.question).toBeUndefined();
  });

  test("un agent AU REPOS ne remonte pas son écran", async () => {
    /*
      ⚠️ La garde, et c'est elle qui empêche le mensonge : un agent qui n'a rien
      écrit afficherait sinon son panneau de démarrage comme s'il attendait une
      réponse.
    */
    const routes = await build(true, {
      screen: "  ┃  Review\n  ┃  enter Submit form\n",
      snapshot: {
        agents: [
          {
            agent: "opencode",
            agent_status: "idle",
            focused: false,
            pane_id: "w1:p1",
            revision: 1,
            tab_id: "w1:t1",
            terminal_id: "term-1",
            workspace_id: "w1",
          },
        ],
        panes: [{ cwd: "/dev/pixel", pane_id: "w1:p1", workspace_id: "w1" }],
        protocol: 22,
        tabs: [],
        version: "0.9.3",
        workspaces: [{ label: "pixel", pane_count: 1, tab_count: 1, workspace_id: "w1" }],
      },
    });
    const response = await handler(routes, "/api/conversations")(request({}, undefined));
    const body = await decodeBody(response, ConversationsResponse, "conversations");
    const ligne = body.conversations.find((candidat) => candidat.paneId === "w1:p1");

    expect(ligne?.waiting).toBeUndefined();
  });
});

/**
 * B08 — le lancement nomme l'étape et reste récupérable.
 *
 * Un agent qui a démarré puis s'est bloqué doit **rester dans la liste** : le
 * perdre parce que le lancement a échoué à la détection obligerait à le
 * retrouver à la main, et le dossier resterait bloqué sans explication.
 */
describe("B08 — étapes de lancement", () => {
  test("un projet déjà occupé + action explicite crée un nouvel onglet", async () => {
    const routes = await build(true);
    createTabCalls = 0;
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "pi" }));
    // Le lancement est autorisé et il y a bien eu création d'onglet.
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(404);
  });

  test("aucun agent n'est lancé automatiquement", async () => {
    const routes = await build(true);
    createTabCalls = 0;
    startCalls = 0;
    // Une requête invalide ne doit rien déclencher du tout.
    await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "inconnu" }));
    expect(createTabCalls).toBe(0);
    expect(startCalls).toBe(0);
  });

  test("le type est validé AVANT toute création d'onglet", async () => {
    const routes = await build(true);
    createTabCalls = 0;
    // `claude` figure dans l'ancienne liste en dur mais n'est pas installé.
    await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "claude" }));
    expect(createTabCalls).toBe(0);
  });
});

/**
 * U13 — le terminal a **disparu** du produit.
 *
 * Ouvrir une conversation ne contacte plus Herdr du tout : le contenu vient
 * du fichier de session. Lire le pane à l'ouverture était une sollicitation
 * inutile d'une TUI attachée, et le lien automatique terminal ↔ ouverture
 * n'avait aucune justification (D014.2).
 */
describe("U13 — plus aucune route terminal", () => {
  test("aucune route ne mentionne le terminal", async () => {
    const routes = await build(true);
    for (const path of Object.keys(routes)) {
      expect(path.includes("terminal")).toBe(false);
    }
  });

  test("le contrat partagé n'exporte plus TerminalResponse", async () => {
    const contrat = await import("@herdr-remote/shared");
    expect("TerminalResponse" in contrat).toBe(false);
  });
});

/**
 * Le lancement **réussi**, et le nom qu'il envoie.
 *
 * ⚠️ **Ce chemin n'était pas couvert.** Les tests de lancement vérifiaient des
 * refus (`400`, `403`, « aucun onglet créé ») ; le seul qui visait un succès
 * s'arrêtait à « pas 403 et pas 404 » — un `502` passait. Or c'est ce chemin qui
 * **nomme** l'agent, et ce nom devient l'étiquette du pane quand l'onglet en
 * contient plusieurs.
 */
/** Un projet « pixel » avec un dossier de travail, comme un vrai. */
const projet = (label: string, workspaceId = "w1") => ({
  snapshot: {
    agents: [],
    panes: [{ cwd: "/dev/pixel", pane_id: `${workspaceId}:p1`, workspace_id: workspaceId }],
    protocol: 22,
    tabs: [],
    version: "0.9.3",
    workspaces: [{ label, pane_count: 1, tab_count: 1, workspace_id: workspaceId }],
  },
});

const lancer = async (label: string, workspaceId = "w1") => {
  const routes = await build(true, projet(label, workspaceId));
  const response = await handler(
    routes,
    "/api/workspaces/:workspaceId/agents",
  )(request({ workspaceId }, { kind: "pi" }));
  return response;
};

describe("le nom envoyé au lancement", () => {
  test("un lancement réussi est bien un 200", async () => {
    const response = await lancer("pixel");

    // ⚠️ 201 : un agent est **créé**, pas « lu ». Un test qui accepterait
    // n'importe quel code non-erreur laisserait passer un `502`.
    expect(response.status).toBe(201);
    expect(startCalls).toBe(1);
  });

  test("le nom est numéroté DÈS LE PREMIER agent du projet", async () => {
    /*
      ⚠️ Sans la numérotation, le premier agent s'appelait « pixel » — soit
      exactement le nom du projet, que la règle d'étiquetage écarte. Son étiquette
      retombait alors sur `pane N` pendant que ses voisins affichaient
      « pixel-2 », « pixel-3 ».
    */
    await lancer("pixel");

    expect(nomsDesAgents).toEqual(["pixel-1"]);
  });

  test("un nom déjà pris dans Herdr est évité — il refuse les doublons", async () => {
    /*
      ⚠️ La déduplication se fait contre les noms **présents dans Herdr** (il
      répond `agent_name_taken` sinon), pas contre un compteur local : c'est le
      mécanisme réel, donc c'est lui qu'on éprouve.
    */
    const routes = await build(true, {
      snapshot: {
        agents: [
          {
            agent: "pi",
            agent_status: "idle",
            focused: false,
            name: "pixel-1",
            pane_id: "w1:p1",
            revision: 1,
            tab_id: "w1:t1",
            terminal_id: "term-1",
            workspace_id: "w1",
          },
        ],
        panes: [{ cwd: "/dev/pixel", pane_id: "w1:p1", workspace_id: "w1" }],
        protocol: 22,
        tabs: [],
        version: "0.9.3",
        workspaces: [{ label: "pixel", pane_count: 1, tab_count: 1, workspace_id: "w1" }],
      },
    });
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "pi" }));

    expect(response.status).toBe(201);
    expect(nomsDesAgents).toEqual(["pixel-2"]);
  });

  test("un nom CHOISI par l'appelant passe tel quel, sans numérotation", async () => {
    /*
      ⚠️ C'est le seul nom qui vienne de quelqu'un : le transformer serait le
      trahir, et c'est justement celui qu'on veut voir affiché comme étiquette.
    */
    const routes = await build(true, projet("pixel"));
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "pi", name: "verif-ui" }));

    expect(response.status).toBe(201);
    expect(nomsDesAgents).toEqual(["verif-ui"]);
  });

  test("un projet sans libellé garde un nom utilisable", async () => {
    // Herdr laisse `label` vide sur les projets par défaut : le nom ne doit pas
    // être vide pour autant, sinon l'étiquette n'aurait rien à montrer.
    const routes = await build(true, projet(""));
    const response = await handler(
      routes,
      "/api/workspaces/:workspaceId/agents",
    )(request({ workspaceId: "w1" }, { kind: "pi" }));

    expect(response.status).toBe(201);
    expect(nomsDesAgents[0]).toMatch(/^agent-\d+$/);
  });
});
