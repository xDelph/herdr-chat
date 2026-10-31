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

/** Largeur et hauteur d'un PNG — lues dans son en-tête IHDR. */
const dimensionsPng = (chemin: string): readonly [number, number] => {
  const octets = readFileSync(chemin);
  return [octets.readUInt32BE(16), octets.readUInt32BE(20)];
};

describe("écrans de démarrage iOS", () => {
  const html = readFileSync(join(racine, "index.html"), "utf8");
  const balises = [
    ...html.matchAll(
      /href="\/splash\/(splash-(?:clair|sombre)-\d+x\d+\.png)"\s+media="(?:\(prefers-color-scheme: dark\) and )?\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: (portrait|landscape)\)"/g,
    ),
  ];

  test("iPhone et iPad, sans quoi iOS lance la PWA sur un écran blanc", () => {
    expect(balises.length).toBeGreaterThanOrEqual(20);
  });

  test("chaque appareil a son écran clair et son écran sombre, le clair d'abord", () => {
    const clairs = balises.filter(([, fichier]) => fichier?.startsWith("splash-clair-"));
    const sombres = balises.filter(([, fichier]) => fichier?.startsWith("splash-sombre-"));
    expect(clairs.length).toBe(sombres.length);
    // Le sombre est conditionné, le clair non : un iOS qui ignorerait le thème
    // retombe sur le clair, jamais sur le blanc.
    for (const [complet] of sombres) expect(complet).toContain("prefers-color-scheme: dark");
    for (const [complet] of clairs) expect(complet).not.toContain("prefers-color-scheme");
    expect(html.indexOf("splash-clair-")).toBeLessThan(html.indexOf("splash-sombre-"));
  });

  test("l'écran de démarrage HTML montre la même icône, avant le JavaScript", () => {
    expect(html).toContain('<div class="demarrage"');
    expect(html).toContain('src="/icone-demarrage.png"');
    expect(dimensionsPng(join(racine, "public/icone-demarrage.png"))).toEqual([264, 264]);
  });

  test("chaque image existe, aux dimensions exactes que sa requête annonce", () => {
    for (const [, fichier, largeur, hauteur, ratio, orientation] of balises) {
      const [l, h] = dimensionsPng(join(racine, "public/splash", fichier ?? ""));
      const attendu = [Number(largeur) * Number(ratio), Number(hauteur) * Number(ratio)];
      expect([l, h]).toEqual(orientation === "landscape" ? attendu.toReversed() : attendu);
    }
  });
});
