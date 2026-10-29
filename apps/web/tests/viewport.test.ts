/** Le clavier iOS se déduit de la hauteur pleine mémorisée. */
import { describe, expect, test } from "bun:test";
import { creeSuiviViewport } from "../src/viewport.ts";

describe("suivi du viewport", () => {
  test("le clavier qui monte est vu, même si innerHeight rétrécit aussi", () => {
    const suivi = creeSuiviViewport();
    expect(suivi({ haut: 0, hauteur: 844, largeur: 390 }).clavier).toBe(false);
    const clavier = suivi({ haut: 120, hauteur: 508, largeur: 390 });
    expect(clavier.clavier).toBe(true);
    expect(clavier.haut).toBe(120);
    expect(suivi({ haut: 0, hauteur: 844, largeur: 390 }).clavier).toBe(false);
  });

  test("une barre d'outils qui bouge n'est pas un clavier", () => {
    const suivi = creeSuiviViewport();
    suivi({ haut: 0, hauteur: 844, largeur: 390 });
    expect(suivi({ haut: 0, hauteur: 780, largeur: 390 }).clavier).toBe(false);
  });

  test("une rotation remet la hauteur pleine à zéro", () => {
    const suivi = creeSuiviViewport();
    suivi({ haut: 0, hauteur: 844, largeur: 390 });
    expect(suivi({ haut: 0, hauteur: 390, largeur: 844 }).clavier).toBe(false);
  });
});
