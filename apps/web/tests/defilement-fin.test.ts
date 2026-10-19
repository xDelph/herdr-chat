/**
 * Où l'écran se pose quand un agent finit de travailler.
 *
 * ⚠️ **Le bas n'est pas toujours la bonne position.** Une réponse qui s'ajoute au
 * bas de l'écran pousse la **demande** hors du cadre : on lit la réponse sans
 * savoir à quoi elle répond, et il faut remonter d'un geste. Quand un travail se
 * termine, on amène donc la dernière demande **en haut**, et la réponse se lit
 * dessous.
 *
 * ⚠️ **Mais pas à l'ouverture, et pas n'importe quel état.** Un agent `idle` a
 * déjà été lu : on se pose en bas, comme dans toute messagerie. Un agent `done`
 * attend une réponse qu'on n'a pas vue — là, la demande en haut est meilleure.
 *
 * ⚠️ **La règle a maintenant son test unitaire** (`defilement.test.ts`) : elle a
 * quitté la condition d'un effet pour `defilement.ts`, où elle est une fonction
 * pure. Ce fichier garde ce qu'un test unitaire ne peut pas voir : le **repère
 * DOM** (la dernière bulle de l'utilisateur, jamais un envoi optimiste) et le
 * fait que l'écran **délègue** au lieu de réimplémenter sa propre règle — une
 * seconde définition divergerait.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");

describe("la demande passe en haut quand un travail se termine", () => {
  test("c'est le dernier message de l'utilisateur qui sert de repère", () => {
    expect(source).toContain('scroller.querySelectorAll(".bubble--user:not(.optimistic)")');
  });

  test("un envoi en attente n'est JAMAIS pris pour le repère", () => {
    // ⚠️ Un envoi optimiste porte aussi `bubble--user`, mais il est collé au bas
    // (`.envois`) : il ne défile pas. Le viser ferait sauter la vue n'importe où.
    expect(source).toContain(":not(.optimistic)");
  });

  test("le repère est le DERNIER, pas le premier", () => {
    expect(source).toContain("demandes[demandes.length - 1]");
  });
});

describe("la règle est CENTRALISÉE, pas réécrite dans l'écran", () => {
  test("l'écran appelle `ancrage(...)`", () => {
    expect(source).toContain("ancrage({");
  });

  test("l'écran ne réimplémente pas la comparaison de statuts", () => {
    // ⚠️ C'est le point : deux définitions de la règle divergent. Si l'écran
    // recommence à comparer `"working"`/`"done"` lui-même, le test unitaire de
    // `defilement.ts` continuera de passer alors que l'écran fera autre chose.
    expect(source).not.toContain('avant === "working"');
    expect(source).not.toContain('agent.status === "done"');
  });

  test("l'intention de lecture est PASSÉE à la règle, pas recalculée", () => {
    expect(source).toContain("suivaitLeBas: atBottom.current");
  });

  test("le statut vu est remis à zéro en changeant d'agent", () => {
    // Sans cela, le statut de l'agent précédent ferait croire à une transition.
    expect(source).toContain("statutVu.current = null;");
  });

  test("l'effet ne dépend pas des messages", () => {
    // Sinon il se rejouerait à chaque tour de rafraîchissement — toutes les
    // 400 ms pendant que l'agent travaille.
    const index = source.indexOf("const ou = ancrage(");
    const bloc = source.slice(index, index + 400);
    expect(bloc).not.toContain("messages");
  });

  test("la règle elle-même est prouvée par un test unitaire", () => {
    // Le pendant de la centralisation : sans test unitaire, « centralisé » ne
    // veut dire que « déplacé ».
    const regles = readFileSync(join(import.meta.dir, "defilement.test.ts"), "utf8");
    expect(regles).toContain("ancrage({");
    expect(regles).toContain('"demande"');
    expect(regles).toContain('"bas"');
  });
});

describe("le défilement ne se fait pas annuler par l'observateur", () => {
  test("l'intention est recalculée juste après le saut", () => {
    // ⚠️ L'événement de défilement arrive **après** : sans ce recalcul,
    // l'observateur de taille pouvait repasser et ramener la vue en bas, annulant
    // le correctif par le mécanisme existant.
    const debut = source.indexOf("scroller.scrollTop += ecart - 8;");
    expect(debut).toBeGreaterThan(-1);
    expect(source.slice(debut, debut + 600)).toContain("atBottom.current =");
  });
});
