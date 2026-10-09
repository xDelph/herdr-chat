/**
 * Tests du routage.
 *
 * Le cas central : **un agent doit survivre au rafraîchissement**. C'est le
 * retour utilisateur qui a motivé ce module — rafraîchir sur un agent ramenait
 * à l'accueil.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_TAB, parseRoute, routeToHash } from "./routing.ts";

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

  test("les quatre onglets sont reconnus", () => {
    for (const tab of ["projets", "agents", "activite", "reglages"] as const) {
      const route = parseRoute(`#/${tab}`);
      expect(route.kind).toBe("tab");
      if (route.kind === "tab") expect(route.tab).toBe(tab);
    }
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
    expect(routeToHash(parseRoute("#/activite"))).toBe("#/activite");
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
