/**
 * Thèmes — la validation, et l'accord avec la feuille de style.
 *
 * ⚠️ **Le lien entre les deux morceaux est le vrai sujet de ce fichier.** Les
 * thèmes sont déclarés deux fois, et c'est inévitable : les noms dans
 * `theme.ts`, les palettes dans `styles.css`. Ce qui ne doit pas arriver, c'est
 * qu'un thème existe d'un côté seulement — un thème annoncé sans bloc CSS
 * n'aurait aucun effet, et un bloc CSS sans thème serait du code mort que
 * personne ne saurait retrouver.
 *
 * ⚠️ `appliquerTheme` n'est **pas** testé ici. Il écrit dans le DOM et dans le
 * stockage ; un test devrait donc simuler un navigateur entier, et vérifierait la
 * simulation plutôt que le code. Ce chemin-là se vérifie **par exécution** :
 * choisir un thème, recharger, et constater que l'attribut est toujours là.
 */
import { describe, expect, test } from "bun:test";
import { css } from "./contraste.ts";
import {
  attributDeStyleMarque,
  attributDeTheme,
  estStyleMarque,
  estTheme,
  STYLE_MARQUE_DEFAUT,
  STYLE_MARQUE_LABEL,
  STYLES_MARQUE,
  styleMarqueEnregistre,
  THEME_DEFAUT,
  THEME_LABEL,
  THEMES,
  themeEnregistre,
} from "./preferences.ts";

describe("le thème retenu est toujours un thème valide", () => {
  test("une valeur connue est retenue telle quelle", () => {
    for (const theme of THEMES) {
      expect(`${theme} → ${themeEnregistre(theme)}`).toBe(`${theme} → ${theme}`);
    }
  });

  test("une valeur inconnue retombe sur le défaut, sans lever", () => {
    /*
      ⚠️ Thème retiré dans une version ultérieure, stockage modifié à la main,
      écriture d'une version précédente : toute valeur non reconnue doit retomber
      sur le défaut. Une application qui refuserait de s'afficher parce qu'une
      préférence est illisible serait un bien plus grand défaut que la préférence
      perdue.
    */
    for (const valeur of ["", "purple", "BLUE", " blue", "green ", "{}", "null"]) {
      expect(`${valeur} → ${themeEnregistre(valeur)}`).toBe(`${valeur} → ${THEME_DEFAUT}`);
    }
  });

  test("rien d'enregistré, rien d'inventé : le défaut", () => {
    expect(themeEnregistre(null)).toBe(THEME_DEFAUT);
    expect(themeEnregistre(undefined)).toBe(THEME_DEFAUT);
  });

  test("`estTheme` est le seul juge, et il est strict", () => {
    // ⚠️ Strict : `"Blue"` ou `" blue"` ne sont pas des thèmes. Une comparaison
    // laxiste ferait passer une valeur qu'aucun bloc CSS ne reconnaîtrait, et
    // l'application retomberait silencieusement sur le bleu sans que le stockage
    // le dise.
    expect(estTheme("green")).toBe(true);
    for (const valeur of ["Green", "GREEN", " green", "green ", "", null, undefined]) {
      expect(estTheme(valeur)).toBe(false);
    }
  });
});

describe("la table des thèmes et la feuille de style disent la même chose", () => {
  test("chaque thème non-défaut a son bloc, sous le bon attribut", () => {
    for (const theme of THEMES) {
      if (theme === THEME_DEFAUT) continue;
      expect(css).toContain(`:root[data-theme="${attributDeTheme(theme)}"] {`);
    }
  });

  test("le thème de base n'a PAS de bloc — sinon la palette serait écrite deux fois", () => {
    /*
      ⚠️ C'est la règle qui rend `tokenDuTheme` correct : `blue` EST la palette de
      `:root`. Ajouter un bloc pour lui créerait deux définitions à garder
      d'accord, et le test de contraste n'en mesurerait qu'une.
    */
    expect(css).not.toContain(`data-theme="${attributDeTheme(THEME_DEFAUT)}"`);
    expect(attributDeTheme(THEME_DEFAUT)).toBe("blue");
  });

  test("chaque thème porte un libellé lisible", () => {
    // L'interface est en anglais : le libellé part tel quel dans le sélecteur.
    for (const theme of THEMES) {
      expect(THEME_LABEL[theme].length).toBeGreaterThan(0);
    }
  });
});

/**
 * Le rendu des marques — un réglage, deux valeurs, un défaut.
 *
 * ⚠️ **Le défaut est « standard », et c'est un renversement assumé.** La première
 * version colorait les marques avec l'accent du thème sans que personne ne l'ait
 * demandé. Les couleurs d'origine sont désormais le défaut : une marque est
 * dessinée dans ses couleurs, et la reconnaissance immédiate est justement la
 * raison d'afficher un logo plutôt qu'un point coloré. L'option « à la couleur du
 * thème » reste, parce qu'elle rend la liste homogène.
 */
describe("le rendu des marques", () => {
  test("une valeur connue est retenue telle quelle", () => {
    for (const style of STYLES_MARQUE) {
      expect(`${style} → ${styleMarqueEnregistre(style)}`).toBe(`${style} → ${style}`);
    }
  });

  test("sans rien d'enregistré, c'est le logo STANDARD", () => {
    // ⚠️ C'est ce que voit quelqu'un qui n'a jamais touché au réglage, et c'est
    // le cas de la quasi-totalité des installations.
    expect(styleMarqueEnregistre(null)).toBe("standard");
    expect(styleMarqueEnregistre(undefined)).toBe("standard");
    expect(STYLE_MARQUE_DEFAUT).toBe("standard");
  });

  test("une valeur inconnue retombe sur le défaut, sans lever", () => {
    for (const valeur of ["", "couleur", "Standard", " standard", "{}"]) {
      expect(`${valeur} → ${styleMarqueEnregistre(valeur)}`).toBe(`${valeur} → standard`);
    }
  });

  test("`estStyleMarque` est le seul juge, et il est strict", () => {
    expect(estStyleMarque("theme")).toBe(true);
    for (const valeur of ["Theme", "THEME", " theme", "theme ", "", null, undefined]) {
      expect(estStyleMarque(valeur)).toBe(false);
    }
  });

  test("chaque rendu a un libellé lisible", () => {
    // L'interface est en anglais : le libellé part tel quel dans le sélecteur.
    for (const style of STYLES_MARQUE) {
      expect(STYLE_MARQUE_LABEL[style].length).toBeGreaterThan(0);
    }
  });

  test("l'attribut posé est la valeur elle-même", () => {
    // Le CSS s'en sert directement : `[data-marques="theme"]`. Renommer d'un
    // côté sans l'autre ferait un réglage sans effet, et rien ne le dirait.
    for (const style of STYLES_MARQUE) {
      expect(attributDeStyleMarque(style)).toBe(style);
    }
  });

  test("les deux rendus sortent des MÊMES tracés", () => {
    /*
      ⚠️ C'est la règle qui évite que les deux versions divergent. Le mode
      « couleur du thème » est une règle CSS qui écrase les attributs `fill` ;
      dupliquer les chemins aurait donné deux jeux de tracés à tenir d'accord, et
      le premier changement de marque aurait fait oublier l'autre.
    */
    expect(css).toContain(':root[data-marques="theme"] .agent-badge svg path {');
    // ⚠️ Le repli neutre n'y est **pas** : il n'a pas de `fill`, donc il suit
    // `currentColor` dans les deux modes — il ne représente aucune marque.
    expect(css).not.toContain(':root[data-marques="theme"] .agent-badge svg circle');
  });
});
