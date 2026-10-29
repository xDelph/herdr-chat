/**
 * Les six états de lecture (U10).
 *
 * Le contrat du tableau dit deux choses qu'on peut exécuter :
 *
 * - « coupure conserve messages et brouillon » — tant qu'il reste des données
 *   affichées, aucune coupure ne peut produire un écran vide ;
 * - « `resync` recharge une fois » — voir `etats-rechargement.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { etatLecture, heureLue } from "../src/etats.ts";

const situation = (modification: Partial<Parameters<typeof etatLecture>[0]> = {}) =>
  etatLecture({
    chargement: false,
    erreur: null,
    live: true,
    total: 3,
    dernierSucces: 1_000,
    ...modification,
  });

describe("U10 — les six états, et un seul à la fois", () => {
  test("tout va bien : prêt", () => {
    expect(situation()).toEqual({ phase: "pret" });
  });

  test("première lecture, rien à afficher : chargement", () => {
    expect(situation({ chargement: true, total: 0, dernierSucces: null })).toEqual({
      phase: "chargement",
    });
  });

  test("lecture réussie, parc vide : vide — pas une erreur", () => {
    // ⚠️ L'absence d'agents est un état normal. La présenter en erreur ferait
    // chercher une panne qui n'existe pas.
    expect(situation({ total: 0 })).toEqual({ phase: "vide" });
  });

  test("jamais rien affiché, lecture échouée : erreur, avec sa cause", () => {
    expect(situation({ erreur: "injoignable", total: 0, dernierSucces: null })).toEqual({
      phase: "erreur",
      cause: "injoignable",
    });
  });

  test("données affichées, lecture échouée : hors ligne, pas écran vide", () => {
    // C'est la phrase du contrat : les messages et le brouillon restent.
    expect(situation({ erreur: "injoignable" })).toEqual({
      phase: "hors-ligne",
      dernierSucces: 1_000,
    });
  });

  test("données fraiches, flux coupé : reconnexion", () => {
    expect(situation({ live: false })).toEqual({ phase: "reconnexion" });
  });
});

describe("U10 — l'ordre de priorité", () => {
  test("erreur et écran vide : l'erreur l'emporte", () => {
    // Sinon l'utilisateur lit « aucun agent » et cherche du mauvais côté.
    expect(situation({ erreur: "boom", total: 0, chargement: true }).phase).toBe("erreur");
  });

  test("données affichées, coupure et flux mort : la coupure d'abord", () => {
    // Les deux disent « la connexion a un souci » ; la coupure est la cause
    // vérifiée, l'autre n'est qu'un indice.
    expect(situation({ erreur: "boom", live: false }).phase).toBe("hors-ligne");
  });

  test("rafraîchissement en cours sur un écran rempli : ce n'est pas un chargement", () => {
    // Sans cette règle, toute l'écran clignoterait toutes les 4 secondes.
    expect(situation({ chargement: true }).phase).toBe("pret");
  });

  test("écran vide, flux coupé : c'est bien vide", () => {
    // Le flux mort n'explique pas l'absence d'agents : Herdr peut être joignable
    // et n'avoir aucun agent.
    expect(situation({ total: 0, live: false }).phase).toBe("vide");
  });
});

describe("U10 — la fraîcheur se dit, ou ne se dit pas", () => {
  test("l'heure de la dernière lecture réussie", () => {
    // 2024-03-05T08:07:00 en heure locale du poste de test.
    const instant = new Date(2024, 2, 5, 8, 7, 0).getTime();
    expect(heureLue(instant)).toBe("08:07");
  });

  test("deux chiffres, toujours", () => {
    const instant = new Date(2024, 2, 5, 9, 5, 0).getTime();
    expect(heureLue(instant)).toBe("09:05");
  });

  test("sans horodatage, on ne prétend pas savoir", () => {
    // ⚠️ Pas de « à l'instant » par défaut : c'est l'information même que
    // l'utilisateur cherche, et la donner fausse est pire que de ne rien dire.
    expect(heureLue(null)).toBeNull();
  });

  test("un horodatage illisible ne donne pas une heure fausse", () => {
    expect(heureLue(Number.NaN)).toBeNull();
  });
});
