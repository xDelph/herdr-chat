/**
 * P3 — le manifeste (icône maskable à part, identifiant, fond sombre) et
 * l'en-tête (plus de faux `role="menu"`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnTete } from "../src/chat/EnTete.tsx";

const racine = join(import.meta.dir, "..");
const manifeste: unknown = JSON.parse(
  readFileSync(join(racine, "public/manifest.webmanifest"), "utf8"),
);

const icones = (): ReadonlyArray<{ src: string; purpose: string }> => {
  const liste: unknown =
    typeof manifeste === "object" && manifeste !== null ? Reflect.get(manifeste, "icons") : [];
  return Array.isArray(liste)
    ? liste.map((icone: unknown) => ({
        purpose: String(Reflect.get(Object(icone), "purpose")),
        src: String(Reflect.get(Object(icone), "src")),
      }))
    : [];
};

describe("manifeste", () => {
  test("l'icône maskable est un fichier à part (zone sûre), jamais l'icône pleine", () => {
    const maskables = icones().filter((icone) => icone.purpose === "maskable");
    const pleines = icones().filter((icone) => icone.purpose === "any");
    expect(maskables.length).toBeGreaterThan(0);
    for (const icone of maskables) {
      expect(pleines.some((pleine) => pleine.src === icone.src)).toBe(false);
      expect(() => readFileSync(join(racine, "public", icone.src))).not.toThrow();
    }
  });

  test("un identifiant stable, l'adresse de départ gardée, un fond pour le mode sombre", () => {
    expect(Reflect.get(Object(manifeste), "id")).toBe("/");
    expect(Reflect.get(Object(manifeste), "start_url")).toBe("/");
    expect(Reflect.get(Object(manifeste), "scope")).toBe("/");
    const sombre: unknown = Reflect.get(
      Object(Reflect.get(Object(manifeste), "user_preferences")),
      "color_scheme_dark",
    );
    expect(Reflect.get(Object(sombre), "background_color")).toBe("#0c0e12");
  });
});

describe("en-tête", () => {
  test("le menu est une liste de boutons : pas de `role=menu` sans navigation aux flèches", () => {
    const html = renderToStaticMarkup(
      createElement(EnTete, {
        compteFichiers: () => 3,
        kind: "pi",
        modele: undefined,
        onFichiers: () => undefined,
        onMac: () => undefined,
        onModele: () => undefined,
        onRetour: () => undefined,
        projet: "herdr",
        reflexion: undefined,
        status: "idle",
        titre: "titre",
        transport: "flux",
      }),
    );
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain("aria-haspopup");
    expect(html).toContain('aria-expanded="false"');
  });
});
