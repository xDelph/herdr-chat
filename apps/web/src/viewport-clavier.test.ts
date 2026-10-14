/**
 * La coquille ne peut pas se retrouver **trop courte**.
 *
 * ⚠️ **Pourquoi ce test lit la source.** Le défaut qu'il encadre — le composeur
 * qui remonte en haut de l'écran à la mise au point — dépend du comportement du
 * clavier iOS, qu'aucun test ne peut simuler ici. Mais sa **cause** est une
 * règle de code, et une règle de code se vérifie.
 *
 * La règle : la hauteur de référence est **retenue hors saisie**. Prendre
 * directement `window.innerHeight` quand le clavier semble fermé échoue, parce
 * qu'iOS rétrécit aussi cette valeur : la détection compare alors deux nombres
 * déjà rétrécis, ne voit rien, et garde la petite valeur. Un shell trop court
 * met le composeur sous l'en-tête — donc tout en haut de l'écran.
 *
 * Le dépôt vérifie de cette façon ce qui ne se teste pas autrement (la coquille
 * des feuilles, les dépendances de l'effet de chargement). Même méthode.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "App.tsx"), "utf8");

describe("hauteur du shell au clavier", () => {
  test("la hauteur de référence est retenue hors saisie", () => {
    // C'est LA ligne qui empêche la coquille de rétrécir sous le clavier.
    expect(source).toContain("const hauteurPleine = useRef(0);");
    expect(source).toContain("hauteurPleine.current = Math.max(");
  });

  test("elle n'est mise à jour que hors saisie", () => {
    // Si elle était mise à jour pendant la saisie, le clavier la rétrécirait et
    // on retrouverait exactement le défaut.
    const miseAJour = source.indexOf("hauteurPleine.current = Math.max(");
    const garde = source.lastIndexOf("if (!champActif) {", miseAJour);
    expect(garde).toBeGreaterThan(-1);
    expect(miseAJour - garde).toBeLessThan(300);
  });

  test("la coquille prend la hauteur retenue quand le clavier est fermé", () => {
    expect(source).toContain("else applique(hauteurPleine.current, 0);");
  });

  test("elle suit le viewport visuel quand le clavier est ouvert", () => {
    expect(source).toContain(
      "if (clavierOuvert && viewport) applique(viewport.height, viewport.offsetTop);",
    );
  });

  test("la mise au point est écoutée directement, pas seulement la taille", () => {
    expect(source).toContain('document.addEventListener("focusin", syncViewport);');
    expect(source).toContain('document.addEventListener("focusout", syncViewport);');
  });

  test("une rotation remet la référence à zéro", () => {
    // Sans cela, la hauteur portrait resterait la référence en paysage.
    expect(source).toContain("hauteurPleine.current = 0;");
    expect(source).toContain('window.addEventListener("orientationchange"');
  });

  test("on n'écrit dans le DOM que si la valeur change", () => {
    // Écrire à chaque `scroll` du viewport peut relancer la mise en page et
    // faire boucler la synchronisation pendant l'animation du clavier.
    expect(source).toContain(
      "if (coquille.current.hauteur === hauteur && coquille.current.haut === haut) return;",
    );
  });
});
