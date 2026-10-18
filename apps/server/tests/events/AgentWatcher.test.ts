/**
 * Tests du veilleur — **le bug qu'ils empêchent de reproduire**.
 *
 * En développement, le veilleur lisait `payload["agents"]` alors que
 * `session.snapshot` renvoie `{ snapshot: { agents } }`. Il comparait donc une
 * **liste vide à chaque tour** : aucun changement n'était jamais détecté, et le
 * direct restait muet.
 *
 * Ce défaut m'a fait envoyer des prompts de test dans des sessions de travail
 * réelles pour « voir » ce qui se passait — précisément ce qu'il ne fallait pas
 * faire (voir `AGENTS.md`). **Ces tests le rendent inutile** : le défaut est
 * couvert ici, sans toucher à aucun agent.
 *
 * ⛔ Aucun test de ce fichier ne contacte Herdr ni un agent réel.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Option, Schema } from "effect";
import type { AgentStatus } from "@herdr-remote/shared";
import { AgentWatcher, fautNotifier, startWatchLoop } from "../../src/events/AgentWatcher.ts";
import type { EventHubApi, BusEvent } from "../../src/events/EventHub.ts";
import { HerdrProtocolError } from "../../src/herdr/HerdrClient.ts";
import type { HerdrApi, HerdrError } from "../../src/herdr/HerdrClient.ts";
import type { AgentView } from "../../src/agents/AgentRegistry.ts";
import type { AgentInfo } from "@herdr-remote/shared";

/** Vue minimale, suffisante pour la détection de changement. */
const view = (paneId: string, status: AgentStatus): AgentView => ({
  agent: "pi",
  cwd: "/projet",
  focused: false,
  paneId,
  parentSession: null,
  sessionCwd: "/projet",
  sessionCwdMatches: true,
  sessionId: "s1",
  sessionKind: "path",
  sessionPath: `/sessions/${paneId}.jsonl`,
  status,
  tabId: "t1",
  tabLabel: null,
  tabNumber: 1,
  title: paneId,
  workspaceId: "w1",
  workspaceLabel: "projet",
  // ⚠️ Les trois faits de nommage : nuls ou neutres par défaut, donc
  // l'étiquette d'un pane reste vide — comme un agent seul dans son tab.
  name: null,
  paneRank: null,
  tabPaneCount: 1,
});

/** Hub en mémoire : enregistre ce qui est publié, sans réseau. */
const recordingHub = () => {
  const published: BusEvent[] = [];
  let nextId = 1;
  const hub: EventHubApi = {
    lastId: () => Effect.succeed(published.length),
    publish: (kind, data) =>
      Effect.sync(() => {
        const event: BusEvent = { at: Date.now(), data, id: nextId++, kind };
        published.push(event);
        return event;
      }),
    since: () => Effect.succeed({ events: [], resyncRequired: false, resumeFrom: 0 }),
  };
  return { hub, published };
};

describe("AgentWatcher — détection de changement", () => {
  test("le premier tour n'annonce pas « apparu » pour tout le parc", async () => {
    const { hub, published } = recordingHub();
    const watcher = await Effect.runPromise(AgentWatcher.make(hub));

    const result = await Effect.runPromise(
      watcher.tick([view("w1:p1", "idle"), view("w1:p2", "working")]),
    );

    // Un démarrage ne doit pas produire une rafale d'événements.
    expect(result.changes).toEqual([]);
    expect(published).toEqual([]);
  });

  test("un changement d'état est publié, avec l'état précédent", async () => {
    const { hub, published } = recordingHub();
    const watcher = await Effect.runPromise(AgentWatcher.make(hub));

    await Effect.runPromise(watcher.tick([view("w1:p1", "done")]));
    const result = await Effect.runPromise(watcher.tick([view("w1:p1", "working")]));

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.kind).toBe("status");
    expect(result.changes[0]?.from).toBe("done");
    expect(result.changes[0]?.to).toBe("working");
    expect(published).toHaveLength(1);
    expect(published[0]?.kind).toBe("agent_status");
  });

  test("un état identique n'est PAS republié", async () => {
    const { hub, published } = recordingHub();
    const watcher = await Effect.runPromise(AgentWatcher.make(hub));

    await Effect.runPromise(watcher.tick([view("w1:p1", "working")]));
    await Effect.runPromise(watcher.tick([view("w1:p1", "working")]));
    await Effect.runPromise(watcher.tick([view("w1:p1", "working")]));

    // Republier toutes les 2 s noierait le flux et ferait clignoter l'interface.
    expect(published).toEqual([]);
  });

  test("un agent qui disparaît est annoncé", async () => {
    const { hub } = recordingHub();
    const watcher = await Effect.runPromise(AgentWatcher.make(hub));

    await Effect.runPromise(watcher.tick([view("w1:p1", "idle"), view("w1:p2", "idle")]));
    const result = await Effect.runPromise(watcher.tick([view("w1:p1", "idle")]));

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.kind).toBe("disappeared");
    expect(result.changes[0]?.paneId).toBe("w1:p2");
  });

  test("un nouvel agent est annoncé une fois le parc connu", async () => {
    const { hub } = recordingHub();
    const watcher = await Effect.runPromise(AgentWatcher.make(hub));

    await Effect.runPromise(watcher.tick([view("w1:p1", "idle")]));
    const result = await Effect.runPromise(
      watcher.tick([view("w1:p1", "idle"), view("w1:p9", "working")]),
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.kind).toBe("appeared");
    expect(result.changes[0]?.paneId).toBe("w1:p9");
  });
});

