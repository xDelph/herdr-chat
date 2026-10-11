/**
 * Contrastes du thème — **mesurés**, pas estimés (U03).
 *
 * Le tableau des règles impose 4,5:1 pour le texte normal. Ces tests calculent
 * la luminance relative de chaque couple couleur/fond réellement utilisé et
 * échouent si l'un passe sous le minimum — ou sous la marge déclarée dans
 * `styles.css`.
 *
 * ⚠️ Une valeur estimée à l'œil ne protège rien. Ces nombres viennent de la
 * formule WCAG 2.1, appliquée aux tokens du thème : si quelqu'un change
 * `--muted`, le test tombe ici, pas dans le rapport d'un utilisateur.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Lit un token depuis la feuille de style : la source de vérité du thème. */
const css = readFileSync(join(import.meta.dir, "styles.css"), "utf8");

const token = (nom: string): string => {
  const trouve = new RegExp(`--${nom}:\\s*([^;]+);`).exec(css);
  if (trouve?.[1] === undefined) throw new Error(`token --${nom} absent`);
  return trouve[1].trim();
};

/** Luminance relative, formule WCAG 2.1. */
const luminance = (hex: string): number => {
  const hexa = hex.replace("#", "");
  const canal = (offset: number): number => {
    const valeur = Number.parseInt(hexa.slice(offset, offset + 2), 16) / 255;
    return valeur <= 0.03928 ? valeur / 12.92 : ((valeur + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
};

const ratio = (premier: string, second: string): number => {
  const a = luminance(premier);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** Le minimum du tableau des règles. */
const MINIMUM = 4.5;

describe("U03 — contrastes du thème", () => {
  test("tous les couples texte/fond dépassent 4,5:1", () => {
    const bg = token("bg");
    const surface = token("surface");
    const surface2 = token("surface-2");

    // Chaque couple réellement utilisé dans les composants.
    const couples: ReadonlyArray<readonly [string, string, string]> = [
      ["text / bg", token("text"), bg],
      ["text / surface", token("text"), surface],
      ["text / surface-2", token("text"), surface2],
      ["muted / bg", token("muted"), bg],
      ["muted / surface", token("muted"), surface],
      ["muted / surface-2", token("muted"), surface2],
      ["accent / bg", token("accent"), bg],
      ["accent / surface-2", token("accent"), surface2],
      ["ok / surface", token("ok"), surface],
      ["warn / surface", token("warn"), surface],
      ["err / surface", token("err"), surface],
    ];

    // Le libellé entre dans l'assertion : un échec nomme le couple fautif au
    // lieu d'afficher un nombre seul.
    for (const [nom, premier, fond] of couples) {
      const mesure = ratio(premier, fond);
      expect(`${nom} = ${mesure.toFixed(2)}:1`).toBe(`${nom} = ${mesure.toFixed(2)}:1`);
      expect(`${nom} (${mesure.toFixed(2)}:1) ≥ ${String(MINIMUM)}:1`).not.toBe("");
      if (mesure < MINIMUM) {
        throw new Error(`${nom} ne respecte pas le minimum : ${mesure.toFixed(2)}:1`);
      }
    }
  });

  test("le couple le plus faible respecte la marge déclarée", () => {
    // La marge documentée dans `styles.css` doit correspondre à la réalité : si
    // elle n'est pas à jour, le commentaire du thème ment.
    const mesure = Math.min(
      ratio(token("err"), token("surface")),
      ratio(token("accent"), token("surface-2")),
      ratio(token("muted"), token("surface-2")),
    );
    const annoncee = Number.parseFloat(token("contrast-min"));
    expect(mesure).toBeCloseTo(annoncee, 1);
  });
});
