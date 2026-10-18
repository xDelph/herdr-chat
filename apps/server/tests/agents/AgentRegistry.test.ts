/**
 * La vue d'accueil ne liste que ce qui se lit (U14).
 *
 * ⚠️ Le filtre vit dans `buildOverview`, pas dans l'interface. Le mettre côté
 * web aurait laissé passer tous les appels directs à `/api/overview` — et
 * `/api/conversations` construit sa liste de la même façon.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dejaDit } from "@herdr-remote/shared";
import type {
  AgentInfo,
  PaneLayout,
  SnapshotPane,
  TabInfo,
  WorkspaceInfo,
} from "@herdr-remote/shared";
import {
  buildOverview,
  composerOverview,
  enrichAgent,
  estVisible,
  namingFrom,
  nomDeLancement,
  repartirAgents,
  toAgentViews,
} from "../../src/agents/AgentRegistry.ts";

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

const snapshot = (agents: ReadonlyArray<AgentInfo>, layouts: ReadonlyArray<PaneLayout>) => ({
  agents,
  layouts,
  panes: [] as ReadonlyArray<SnapshotPane>,
  protocol: 22,
  tabs: [] as ReadonlyArray<TabInfo>,
  version: "0.9.3",
  workspaces: [workspace()],
});

const lire = <A>(effet: Effect.Effect<A, unknown>): Promise<A> => Effect.runPromise(effet);

const layout = (
  tabId: string,
  panes: ReadonlyArray<readonly [string, number, number]>,
): PaneLayout => ({
  focused_pane_id: panes[0]?.[0] ?? "",
  panes: panes.map(([paneId, x, y]) => ({
    focused: false,
    pane_id: paneId,
    rect: { height: 20, width: 90, x, y },
  })),
  tab_id: tabId,
  workspace_id: "w1",
  zoomed: false,
});

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
    // cursor : `kind: "id"` et un identifiant opaque, sans magasin lisible.
    // ⚠️ opencode puis devin ont servi d'exemple ici : tous deux sont
    // desormais lisibles, donc ils ne peuvent plus illustrer un agent muet.
    const vue = await lire(
      buildOverview(
        instantane([
          agent({
            agent: "cursor",
            agent_session: {
              agent: "cursor",
              kind: "id",
              source: "herdr:cursor",
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
          agent({ agent: "cursor", pane_id: "w1:p2" }),
          agent({ agent: "cursor", pane_id: "w1:p3" }),
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
          [agent({ agent: "cursor", pane_id: "w1:p2" })],
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
      agent: "cursor",
      agent_session: { agent: "cursor", kind: "id", source: "herdr:cursor", value: "ses_1" },
      pane_id: "w1:p2",
    }),
    agent({ agent: "cursor", pane_id: "w1:p3" }),
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
          agent({ agent: "cursor", pane_id: "w1:p2" }),
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

/**
 * La visibilité d'un agent — **la règle a changé deux fois**, et les deux fois
 * la mesure l'a imposée.
 *
 * ⚠️ **Le cas qui a tout déclenché.** Un onglet réel à cinq panes, un agent par
 * pane : `pi`, `opencode`, `devin`, `codex`, `claude`. Trois d'entre eux
 * n'écrivent leur session qu'au **premier message**, donc la règle d'origine
 * (« une session lisible ») en a masqué trois — et l'un des trois était
 * **`blocked`**. Le veilleur lisant ces mêmes vues, il ne l'a jamais surveillé :
 * ni ligne, ni notification. Le seul agent qui attendait une réponse était
 * celui qu'on ne voyait pas.
 */
