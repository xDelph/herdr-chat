/**
 * Préférences — le thème et le regroupement, et l'accord avec la feuille de
 * style.
 *
 * ⚠️ Les thèmes sont déclarés deux fois, et c'est inévitable : les noms dans
 * `preferences.ts`, les palettes dans `styles/tokens.css`. Ce qui ne doit pas
 * arriver, c'est qu'une surcharge existe d'un côté seulement.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attributDeTheme,
  estGroupement,
  estTheme,
  GROUPEMENT_DEFAUT,
  groupementEnregistre,
  THEME_DEFAUT,
  THEME_LABEL,
  THEMES,
  themeEnregistre,
} from "../src/preferences.ts";

const jetons = readFileSync(join(import.meta.dir, "..", "src", "styles", "tokens.css"), "utf8");

describe("le thème retenu est toujours un thème valide", () => {
  test("une valeur connue est retenue telle quelle", () => {
    for (const theme of THEMES) expect(themeEnregistre(theme)).toBe(theme);
  });

  test("les anciens thèmes (blue, green, red) retombent sur Auto, sans lever", () => {
    for (const ancien of ["blue", "green", "red", "", "BLEU"]) {
      expect(themeEnregistre(ancien)).toBe(THEME_DEFAUT);
    }
    expect(themeEnregistre(null)).toBe("auto");
    expect(themeEnregistre(undefined)).toBe("auto");
  });

  test("`estTheme` est strict", () => {
    expect(estTheme("clair")).toBe(true);
    expect(estTheme("Clair")).toBe(false);
    expect(estTheme(" sombre")).toBe(false);
  });

  test("chaque thème a un libellé", () => {
    for (const theme of THEMES) expect(THEME_LABEL[theme].length).toBeGreaterThan(0);
  });
});

describe("Auto suit le système, Clair et Sombre surchargent", () => {
  test("Auto ne pose aucun attribut : `prefers-color-scheme` décide", () => {
    expect(attributDeTheme("auto")).toBeNull();
    expect(jetons).toContain("@media (prefers-color-scheme: dark)");
    expect(jetons).toContain(':root:not([data-theme="light"])');
  });

  test("Sombre a son bloc forcé, Clair est la palette de base", () => {
    expect(attributDeTheme("sombre")).toBe("dark");
    expect(attributDeTheme("clair")).toBe("light");
    expect(jetons).toContain(':root[data-theme="dark"]');
  });
});

describe("le regroupement", () => {
  test("une valeur illisible retombe sur « par état »", () => {
    expect(groupementEnregistre("par-couleur")).toBe(GROUPEMENT_DEFAUT);
    expect(groupementEnregistre("projet")).toBe("projet");
    expect(estGroupement("statut")).toBe(true);
    expect(estGroupement("Statut")).toBe(false);
  });
});