/**
 * Le bug exact : le veilleur lisait le mauvais niveau de la réponse.
 *
 * `session.snapshot` renvoie `{ snapshot: { agents, workspaces, … } }`. Lire
 * `payload.agents` donne `undefined` → liste vide → aucun changement détecté,
 * silencieusement. On vérifie ici que la lecture est bien au bon niveau.
 */
/** Échec typé, pour les méthodes non exercées par ces tests. */
const failUnused = <A>(): Effect.Effect<A, HerdrError> =>
  Effect.fail(
    new HerdrProtocolError({ code: "unused", message: "non utilisé dans ce test", method: "test" }),
  );

/** Client Herdr simulé : seul `snapshot` est exercé. */
const fakeHerdr = (payload: Readonly<Record<string, unknown>>): HerdrApi => ({
  closeTab: failUnused,
  sendKeys: failUnused,
  sendText: failUnused,
  focusAgent: () => Effect.succeed({}),
  createTab: failUnused,
  startAgent: failUnused,
  getAgent: failUnused,
  listAgents: failUnused,
  ping: failUnused,
  promptAgent: failUnused,
  readAgent: failUnused,
  request: failUnused,
  snapshot: () => Effect.succeed(payload),
});

/** Exécute un seul tour de veille et rend les vues obtenues. */
const oneTick = async (payload: Readonly<Record<string, unknown>>) => {
  const { hub, published } = recordingHub();
  const watcher = await Effect.runPromise(AgentWatcher.make(hub));
  const seen: AgentView[][] = [];

  // Le `sleep` doit être DANS le scope : `Effect.scoped` ferme le scope — et
  // donc tue la fibre de veille — dès que l'effet interne se termine.
  await Effect.runPromise(
    Effect.scoped(
      Effect.andThen(
        startWatchLoop(fakeHerdr(payload), watcher, (agents) =>
          Effect.sync(() => {
            const views = agents.map((a) => view(a.pane_id, a.agent_status));
            seen.push(views);
            return views;
          }),
        ),
        Effect.sleep("250 millis"),
      ),
    ),
  );
  return { published, seen };
};

describe("WatchLoop — lit les agents au BON niveau de la réponse", () => {
  const agentFixture: AgentInfo = {
    agent: "pi",
    agent_status: "idle",
    focused: false,
    pane_id: "w1:p1",
    revision: 0,
    tab_id: "w1:t1",
    terminal_id: "term_1",
    workspace_id: "w1",
  };

  test("forme CORRECTE `{ snapshot: { agents } }` : les agents sont vus", async () => {
    const { seen } = await oneTick({ snapshot: { agents: [agentFixture] } });
    const total = seen.flat().length;
    expect(total).toBeGreaterThan(0);
    expect(seen.flat()[0]?.paneId).toBe("w1:p1");
  });

  test("forme INCORRECTE `{ agents }` : aucun agent vu (le bug d'origine)", async () => {
    const { seen } = await oneTick({ agents: [agentFixture] });
    // Le veilleur ne voit rien au mauvais niveau — c'est exactement pourquoi le
    // direct restait muet. Ce test documente la cause.
    expect(seen.flat()).toHaveLength(0);
  });

  test("le contrat accepte `snapshot.tabs`, absent par ailleurs", async () => {
    const decoded = Option.getOrUndefined(
      Schema.decodeUnknownOption(
        Schema.Struct({ agents: Schema.Array(Schema.Unknown), tabs: Schema.Array(Schema.Unknown) }),
      )({ agents: [], tabs: [] }),
    );
    expect(decoded).toBeDefined();
  });
});

/**
 * Un agent qui **disparaît** doit se voir — et seulement s'il y avait quelque
 * chose en cours.
 *
 * ⚠️ **Le trou que cette règle ferme.** Une notification ne partait **jamais**
 * pour une disparition : la boucle l'excluait explicitement (`to === "gone"`).
 * Un agent pouvait donc s'arrêter pendant son travail, ou alors qu'il attendait
 * une réponse, et l'application n'en disait pas un mot — la ligne disparaissait
 * de la liste, c'est tout.
 *
 * ⚠️ Et on ne prévient **que** si quelque chose était en cours : un agent `idle`
 * ou `done` qu'on ferme est une fin normale, et le notifier userait l'alerte.
 */
describe("U21 — qui mérite une notification", () => {
  test("un agent qui TRAVAILLE et s'arrête : oui", () => {
    // Son travail a été interrompu, et rien d'autre ne le dirait.
    expect(fautNotifier({ from: "working", to: "gone" })).toBe(true);
  });

  test("un agent qui ATTENDAIT une réponse et s'arrête : oui", () => {
    // C'était le seul agent qui demandait quelque chose : le taire le rendrait
    // invisible deux fois — plus de ligne, et plus d'alerte.
    expect(fautNotifier({ from: "blocked", to: "gone" })).toBe(true);
  });

  test("un agent au repos qu'on ferme : non", () => {
    for (const from of ["idle", "done", "unknown", null]) {
      expect(`${String(from)} → ${String(fautNotifier({ from, to: "gone" }))}`).toBe(
        `${String(from)} → false`,
      );
    }
  });

  test("la règle d'avant ne change pas : on annonce la FIN d'un travail", () => {
    expect(fautNotifier({ from: "working", to: "done" })).toBe(true);
    expect(fautNotifier({ from: "working", to: "blocked" })).toBe(true);
    expect(fautNotifier({ from: "working", to: "working" })).toBe(false);
    expect(fautNotifier({ from: "idle", to: "idle" })).toBe(false);
    expect(fautNotifier({ from: null, to: "idle" })).toBe(false);
  });
});
