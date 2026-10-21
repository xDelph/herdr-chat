/**
 * Routage par fragment — testé seul (U05, U17).
 *
 * ⚠️ La barre d'onglets a disparu en U17 : les trois destinations d'avant
 * retombent sur la liste. Ces tests gardent donc deux choses à la fois — les
 * routes réelles, et le fait qu'une adresse enregistrée d'avant ne casse pas.
 */
import { describe, expect, test } from "bun:test";
import { estAdresseDOnglet, HOME, parseRoute, routeToHash } from "../src/routing.ts";

describe("routage — les deux destinations réelles", () => {
  test("un agent se rouvre après rafraîchissement", () => {
    const route = parseRoute("#/agent/w1%3Ap1");
    expect(route).toEqual({ kind: "agent", paneId: "w1:p1" });
  });

  test("un project se rouvre aussi", () => {
    expect(parseRoute("#/projet/w1")).toEqual({
      kind: "projet",
      workspaceId: "w1",
    });
  });

  test("l'accueil est la liste", () => {
    expect(parseRoute("#/")).toEqual({ kind: "liste" });
    expect(parseRoute("")).toEqual({ kind: "liste" });
  });

  test("aller-retour : la route produit exactement le même fragment", () => {
    for (const route of [
      { kind: "liste" } as const,
      { kind: "agent", paneId: "w1:p1" } as const,
      { kind: "projet", workspaceId: "w2:x/3" } as const,
    ]) {
      expect(parseRoute(routeToHash(route))).toEqual(route);
    }
  });

  test("un identifiant qui contient `/` et `:` survit à l'aller-retour", () => {
    const route = { kind: "agent", paneId: "w2:x/3" } as const;
    expect(routeToHash(route)).toBe("#/agent/w2%3Ax%2F3");
  });

  test("l'accueil a une adresse stable", () => {
    expect(routeToHash({ kind: "liste" })).toBe(HOME);
  });
});

describe("routage — rien ne casse le rendu", () => {
  test("un agent sans identifiant retombe sur la liste", () => {
    expect(parseRoute("#/agent/")).toEqual({ kind: "liste" });
  });

  test("un pourcentage invalide ne lève pas", () => {
    // `decodeURIComponent` lève : une URL tapée à la main ne doit pas casser
    // toute l'application.
    expect(parseRoute("#/agent/%")).toEqual({ kind: "liste" });
    expect(parseRoute("#/projet/%")).toEqual({ kind: "liste" });
  });

  test("un fragment inconnu retombe sur la liste, jamais sur un écran vide", () => {
    expect(parseRoute("#/nimporte-quoi")).toEqual({ kind: "liste" });
  });

  test("`projet/w1` n'est pas lu comme un agent", () => {
    expect(parseRoute("#/projet/w1").kind).toBe("projet");
  });
});

describe("U17 — les adresses d'onglet d'avant sont encore reconnues", () => {
  test("elles retombent sur la liste au lieu d'un écran blanc", () => {
    // ⚠️ Un raccourci enregistré sur l'écran d'accueil d'un iPhone pointe une
    // adresse précise. Une adresse morte donnerait un écran vide, sans
    // explication.
    for (const ancienne of ["conversations", "projets", "reglages", "agents"]) {
      expect(parseRoute(`#/${ancienne}`)).toEqual({ kind: "liste" });
      expect(estAdresseDOnglet(`#/${ancienne}`)).toBe(true);
    }
  });

  test("une route réelle n'est pas prise pour une adresse d'onglet", () => {
    expect(estAdresseDOnglet("#/agent/w1%3Ap1")).toBe(false);
    expect(estAdresseDOnglet("#/projet/w1")).toBe(false);
  });
});
