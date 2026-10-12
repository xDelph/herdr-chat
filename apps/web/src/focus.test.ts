/**
 * Parcours clavier des feuilles (U11).
 *
 * Le contrat dit « parcours clavier/lecteur d'écran complets ; aucun contrôle
 * inaccessible ». Ces tests portent sur les trois décisions qui le rendent vrai
 * — ce qui est atteignable, comment le cycle boucle, et qui ferme.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cibleSuivante, ciblesVisibles, toucheDeFermeture } from "./focus.ts";
import type { Cible } from "./focus.ts";

/**
 * Une cible de test.
 *
 * `focus` est obligatoire dans l'interface parce que la feuille l'appelle — le
 * programmeur qui écrit la fonction voit l'exigence, et le test fournit un
 * corps qui ne fait rien.
 */
const cible = (tabIndex = 0, hidden: boolean | string | undefined = false): Cible => ({
  focus: () => {},
  hidden,
  tabIndex,
});

/**
 * Trois cibles nommées.
 *
 * Nommées plutôt qu'indexées : `liste[0]` sous index non vérifié donne un type
 * qui inclut `undefined`, et le test se retrouve à teste une arithmétique de
 * types au lieu du comportement du cycle.
 */
const trois = (): { readonly a: Cible; readonly b: Cible; readonly c: Cible } => ({
  a: cible(),
  b: cible(),
  c: cible(),
});

/** Source d'un fichier voisin — même dossier que le test. */
const lire = (nom: string): string => readFileSync(join(import.meta.dir, nom), "utf8");

/** Les trois cibles nommées, dans l'ordre du document. */
const listeDe = (t: {
  readonly a: Cible;
  readonly b: Cible;
  readonly c: Cible;
}): ReadonlyArray<Cible> => [t.a, t.b, t.c];

describe("U11 — `Échap` ferme, et elle seule", () => {
  const sansModificateur = {
    altKey: false,
    ctrlKey: false,
    key: "Escape",
    metaKey: false,
    shiftKey: false,
  };

  test("`Échap` nue ferme", () => {
    expect(toucheDeFermeture(sansModificateur)).toBe(true);
  });

  test("avec un modificateur, non", () => {
    // `Échap` sert ailleurs : sous un modificateur, ce n'est plus une
    // fermeture d'écran, c'est une autre action du système.
    for (const modificateur of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) {
      expect(toucheDeFermeture({ ...sansModificateur, [modificateur]: true })).toBe(false);
    }
  });

  test("une autre touche ne ferme pas", () => {
    expect(toucheDeFermeture({ ...sansModificateur, key: "Enter" })).toBe(false);
    expect(toucheDeFermeture({ ...sansModificateur, key: "Tab" })).toBe(false);
  });
});

describe("U11 — ce qui est atteignable au clavier", () => {
  test("un `tabIndex` négatif est exclu", () => {
    // Atteignable au programme, **pas** au clavier. Le garder arrête le parcours
    // sur un élément que l'utilisateur ne voit pas.
    const liste = ciblesVisibles([cible(), cible(-1)]);
    expect(liste).toHaveLength(1);
  });

  test("un élément masqué est exclu, dans les deux écritures", () => {
    const liste = ciblesVisibles([cible(), cible(0, true), cible(0, "hidden")]);
    expect(liste).toHaveLength(1);
  });

  test("une liste entièrement exclue ne casse rien", () => {
    expect(ciblesVisibles([cible(-1), cible(0, true)])).toEqual([]);
  });
});