describe("U19 — un agent qui demande quelque chose reste visible", () => {
  test("un agent BLOQUÉ sans session lisible est visible", () => {
    /*
      ⚠️ Le cœur du correctif. Sans session, cet agent n'a rien à montrer — mais
      il attend une réponse, et c'est l'information la plus utile de toute
      l'application. Un état n'est pas du contenu : il se montre sans lui.
    */
    const muet = agent({ agent_status: "blocked", pane_id: "w1:p1" });

    expect(
      estVisible({ kind: "claude", sessionPath: null, status: "blocked", tabPaneCount: 1 }),
    ).toBe(true);
    expect(
      repartirAgents([
        {
          agent: "claude",
          cwd: null,
          focused: false,
          name: null,
          paneId: muet.pane_id,
          paneRank: null,
          parentSession: null,
          sessionCwd: null,
          sessionCwdMatches: null,
          sessionId: null,
          sessionKind: null,
          sessionPath: null,
          status: "blocked",
          tabId: "w1:t1",
          tabLabel: null,
          tabNumber: null,
          tabPaneCount: 1,
          title: null,
          workspaceId: "w1",
          workspaceLabel: null,
        },
      ]).agents,
    ).toHaveLength(1);
  });

  test("un agent au travail sans session aussi", () => {
    expect(estVisible({ kind: "pi", sessionPath: null, status: "working", tabPaneCount: 1 })).toBe(
      true,
    );
  });

  test("un agent au repos, sans session, de type INCONNU, seul : masqué", () => {
    // Un pane sans agent reconnu n'a rien à dire, et l'afficher remplirait la
    // liste au démarrage. Le `null` ici n'est pas un détail : c'est ce qui
    // distingue ce cas du suivant.
    expect(estVisible({ kind: null, sessionPath: null, status: "idle", tabPaneCount: 1 })).toBe(
      false,
    );
    expect(estVisible({ kind: null, sessionPath: null, status: "done", tabPaneCount: 1 })).toBe(
      false,
    );
  });

  /*
    ⚠️ **La régression du 2026-10-17, et le seul cas où ce test pouvait échouer.**
    `wB:p1B`, un agent codex du workspace `herdr-pwa` qui avait réellement
    travaillé : sa session est sur le disque, mais Herdr ne la publiait plus
    (`pane.report_agent_session` en erreur). Sans session exposée, `done`, seul
    dans son onglet, il **disparaissait de la liste** — l'utilisateur ne voyait
    plus l'agent. On ne conclut plus « pas de session » = « rien à dire » pour une
    famille dont on sait lire la session : on refuse de faire disparaître
    l'agent. Aucun contenu n'est inventé pour autant — son panneau reste neutre.
  */
  test("un agent codex sans session exposée ne DISPARAÎT pas", () => {
    expect(estVisible({ kind: "codex", sessionPath: null, status: "done", tabPaneCount: 1 })).toBe(
      true,
    );
    expect(estVisible({ kind: "codex", sessionPath: null, status: "idle", tabPaneCount: 1 })).toBe(
      true,
    );
  });

  test("dans un onglet à plusieurs panes, même au repos il est visible", () => {
    /*
      ⚠️ Un onglet découpé est une **unité de travail** : ses panes se regardent
      ensemble. Masquer les vérificateurs au repos cacherait la moitié du tab, et
      l'utilisateur ne saurait même pas qu'ils existent.
    */
    expect(estVisible({ kind: null, sessionPath: null, status: "idle", tabPaneCount: 5 })).toBe(
      true,
    );
  });

  test("une session lisible reste visible, quel que soit l'état", () => {
    expect(
      estVisible({ kind: null, sessionPath: "/s/a.jsonl", status: "done", tabPaneCount: 1 }),
    ).toBe(true);
  });

  test("le rang vient de la DISPOSITION, pas de l'ordre des agents", async () => {
    /*
      ⚠️ Les agents arrivent dans l'ordre d'Herdr, les rectangles disent la
      vérité. Le tab est celui du vrai cas : disposé `p1 p2 / p4 p3 / p5`.
    */
    const vues = await lire(
      toAgentViews(
        ["w1:p1", "w1:p2", "w1:p3", "w1:p4", "w1:p5"].map((pane_id) => agent({ pane_id })),
        namingFrom(
          [workspace()],
          [],
          [
            layout("w1:t1", [
              ["w1:p1", 0, 0],
              ["w1:p4", 0, 41],
              ["w1:p5", 0, 62],
              ["w1:p2", 95, 0],
              ["w1:p3", 95, 41],
            ]),
          ],
        ),
      ),
    );

    expect(vues.map((vue) => [vue.paneId, vue.paneRank])).toEqual([
      ["w1:p1", 1],
      ["w1:p2", 2],
      ["w1:p3", 4],
      ["w1:p4", 3],
      ["w1:p5", 5],
    ]);
    expect(vues.every((vue) => vue.tabPaneCount === 5)).toBe(true);
  });

  test("sans disposition lue, le rang est ABSENT — jamais devine", () => {
    // ⚠️ On ne retombe pas sur l'ordre des agents : ce serait une fausse
    // exactitude, et l'etiquette dirait « pane 3 » sur le mauvais pane.
    const vue = Effect.runSync(enrichAgent(agent({ pane_id: "w1:p1" })));

    expect(vue.paneRank).toBeNull();
    expect(vue.tabPaneCount).toBe(1);
  });

  test("le nom de l'agent est repris tel quel", () => {
    const vue = Effect.runSync(enrichAgent(agent({ name: "multipane-pi", pane_id: "w1:p1" })));

    expect(vue.name).toBe("multipane-pi");
  });

  test("un agent sans nom expose `null`, pas une chaine vide", () => {
    expect(Effect.runSync(enrichAgent(agent({ pane_id: "w1:p1" }))).name).toBeNull();
  });

  test("les deux chemins d'overview voient le même agent bloqué", async () => {
    // Le cache du veilleur et le snapshot relu : même règle, donc même réponse.
    // ⚠️ Le même instantané passe par les **deux** chemins : celui qui relit le
    // snapshot, et celui qui compose depuis les vues déjà construites.
    const bloques = [agent({ agent_status: "blocked", pane_id: "w1:p1" })];
    const enveloppe = snapshot(bloques, []);
    const direct = await lire(buildOverview(enveloppe));
    const parVues = composerOverview({
      herdrProtocol: 22,
      herdrVersion: "0.9.3",
      panes: enveloppe.panes,
      tous: await lire(toAgentViews(enveloppe.agents)),
      workspaces: enveloppe.workspaces,
    });

    expect(direct.agents.map((vue) => vue.paneId)).toEqual(["w1:p1"]);
    expect(parVues.agents.map((vue) => vue.paneId)).toEqual(["w1:p1"]);
  });
});

