/**
 * Le composeur garde son curseur et sa hauteur.
 *
 * ⚠️ **Pourquoi ce test lit la source.** Les deux défauts encadrés ici ne sont
 * dans aucune fonction : ils sont dans l'ordre des effets d'un champ contrôlé.
 *
 * 1. **Écrire dans `.value` remet le curseur à 0.** L'application écrit dans le
 *    champ à deux moments — au changement d'agent (brouillon retrouvé) et à la
 *    réexpédition d'un message en échec. Sans repositionnement, la suite du
 *    texte s'insérait **avant** tout le brouillon.
 * 2. **`onBlur` rend la hauteur au CSS**, donc le champ retombe à une ligne.
 *    Rien ne la recalculait au retour du focus : un brouillon de trois lignes
 *    réapparaissait sur une seule jusqu'à la première frappe — ce qui donnait
 *    l'impression que la première lettre manquait.
 *
 * Les deux règles tiennent en une ligne chacune, et une relecture ne les
 * retiendrait pas deux fois. Le dépôt encadre déjà de la même façon la coquille
 * des feuilles et la cadence de rafraîchissement.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");

/** Corps d'une fonction, de sa déclaration à sa fermeture. */
const corpsDe = (declaration: string, fin: string): string => {
  const debut = source.indexOf(declaration);
  expect(debut).toBeGreaterThan(-1);
  const arret = source.indexOf(fin, debut);
  expect(arret).toBeGreaterThan(debut);
  return source.slice(debut, arret + fin.length);
};

describe("le curseur ne repart jamais au début", () => {
  test("l'écriture dans le champ replace le curseur à la fin", () => {
    const corps = corpsDe("const ecrireAuChamp = useCallback(", "},\n    [ajusterHauteur],\n  );");

    // L'ordre compte : on écrit, on ajuste, on replace.
    expect(corps).toContain("champ.value = texte;");
    expect(corps).toContain("champ.setSelectionRange(texte.length, texte.length);");
    expect(corps.indexOf("champ.value = texte;")).toBeLessThan(corps.indexOf("setSelectionRange"));
  });

  test("les deux écritures de l'application passent par elle", () => {
    // ⚠️ Une écriture directe dans `.value` laisserait le curseur à 0 — c'est
    // exactement le défaut que la fonction existe pour empêcher.
    expect(source).toContain("ecrireAuChamp(retrouve);");
    // ⚠️ Le texte rendu au brouillon vient désormais du MAGASIN (`annule` rend
    // le texte de l'envoi, T058) : la règle ne change pas — l'écriture passe
    // toujours par `ecrireAuChamp`, jamais par `.value` en direct.
    expect(source).toContain("ecrireAuChamp(texte);");
    expect(source).not.toContain("champRef.current.value = message.text");
    expect(source).not.toContain("champ.value = retrouve");
  });

  test("vider le champ reste une écriture directe — le curseur y est déjà à 0", () => {
    expect(source).toContain('champRef.current.value = "";');
  });
});

describe("la hauteur suit le contenu, à la frappe comme au focus", () => {
  test("le blur rend la hauteur au CSS", () => {
    // C'est la cause du défaut de multiligne : si cette ligne disparaît, le
    // champ garde la hauteur du message précédent. Si elle reste, le focus doit
    // recalculer — les deux vont ensemble.
    expect(source).toContain('field.style.height = "";');
  });

  test("le focus la recalcule", () => {
    const corps = corpsDe("const reprendreFocus = useCallback(", "},\n    [ajusterHauteur],\n  );");

    expect(corps).toContain("ajusterHauteur(champ);");
    expect(source).toContain("onFocus={(event) => reprendreFocus(event.currentTarget)}");
  });

  test("la frappe la recalcule aussi", () => {
    expect(source).toContain("ajusterHauteur(event.target);");
  });

  test("les deux chemins partagent la même mesure", () => {
    // Deux calculs de hauteur divergeraient : `ajusterHauteur` porte le seul
    // calcul (`field.style.height = \u00ab auto \u00bb` puis la valeur mesurée).
    expect(source.match(/field\.style\.height = `\$\{/g)?.length).toBe(1);
    expect(source.match(/field\.style\.height = "auto"/g)?.length).toBe(1);
  });
});

describe("le curseur n'est déplacé que quand c'est l'application qui écrit", () => {
  test("le focus ne force pas la fin", () => {
    // ⚠️ Forcer la fin à chaque prise de focus serait plus simple, et faux : on
    // ne pourrait plus taper au milieu du texte pour corriger un mot.
    const corps = corpsDe("const reprendreFocus = useCallback(", "},\n    [ajusterHauteur],\n  );");

    expect(corps).not.toContain("setSelectionRange");
  });

  test("`setSelectionRange` n'apparaît qu'une fois, dans `ecrireAuChamp`", () => {
    expect(source.match(/setSelectionRange/g)?.length).toBe(1);
  });
});