describe("U11 — le cycle boucle aux deux extrémités", () => {
  test("on avance de proche en proche", () => {
    const t = trois();
    expect(cibleSuivante(listeDe(t), t.a, true)).toBe(t.b);
    expect(cibleSuivante(listeDe(t), t.b, true)).toBe(t.c);
  });

  test("après la dernière, on revient à la première", () => {
    const t = trois();
    // Sans rebouclage, `Tab` sorterait de la feuille — c'est le défaut exact que
    // cette fonction existe pour empêcher.
    expect(cibleSuivante(listeDe(t), t.c, true)).toBe(t.a);
  });

  test("avant la première, on revient à la dernière", () => {
    const t = trois();
    expect(cibleSuivante(listeDe(t), t.a, false)).toBe(t.c);
  });

  test("sans point de départ, on entre par la première", () => {
    // C'est le cas à l'ouverture de la feuille.
    const t = trois();
    expect(cibleSuivante(listeDe(t), null, true)).toBe(t.a);
  });

  test("un point de départ inconnu revient à la première", () => {
    const t = trois();
    expect(cibleSuivante(listeDe(t), cible(), true)).toBe(t.a);
  });

  test("liste vide : `null`, jamais une exception", () => {
    expect(cibleSuivante([], null, true)).toBeNull();
    expect(cibleSuivante([], cible(), false)).toBeNull();
  });

  test("une seule cible reste sur elle-même", () => {
    const seule = cible();
    expect(cibleSuivante([seule], seule, true)).toBe(seule);
    expect(cibleSuivante([seule], seule, false)).toBe(seule);
  });
});

/**
 * La coquille est **unique** (U11).
 *
 * ⚠️ Il y avait quatre feuilles écrites à la main, chacune avec son bloc
 * `sheet__head` et son bouton « Fermer », et aucune n'écoutait `Échap` ni ne
 * déplaçait le focus. Copier la coquille — c'est-à-dire la recopier *avant*
 * qu'elle ne soit bonne — est exactement le risque que ces tests ferment.
 */
describe("U11 — une seule coquille, une seule annonce", () => {
  const feuilles = ["Files.tsx", "ModelSheet.tsx", "Viewer.tsx", "LaunchSheet.tsx"];

  test("les quatre feuilles passent par `Feuille`", () => {
    for (const nom of feuilles) {
      expect(lire(nom)).toContain('from "./Feuille.tsx"');
    }
  });

  test("aucune ne réécrit la coquille", () => {
    for (const nom of feuilles) {
      const texte = lire(nom);
      // Un `<div className="sheet">` ou un `<header className="sheet__head">`
      // écrit à la main est une copie : la feuille perd `Échap`, le focus, et le
      // nom accessible, sans qu'aucun test ne le voie.
      expect(texte).not.toContain('className="sheet"');
      expect(texte).not.toContain('className="sheet__head"');
      expect(texte).not.toContain(">Fermer</button>");
    }
  });

  test("aucune n'écoute `Échap` de son côté", () => {
    // Deux gestionnaires : une touche peut fermer deux fois, la visionneuse
    // puis la liste derrière elle.
    for (const nom of feuilles) {
      expect(lire(nom)).not.toContain('event.key === "Escape"');
    }
  });

  test("la coquille gère bien `Échap`, le focus et le nom accessible", () => {
    const feuille = lire("Feuille.tsx");
    expect(feuille).toContain("toucheDeFermeture(event)");
    expect(feuille).toContain("element.focus({ preventScroll: true })");
    expect(feuille).toContain("destination.focus({ preventScroll: true })");
    expect(feuille).toContain("aria-label={ariaLabel}");
  });

  test("aucun avis n'échappe à l'annonce", () => {
    // Dix-huit avis existaient, aucun annoncé. Un seul qui revienne par la
    // porte de l'arrièreplan estmuet.
    const sources = readdirSync(import.meta.dir).filter((nom) => nom.endsWith(".tsx"));
    for (const nom of sources) {
      const texte = lire(nom);
      if (nom === "Notice.tsx") continue;
      expect(texte).not.toContain('className="notice');
      expect(texte).not.toContain("notice--error");
      expect(texte).not.toContain("notice--warn");
    }
  });

  test("un avis d'erreur s'annonce, un avertissement se murmure", () => {
    const avis = lire("Notice.tsx");
    expect(avis).toContain('role={ton === "erreur" ? "alert" : "status"}');
  });

  test("la feuille ne ment pas sur sa nature modale", () => {
    // `aria-modal` sans piège natif promet un comportement que le dialogue n'a
    // pas. Le piège est fait à la main, et c'est `focus.test.ts` qui le vérifie.
    expect(lire("Feuille.tsx")).not.toContain("aria-modal");
  });
});
