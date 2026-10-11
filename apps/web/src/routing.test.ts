/**
 * Tests du routage.
 *
 * Le cas central : **un agent doit survivre au rafraîchissement**. C'est le
 * retour utilisateur qui a motivé ce module — rafraîchir sur un agent ramenait
 * à l'accueil.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_TAB, parseRoute, routeToHash, TAB_LABEL } from "./routing.ts";

describe("parseRoute", () => {
  test("un agent est lu depuis le fragment — survit au rafraîchissement", () => {
    const route = parseRoute("#/agent/wB:p1");
    expect(route.kind).toBe("agent");
    if (route.kind === "agent") expect(route.paneId).toBe("wB:p1");
  });

  test("les identifiants de pane avec deux-points sont préservés", () => {
    const route = parseRoute("#/agent/w12:p3");
    if (route.kind === "agent") expect(route.paneId).toBe("w12:p3");
  });

  test("un identifiant encodé est décodé", () => {
    const route = parseRoute("#/agent/w1%3Ap1");
    if (route.kind === "agent") expect(route.paneId).toBe("w1:p1");
  });

  test("les trois destinations sont reconnues (U04)", () => {
    for (const tab of ["conversations", "projets", "reglages"] as const) {
      const route = parseRoute(`#/${tab}`);
      expect(route.kind).toBe("tab");
      if (route.kind === "tab") expect(route.tab).toBe(tab);
    }
  });

  /**
   * Les anciens onglets doivent retomber sur Conversations, **pas** produire
   * un écran vide : une URL enregistrée sur l'ancien déploiement reste
   * cliquable.
   */
  test("un ancien onglet retombe sur Conversations", () => {
    for (const ancien of ["a-traiter", "agents"]) {
      const route = parseRoute(`#/${ancien}`);
      expect(route.kind).toBe("tab");
      if (route.kind === "tab") expect(route.tab).toBe(DEFAULT_TAB);
    }
  });

  test("Conversations est l'onglet par défaut", () => {
    expect(DEFAULT_TAB).toBe("conversations");
    for (const vide of ["", "#", "#/", "#/nimporte-quoi"]) {
      const route = parseRoute(vide);
      if (route.kind === "tab") expect(route.tab).toBe("conversations");
    }
  });

  test("chaque destination a son libellé exact", () => {
    expect(TAB_LABEL["conversations"]).toBe("Conversations");
    expect(TAB_LABEL["projets"]).toBe("Projets");
    expect(TAB_LABEL["reglages"]).toBe("Réglages");
  });

  test("fragment vide → onglet par défaut", () => {
    const route = parseRoute("");
    if (route.kind === "tab") expect(route.tab).toBe(DEFAULT_TAB);
  });

  test("fragment inconnu → onglet par défaut, jamais un écran vide", () => {
    for (const hash of ["#/nimportequoi", "#/", "#", "#/agent/", "#/agents/w1:p1/x"]) {
      const route = parseRoute(hash);
      expect(route.kind === "tab" || route.kind === "agent").toBe(true);
      if (route.kind === "tab") expect(route.tab).toBe(DEFAULT_TAB);
    }
  });

  test("un encodage invalide ne fait pas planter l'analyse", () => {
    // `decodeURIComponent` lève sur un pourcentage malformé.
    expect(() => parseRoute("#/agent/%")).not.toThrow();
    const route = parseRoute("#/agent/%");
    if (route.kind === "tab") expect(route.tab).toBe(DEFAULT_TAB);
  });
});

describe("routeToHash", () => {
  test("aller-retour stable pour un onglet", () => {
    expect(routeToHash(parseRoute("#/projets"))).toBe("#/projets");
  });

  test("aller-retour stable pour un agent", () => {
    expect(routeToHash(parseRoute("#/agent/wB:p1"))).toBe("#/agent/wB%3Ap1");
  });

  test("le résultat se ré-analyse à l'identique", () => {
    const original = parseRoute("#/agent/wB:p1");
    const roundTripped = parseRoute(routeToHash(original));
    expect(roundTripped).toEqual(original);
  });
});

/**
 * U05 — le détail d'un projet a sa propre route.
 *
 * Il doit survivre à un rechargement : sans cela, ouvrir un projet puis
 * rafraîchir ramènerait à l'accueil, exactement le défaut que le routage par
 * fragment corrigeait pour les agents.
 */
describe("routage — détail de projet", () => {
  test("`#/projet/<id>` ouvre le détail", () => {
    const route = parseRoute("#/projet/w1");
    expect(route.kind).toBe("projet");
    if (route.kind === "projet") expect(route.workspaceId).toBe("w1");
  });

  test("aller-retour : la route produit exactement le même fragment", () => {
    const route = { kind: "projet", workspaceId: "w2:x/3" } as const;
    expect(routeToHash(route)).toBe("#/projet/w2%3Ax%2F3");
    expect(parseRoute(routeToHash(route))).toEqual(route);
  });

  test("`projet/` vide retombe sur l'onglet par défaut, sans casser", () => {
    const route = parseRoute("#/projet/");
    expect(route.kind).toBe("tab");
    if (route.kind === "tab") expect(route.tab).toBe(DEFAULT_TAB);
  });

  test("un pourcentage invalide ne fait pas tomber le rendu", () => {
    // `decodeURIComponent` lève : le fragment ne doit pas casser l'app.
    const route = parseRoute("#/projet/%");
    expect(route.kind).toBe("tab");
  });

  test("`projet/w1` n'est pas lu comme un onglet", () => {
    const route = parseRoute("#/projet/w1");
    expect(route.kind).not.toBe("tab");
  });
});
