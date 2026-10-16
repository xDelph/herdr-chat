/**
 * La barre des panes d'un même onglet — **rendue**, pas seulement relue.
 *
 * ⚠️ **Pourquoi ce test existe.** Un onglet découpé en plusieurs panes est un
 * cas d'usage réel (un agent principal, des vérificateurs) et, sur un téléphone,
 * la barre est le **seul** moyen de passer de l'un à l'autre : sans elle il faut
 * revenir à la liste et retrouver le voisin parmi tous les autres agents. Une
 * barre qui ne serait pas rendue ne servirait à rien, et un test qui lirait
 * seulement le source ne le verrait pas.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentView } from "@herdr-remote/shared";
import { TabPanes } from "./TabPanes.tsx";

const agent = (surcharge: Partial<AgentView> & { paneId: string }): AgentView =>
  ({
    agent: "pi",
    cwd: "/projet",
    focused: false,
    name: null,
    paneRank: null,
    parentSession: null,
    sessionCwd: "/projet",
    sessionCwdMatches: true,
    sessionId: "s1",
    sessionKind: "path",
    sessionPath: "/s/a.jsonl",
    status: "idle",
    tabId: "w1:t1",
    tabLabel: null,
    tabNumber: 1,
    tabPaneCount: 1,
    title: "π - projet",
    workspaceId: "w1",
    workspaceLabel: "projet",
    ...surcharge,
  }) satisfies AgentView;

const rendre = (agents: ReadonlyArray<AgentView>, courant: string): string =>
  renderToStaticMarkup(createElement(TabPanes, { agents, courant, onOpen: () => undefined }));

describe("TabPanes — la barre ne sert que s'il y a des voisins", () => {
  test("seul dans son onglet : RIEN n'est rendu", () => {
    // ⚠️ Le cas ordinaire : une barre à une pastille n'apprendrait rien et
    // prendrait 44 px sur chaque conversation.
    expect(rendre([agent({ paneId: "w1:p1" })], "w1:p1")).toBe("");
  });

  test("deux panes : deux boutons", () => {
    const html = rendre(
      [
        agent({ name: "verif-ui", paneId: "w1:p1", paneRank: 1, tabPaneCount: 2 }),
        agent({ name: "verif-db", paneId: "w1:p2", paneRank: 2, tabPaneCount: 2 }),
      ],
      "w1:p1",
    );

    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain("verif-ui");
    expect(html).toContain("verif-db");
  });

  test("le pane courant est marqué, et pas seulement coloré", () => {
    // ⚠️ `aria-current` : la couleur seule ne dirait rien à un lecteur d'écran.
    const html = rendre(
      [
        agent({ name: "a", paneId: "w1:p1", paneRank: 1, tabPaneCount: 2 }),
        agent({ name: "b", paneId: "w1:p2", paneRank: 2, tabPaneCount: 2 }),
      ],
      "w1:p2",
    );

    expect(html.match(/aria-current="true"/g)?.length).toBe(1);
    // ⚠️ On découpe sur les boutons plutôt que sur le `paneId` : en rendu
    // statique la clé React n'apparaît pas dans le balisage, et un test qui s'y
    // fierait passerait pour de mauvaises raisons.
    const boutons = html.split("</button>");
    expect(boutons[0]).not.toContain('aria-current="true"');
    expect(boutons[1]).toContain('aria-current="true"');
  });

  test("sans nom, la pastille montre le RANG — jamais un identifiant", () => {
    const html = rendre(
      [
        agent({ paneId: "w1:p1", paneRank: 1, tabPaneCount: 2 }),
        agent({ paneId: "w1:p2", paneRank: 2, tabPaneCount: 2 }),
      ],
      "w1:p1",
    );

    expect(html).toContain(">1<");
    // ⚠️ `w1:p2` ne doit apparaître nulle part dans le texte visible.
    expect(html).not.toContain(">w1:p2<");
  });

  test("l'état est porté par la classe du point", () => {
    const html = rendre(
      [
        agent({ paneId: "w1:p1", paneRank: 1, status: "blocked", tabPaneCount: 2 }),
        agent({ paneId: "w1:p2", paneRank: 2, status: "working", tabPaneCount: 2 }),
      ],
      "w1:p1",
    );

    expect(html).toContain("dot--blocked");
    expect(html).toContain("dot--working");
  });
});