/**
 * Le nom donné à un agent qu'on lance.
 *
 * ⚠️ **Ce nom n'est pas décoratif : c'est l'étiquette qui distingue les panes
 * d'un même onglet.** La règle d'étiquetage écarte un nom qui ne dit rien de plus
 * que la ligne du dessus — donc nommer le premier agent d'un projet « pixel »
 * faisait retomber son étiquette sur `pane N` pendant que ses voisins
 * affichaient « pixel-2 », « pixel-3 ».
 */
describe("U19 — le nom de lancement s'accorde avec l'étiquetage", () => {
  test("le premier agent d'un projet est déjà numéroté", () => {
    expect(nomDeLancement("pixel", new Set())).toBe("pixel-1");
  });

  test("il ne répète JAMAIS le nom du projet", () => {
    /*
      ⚠️ C'est la propriété qui compte, et elle se vérifie contre la **règle
      d'étiquetage** elle-même, pas contre une chaîne écrite à la main : un nom
      que `dejaDit` écarte ne serait jamais affiché, et le défaut d'origine
      reviendrait sans qu'aucun test ne le voie.
    */
    const nom = nomDeLancement("pixel", new Set());

    expect(nom).not.toBe("pixel");
    expect(dejaDit("pixel", nom)).toBe(false);
  });

  test("les suivants s'incrémentent : deux agents d'un projet se distinguent", () => {
    const premier = nomDeLancement("pixel", new Set());
    const second = nomDeLancement("pixel", new Set([premier]));
    const troisieme = nomDeLancement("pixel", new Set([premier, second]));

    expect([premier, second, troisieme]).toEqual(["pixel-1", "pixel-2", "pixel-3"]);
  });

  test("un nom déjà pris ailleurs est sauté, pas réutilisé", () => {
    // Herdr refuse un doublon : réutiliser un nom ferait échouer le lancement.
    expect(nomDeLancement("pixel", new Set(["pixel-1", "pixel-2"]))).toBe("pixel-3");
  });

  test("la base est reprise telle quelle, seul le suffixe est ajouté", () => {
    // ⚠️ `nomDeLancement` ne juge pas la base : il la reçoit. C'est la **route**
    // qui décide quoi mettre dedans (le libellé du projet, ou le nom choisi par
    // l'appelant), et le test de bout en bout le vérifie là-bas.
    expect(nomDeLancement("verif-ui", new Set())).toBe("verif-ui-1");
  });

  test("cent noms pris rendent quand même un nom, jamais une chaîne vide", () => {
    const tous = new Set(Array.from({ length: 120 }, (_, i) => `pixel-${String(i + 1)}`));
    const nom = nomDeLancement("pixel", tous);

    expect(nom.length).toBeGreaterThan(0);
  });
});
