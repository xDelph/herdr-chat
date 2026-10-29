/**
 * L'état des actions ponctuelles, par pane et par sujet (revue 2026-10-17, P0).
 */
import { describe, expect, test } from "bun:test";
import { cleAction, creeActionsLocales } from "../src/actions-locales.ts";

describe("isolation par cible et par sujet", () => {
  test("la réponse de A ne s'affiche pas chez B", () => {
    const actions = creeActionsLocales();
    const a = cleAction("w1:p1", "reponse", "Appliquer la migration ?");
    const b = cleAction("w1:p2", "reponse", "Appliquer la migration ?");
    const jeton = actions.debute(a);
    if (jeton === null) throw new Error("jeton attendu");
    actions.termine(a, jeton, { phase: "fini", texte: "appliquée", ton: "ok" });
    expect(actions.lit(a)).toEqual({ phase: "fini", texte: "appliquée", ton: "ok" });
    expect(actions.lit(b)).toBeUndefined();
  });

  test("une nouvelle question du même agent est un autre sujet", () => {
    const actions = creeActionsLocales();
    const premiere = cleAction("w1:p1", "reponse", "Q1");
    const jeton = actions.debute(premiere);
    if (jeton === null) throw new Error("jeton attendu");
    actions.termine(premiere, jeton, { phase: "fini", texte: "ok", ton: "ok" });
    expect(actions.lit(cleAction("w1:p1", "reponse", "Q2"))).toBeUndefined();
  });
});

describe("résultats périmés", () => {
  test("un double appui ne lance pas deux actions", () => {
    const actions = creeActionsLocales();
    const cle = cleAction("w1:p1", "arret");
    expect(actions.debute(cle)).not.toBeNull();
    expect(actions.debute(cle)).toBeNull();
  });

  test("un résultat revenu après l'oubli de l'action est rejeté", () => {
    const actions = creeActionsLocales();
    const cle = cleAction("w1:p1", "confiance", "/p");
    const jeton = actions.debute(cle);
    if (jeton === null) throw new Error("jeton attendu");
    actions.oublie(cle);
    expect(actions.termine(cle, jeton, { phase: "fini", texte: "tard", ton: "ok" })).toBe(false);
    expect(actions.lit(cle)).toBeUndefined();
  });

  test("un résultat d'une tentative précédente ne remplace pas la suivante", () => {
    const actions = creeActionsLocales();
    const cle = cleAction("w1:p1", "focus");
    const premier = actions.debute(cle);
    if (premier === null) throw new Error("jeton attendu");
    actions.termine(cle, premier, { phase: "fini", texte: "échec", ton: "erreur" });
    const second = actions.debute(cle);
    if (second === null) throw new Error("jeton attendu");
    expect(actions.termine(cle, premier, { phase: "fini", texte: "périmé", ton: "ok" })).toBe(
      false,
    );
    expect(actions.lit(cle)).toEqual({ phase: "en-cours" });
  });
});
