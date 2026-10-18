/**
 * La coquille **est** le viewport visuel — et rien n'est retenu d'un tour à l'autre.
 *
 * ⚠️ **Pourquoi ce test lit la source, et pourquoi il a été réécrit.**
 *
 * Le défaut qu'il encadre ne se voit que sur un iPhone installé. Mais sa cause
 * est une règle de code, et une règle de code se vérifie.
 *
 * La règle précédente était : « on retient la plus grande hauteur observée hors
 * saisie, et on préfère une coquille trop haute à une trop courte ». Elle a
 * produit **une coquille trop haute** : `window.innerHeight` est la hauteur de
 * mise en page, qui en mode installé dépasse la zone visible. Le composeur et le
 * bouton flottant tombaient à moitié sous le bord.
 *
 * « Trop haute » n'est pas le camp sûr : c'est le camp où le bas est **coupé**,
 * donc invisible — pire qu'un vide qu'on voit. La seule valeur dont le contrat
 * est « ce qui est visible » est `visualViewport.height`, et elle tient compte du
 * clavier toute seule.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "..", "src", "App.tsx"), "utf8");

/** Corps de l'effet qui écrit la hauteur de la coquille. */
const effet = (): string => {
  const debut = source.indexOf("const coquille = useRef(");
  expect(debut).toBeGreaterThan(-1);
  const fin = source.indexOf("}, []);", debut);
  expect(fin).toBeGreaterThan(debut);
  return source.slice(debut, fin);
};

describe("hauteur de la coquille", () => {
  test("elle vient du viewport visuel", () => {
    expect(effet()).toContain("viewport?.height ?? window.innerHeight");
  });

  test("elle suit aussi le décalage du viewport", () => {
    expect(effet()).toContain("viewport?.offsetTop ?? 0");
  });

  test("`innerHeight` n'est qu'un repli, jamais une préférence", () => {
    // Le défaut précédent : `innerHeight` gagnait parce qu'on prenait le maximum.
    // Une seule occurrence, et jamais retenue : c'est le repli, pas le choix.
    expect(effet().split("window.innerHeight").length - 1).toBe(1);
  });

  test("aucune hauteur n'est RETENUE d'un tour à l'autre", () => {
    // Retenir, c'est ce qui faisait qu'une coquille trop haute ne redescendait
    // jamais — même après rotation.
    expect(source).not.toContain("hauteurPleine");
    expect(effet()).not.toContain("Math.max");
  });

  test("rien ne se croit plus malin que le viewport", () => {
    // Pas de détection « clavier ouvert ? », pas de seuil en pixels : le
    // viewport visuel sait déjà tout cela.
    expect(effet()).not.toContain("clavierOuvert");
    expect(effet()).not.toContain("- 100");
  });

  test("on n'écrit dans le DOM que si la valeur change", () => {
    // Écrire à chaque `scroll` du viewport peut relancer la mise en page et
    // faire boucler la synchronisation pendant l'animation du clavier.
    expect(effet()).toContain(
      "if (coquille.current.hauteur === hauteur && coquille.current.haut === haut) return;",
    );
  });

  test("la mise au point reste écoutée : iOS ne redimensionne pas toujours à temps", () => {
    expect(effet()).toContain('document.addEventListener("focusin", syncViewport);');
    expect(effet()).toContain('document.addEventListener("focusout", syncViewport);');
  });
});
