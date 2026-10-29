/**
 * La parité avec l'ancienne app : tri par nom, rendu des marques, détail d'un
 * projet, réglages d'une ligne, nouvelle version.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationSummary } from "@herdr-remote/shared";
import type { EtatDonnees } from "../src/donnees.ts";
import { Boite } from "../src/inbox/Boite.tsx";
import { LigneAgent } from "../src/inbox/LigneAgent.tsx";
import {
  creeMagasinVersion,
  INTERVALLE_VERIFICATION_MS,
  scriptDEntree,
  versionChangee,
} from "../src/nouvelle-version.ts";
import { ordreEnregistre, styleMarqueEnregistre } from "../src/preferences.ts";

const conversation = (changement: Partial<ConversationSummary>): ConversationSummary => ({
  agent: "pi",
  name: null,
  paneId: "w1:p1",
  paneRank: null,
  sessionState: "available",
  status: "idle",
  tabId: "t",
  tabPaneCount: 1,
  title: "titre",
  workspaceId: "w1",
  ...changement,
});

const rendu = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element).replaceAll("&#x27;", "'");

describe("préférences retrouvées", () => {
  test("ordre : « récent » par défaut, « nom » si choisi, jamais d'exception", () => {
    expect(ordreEnregistre(null)).toBe("recent");
    expect(ordreEnregistre("nom")).toBe("nom");
    expect(ordreEnregistre("n'importe")).toBe("recent");
  });

  test("marques : couleurs d'origine par défaut", () => {
    expect(styleMarqueEnregistre(null)).toBe("standard");
    expect(styleMarqueEnregistre("theme")).toBe("theme");
    expect(styleMarqueEnregistre("blue")).toBe("standard");
  });
});

describe("une ligne montre branche · modèle · réflexion", () => {
  test("les trois, dans l'ordre, la réflexion en français", () => {
    const html = rendu(
      createElement(LigneAgent, {
        conversation: conversation({ branch: "main", model: "gpt-5", thinking: "high" }),
        courante: false,
        debutTravail: undefined,
        maintenant: 0,
        nonLue: false,
        projet: "herdr",
        titre: "titre",
      }),
    );
    expect(html).toContain("main · gpt-5 · high");
  });

  test("rien à dire : pas de ligne vide", () => {
    const html = rendu(
      createElement(LigneAgent, {
        conversation: conversation({}),
        courante: false,
        debutTravail: undefined,
        maintenant: 0,
        nonLue: false,
        projet: "herdr",
        titre: "titre",
      }),
    );
    expect(html).not.toContain("ligne__details");
  });
});

const espace = (workspaceId: string, label: string) => ({
  agentPanes: [],
  agentStatus: null,
  checkoutPath: `/x/${label}`,
  focused: false,
  label,
  paneCount: 1,
  tabCount: 1,
  workspaceId,
});

const donnees = (conversations: ReadonlyArray<ConversationSummary>): EtatDonnees => ({
  chargement: false,
  conversations,
  debutsTravail: new Map(),
  dernierSucces: 1,
  direct: "live",
  erreurKinds: null,
  erreurs: { conversations: null, health: null, overview: null },
  health: null,
  kinds: null,
  overview: {
    agents: [],
    herdrProtocol: 22,
    herdrVersion: "0.9.3",
    withoutSession: 0,
    workspaces: [espace("w1", "herdr"), espace("w2", "pixel")],
  },
});

const boite = (projet: string | null, ordre: "recent" | "nom" = "recent") =>
  rendu(
    createElement(Boite, {
      donnees: donnees([
        conversation({ paneId: "w1:p1", title: "zeta", workspaceId: "w1" }),
        conversation({ paneId: "w2:p1", title: "alpha", workspaceId: "w2" }),
      ]),
      groupement: "statut",
      lectures: new Map(),
      onGroupement: () => undefined,
      onLancer: () => undefined,
      onOrdre: () => undefined,
      onReessayer: () => undefined,
      onReglages: () => undefined,
      ordre,
      paneCourant: null,
      projet,
    }),
  );

describe("le détail d'un projet (`#/projet/<id>`)", () => {
  test("ses agents seulement, avec « Nouvel agent » et le retour", () => {
    const html = boite("w2");
    expect(html).toContain("New agent");
    expect(html).toContain("All agents");
    expect(html).toContain("alpha");
    expect(html).not.toContain("zeta");
  });

  test("un projet disparu le dit, et ne propose pas de lancer", () => {
    const html = boite("w9");
    expect(html).toContain("This project no longer exists in Herdr.");
  });

  test("la liste entière n'a pas d'en-tête de projet", () => {
    expect(boite(null)).not.toContain("New agent");
  });
});

describe("le tri de la liste est un choix, plus un « récent » figé", () => {
  test("le bouton dit l'ordre courant", () => {
    expect(boite(null, "nom")).toContain("By name");
    expect(boite(null, "recent")).toContain("Most recent");
  });
});

const page = (script: string) =>
  `<!doctype html><head><script type="module" crossorigin src="${script}"></script></head>`;

describe("nouvelle version", () => {
  test("le script d'entrée se lit dans le HTML servi", () => {
    expect(scriptDEntree(page("/assets/index-abc.js"))).toBe("/assets/index-abc.js");
    expect(scriptDEntree("<html></html>")).toBeNull();
  });

  test("seule une différence entre deux versions CONNUES compte", () => {
    expect(versionChangee("/a.js", "/b.js")).toBe(true);
    expect(versionChangee("/a.js", "/a.js")).toBe(false);
    expect(versionChangee(null, "/b.js")).toBe(false);
    expect(versionChangee("/a.js", null)).toBe(false);
  });

  test("une vérification par intervalle, et l'annonce une fois", async () => {
    let lectures = 0;
    let instant = 0;
    let servie = "/assets/index-abc.js";
    const magasin = creeMagasinVersion({
      actuelle: () => "/assets/index-abc.js",
      litServie: async () => {
        lectures += 1;
        return page(servie);
      },
      maintenant: () => instant,
      metAJourWorker: async () => undefined,
    });
    await magasin.verifie();
    await magasin.verifie();
    expect(lectures).toBe(1);
    expect(magasin.nouvelle()).toBe(false);
    servie = "/assets/index-def.js";
    instant = INTERVALLE_VERIFICATION_MS;
    await magasin.verifie();
    expect(magasin.nouvelle()).toBe(true);
  });

  test("hors ligne : rien n'est annoncé, rien ne lève", async () => {
    const magasin = creeMagasinVersion({
      actuelle: () => "/a.js",
      litServie: () => Promise.reject(new TypeError("Load failed")),
      maintenant: () => 0,
      metAJourWorker: () => Promise.reject(new Error("pas de worker")),
    });
    await magasin.verifie();
    expect(magasin.nouvelle()).toBe(false);
  });
});

const injoignable = (): string =>
  rendu(
    createElement(Boite, {
      donnees: {
        ...donnees([]),
        conversations: [],
        dernierSucces: null,
        erreurs: {
          conversations: "failed (503)",
          health: null,
          overview: "transport: No such file or directory (os error 2)",
        },
        health: {
          herdr: { reachable: false, socket: "/Users/x/.config/herdr/herdr.sock" },
          ok: false,
          uptimeMs: 1_000,
        },
        overview: null,
      },
      groupement: "statut",
      lectures: new Map(),
      onGroupement: () => undefined,
      onLancer: () => undefined,
      onOrdre: () => undefined,
      onReessayer: () => undefined,
      onReglages: () => undefined,
      ordre: "recent",
      paneCourant: null,
      projet: null,
    }),
  );

describe("Herdr injoignable : une seule explication, la vraie", () => {
  test("Herdr est nommé, avec sa cause et son socket — ni « Connecting » ni « Unreadable »", () => {
    const html = injoignable();
    expect(html).toContain("Can't reach Herdr on the Mac.");
    expect(html).toContain("No such file or directory");
    expect(html).toContain("/Users/x/.config/herdr/herdr.sock");
    expect(html).toContain("Herdr offline");
    expect(html).not.toContain("Connecting");
    expect(html).not.toContain("Unreadable");
  });

  test("zéro se dit au pluriel", () => {
    expect(injoignable()).toContain("0 agents");
  });
});
