/**
 * Contrastes des jetons — **mesurés** (WCAG 2.1), dans les deux palettes.
 *
 * ⚠️ Une valeur estimée à l'œil ne protège rien. Ces nombres viennent de la
 * formule, appliquée aux jetons réellement écrits dans `styles/tokens.css` : si
 * quelqu'un éclaircit `--ink-3`, le test tombe ici, pas dans le rapport d'un
 * utilisateur.
 *
 * ⚠️ Les deux palettes y passent : la sombre est lue dans son propre bloc
 * (`:root[data-theme="dark"]`), et le test vérifie que le bloc
 * `prefers-color-scheme` porte exactement les mêmes valeurs — deux copies de la
 * même palette divergent toujours, sauf si quelque chose les compare.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(
  join(import.meta.dir, "..", "src", "styles", "tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const blocApres = (selecteur: string): string => {
  const debut = css.indexOf(selecteur);
  if (debut < 0) throw new Error(`bloc absent : ${selecteur}`);
  const ouvrante = css.indexOf("{", debut);
  const fermante = css.indexOf("}", ouvrante);
  return css.slice(ouvrante + 1, fermante);
};

const lireJetons = (bloc: string): Map<string, string> => {
  const jetons = new Map<string, string>();
  for (const trouve of bloc.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    if (trouve[1] !== undefined && trouve[2] !== undefined) jetons.set(trouve[1], trouve[2].trim());
  }
  return jetons;
};

const clair = lireJetons(blocApres(":root {"));
const sombre = new Map([...clair, ...lireJetons(blocApres(':root[data-theme="dark"]'))]);
const sombreSysteme = lireJetons(blocApres(':root:not([data-theme="light"])'));

const luminance = (hex: string): number => {
  const valeur = hex.replace("#", "");
  const canal = (rang: number): number => {
    const c = Number.parseInt(valeur.slice(rang, rang + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
};

const ratio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Les couples texte/fond réellement utilisés par l'interface. */
const COUPLES: ReadonlyArray<readonly [string, string]> = [
  ["ink", "ground"],
  ["ink", "surface"],
  ["ink-2", "surface"],
  ["ink-2", "surface-2"],
  ["ink-3", "ground"],
  ["ink-3", "surface"],
  ["ink-3", "surface-2"],
  ["attn", "surface"],
  ["attn", "attn-fill"],
  ["work", "surface"],
  ["work", "work-fill"],
  ["ok", "surface"],
  ["ok", "ok-fill"],
  ["err", "surface"],
  ["err", "err-fill"],
  ["on-primary", "primary"],
];

const MINIMUM = 4.5;

describe.each([
  ["clair", clair],
  ["sombre", sombre],
] as const)("palette %s", (_nom, palette) => {
  test.each(COUPLES)("%s sur %s ≥ 4,5:1", (texte, fond) => {
    const a = palette.get(texte);
    const b = palette.get(fond);
    if (a === undefined || b === undefined) throw new Error(`jeton absent : ${texte} / ${fond}`);
    expect(ratio(a, b)).toBeGreaterThanOrEqual(MINIMUM);
  });
});

describe("les deux copies de la palette sombre sont identiques", () => {
  test("le bloc système et le bloc forcé portent les mêmes valeurs", () => {
    expect(sombreSysteme.size).toBeGreaterThan(10);
    for (const [nom, valeur] of sombreSysteme) {
      expect(`${nom}: ${sombre.get(nom) ?? "absent"}`).toBe(`${nom}: ${valeur}`);
    }
  });
});
