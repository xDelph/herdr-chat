/**
 * La vue d'accueil ne liste que ce qui se lit (U14).
 *
 * ⚠️ Le filtre vit dans `buildOverview`, pas dans l'interface. Le mettre côté
 * web aurait laissé passer tous les appels directs à `/api/overview` — et
 * `/api/conversations` construit sa liste de la même façon.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentInfo, SnapshotPane, TabInfo, WorkspaceInfo } from "@herdr-remote/shared";
import { buildOverview, composerOverview, repartirAgents, toAgentViews } from "./AgentRegistry.ts";

const agent = (surcharge: Partial<AgentInfo> & { pane_id: string }): AgentInfo => ({
  agent_status: "idle",
  focused: false,
  revision: 1,
  tab_id: "w1:t1",
  terminal_id: `term-${surcharge.pane_id}`,
  workspace_id: "w1",
  ...surcharge,
});

const workspace = (surcharge: Partial<WorkspaceInfo> = {}): WorkspaceInfo =>
  ({
    checkout_path: "/dev/p",
    focused: false,
    is_linked_worktree: false,
    pane_count: 1,
    tab_count: 1,
    workspace_id: "w1",
    ...surcharge,
  }) as WorkspaceInfo;

const instantane = (
  agents: ReadonlyArray<AgentInfo>,
  workspaces?: ReadonlyArray<WorkspaceInfo>,
) => ({
  agents,
  panes: [] as ReadonlyArray<SnapshotPane>,
  protocol: 22,
  tabs: [] as ReadonlyArray<TabInfo>,
  version: "0.9.3",
  workspaces: workspaces ?? [workspace()],
});

const lire = <A>(effet: Effect.Effect<A, unknown>): Promise<A> => Effect.runPromise(effet);

describe("U14 — un agent muet n'apparaît pas comme une conversation", () => {
  test("un agent avec un chemin de session est listé", async () => {
    const vue = await lire(
      buildOverview(
        instantane([
          agent({
            agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "/s/a.jsonl" },
            pane_id: "w1:p1",
          }),
        ]),
      ),
    );
    expect(vue.agents.map((a) => a.paneId)).toEqual(["w1:p1"]);
    expect(vue.withoutSession).toBe(0);
  });

  test("un agent sans chemin est retiré de la liste", async () => {
    // opencode : `kind: "id"` et une base SQLite. Herdr l'expose comme agent,
    // et la PWA ne peut rien en lire.
    const vue = await lire(
      buildOverview(
        instantane([
          agent({
            agent: "opencode",
            agent_session: {
              agent: "opencode",
              kind: "id",
              source: "herdr:opencode",
              value: "ses_1",
            },
            pane_id: "w1:p2",
          }),
        ]),
      ),
    );
    expect(vue.agents).toHaveLength(0);
  });

  test("un agent sans aucune session exposée est retiré aussi", async () => {
    // codex et cursor : Herdr n'expose **rien**, même après avoir travaillé.
    const vue = await lire(buildOverview(instantane([agent({ pane_id: "w1:p3" })])));
    expect(vue.agents).toHaveLength(0);
  });

  test("un chemin vide compte comme absent", async () => {
    const vue = await lire(
      buildOverview(
        instantane([
          agent({
            agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "" },
            pane_id: "w1:p4",
          }),
        ]),
      ),
    );
    expect(vue.agents).toHaveLength(0);
  });
});

describe("U14 — masquer n'est pas disparaître", () => {
  test("les agents retirés sont comptés", async () => {
    const vue = await lire(
      buildOverview(
        instantane([
          agent({
            agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "/s/a.jsonl" },
            pane_id: "w1:p1",
          }),
          agent({ agent: "opencode", pane_id: "w1:p2" }),
          agent({ agent: "devin", pane_id: "w1:p3" }),
        ]),
      ),
    );
    expect(vue.agents).toHaveLength(1);
    // ⚠️ Le compte reste. Cacher sans dire ferait croire que ces agents
    // n'existent pas, alors qu'ils tournent.
    expect(vue.withoutSession).toBe(2);
  });

  test("un projet ne renvoie que vers des agents visibles", async () => {
    // Sinon, toucher un projet ouvrirait un agent absent de la liste : l'écran
    // afficherait « agent introuvable » pour un agent qui existe.
    const vue = await lire(
      buildOverview(
        instantane(
          [agent({ agent: "opencode", pane_id: "w1:p2" })],
          [workspace({ agent_status: "working" })],
        ),
      ),
    );
    expect(vue.workspaces[0]?.agentPanes).toEqual([]);
  });

  test("un agent lisible reste rattaché à son projet", async () => {
    const vue = await lire(
      buildOverview(
        instantane([
          agent({
            agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "/s/a.jsonl" },
            pane_id: "w1:p1",
          }),
        ]),
      ),
    );
    expect(vue.workspaces[0]?.agentPanes).toEqual(["w1:p1"]);
  });

  test("un agent sans projet ne fait pas planter la construction", async () => {
    // Herdr peut exposer un agent avant que son projet n'apparaisse.
    const vue = await lire(buildOverview(instantane([agent({ pane_id: "wZ:p1" })], [])));
    expect(vue.workspaces).toEqual([]);
  });
});

describe("U14 — les deux chemins d'overview doivent dire la même chose", () => {
  /*
    ⚠️ C'est ici que le filtre avait été perdu.

    `/api/overview` a **deux** chemins : un rapide qui sert le cache du veilleur,
    et un lent qui relit le snapshot. Le filtre n'était appliqué qu'au lent —
    donc presque jamais. Les agents muets réapparaissaient toutes les 15
    secondes, et l'ouverture de l'un d'eux échouait après coup.

    Ces tests exécutent les deux chemins sur la **même** liste d'agents et exigent
    la même réponse : c'est la seule façon que la divergence ne revienne pas.
  */
  const melange = [
    agent({
      agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "/s/a.jsonl" },
      pane_id: "w1:p1",
    }),
    agent({
      agent: "opencode",
      agent_session: { agent: "opencode", kind: "id", source: "herdr:opencode", value: "ses_1" },
      pane_id: "w1:p2",
    }),
    agent({ agent: "devin", pane_id: "w1:p3" }),
  ];

  test("le chemin lent et le chemin rapide donnent la même liste", async () => {
    const tous = await lire(toAgentViews(melange));

    const lent = await lire(buildOverview(instantane(melange)));
    const rapide = composerOverview({
      herdrProtocol: 22,
      herdrVersion: "0.9.3",
      panes: [],
      tous,
      workspaces: [workspace()],
    });

    expect(lent.agents.map((a) => a.paneId)).toEqual(rapide.agents.map((a) => a.paneId));
    expect(lent.withoutSession).toBe(rapide.withoutSession);
  });

  test("les deux chemins retirent le même agent muet", async () => {
    const tous = await lire(toAgentViews(melange));
    const lent = await lire(buildOverview(instantane(melange)));
    const rapide = composerOverview({
      herdrProtocol: 22,
      herdrVersion: "0.9.3",
      panes: [],
      tous,
      workspaces: [workspace()],
    });
    for (const vue of [lent, rapide]) {
      const panes = vue.agents.map((a) => a.paneId);
      expect(panes).toEqual(["w1:p1"]);
      expect(vue.withoutSession).toBe(2);
    }
  });

  test("le chemin rapide ne renvoie pas les agents d'un projet vide", async () => {
    // Régression antérieure : `agentPanes` venait du cache, qui ne contient pas
    // les panes, donc chaque projet paraissait vide.
    const tous = await lire(toAgentViews(melange));
    const rapide = composerOverview({
      herdrProtocol: 22,
      herdrVersion: "0.9.3",
      panes: [],
      tous,
      workspaces: [workspace()],
    });
    expect(rapide.workspaces[0]?.agentPanes).toEqual(["w1:p1"]);
  });

  test("`repartirAgents` est le seul point de décision", async () => {
    // Une fonction, appelée par les deux chemins : il n'y a plus de « seconde
    // règle » qui puisse diverger en silence.
    //
    // Les agents viennent du convertisseur, pas d'objets faits main : une
    // demi-vue tapée à la lettre ne prouverait rien — c'est le champ
    // `sessionPath` réellement produit qu'on vérifie.
    const { agents, masquees } = repartirAgents(
      await lire(
        toAgentViews([
          agent({
            agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "/s/a.jsonl" },
            pane_id: "w1:p1",
          }),
          agent({ agent: "opencode", pane_id: "w1:p2" }),
          agent({
            agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "" },
            pane_id: "w1:p3",
          }),
        ]),
      ),
    );
    expect(agents.map((a) => a.paneId)).toEqual(["w1:p1"]);
    expect(masquees).toBe(2);
  });
});
