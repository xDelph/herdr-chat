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
 * ⚠️ Pourquoi lire la source : la règle vit dans la **condition d'un effet** et
 * dans un choix de sélecteur DOM. Aucun test unitaire ne l'attrape, et une
 * relecture ne la retiendrait pas deux fois. Même méthode que pour la cadence de
 * rafraîchissement et le curseur du composeur.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "ChatScreen.tsx"), "utf8");

/** Corps de l'effet qui décide de la position à la fin d'un travail. */
const effetDeFin = (): string => {
  const debut = source.indexOf("const finitDeTravailler");
  expect(debut).toBeGreaterThan(-1);
  const fin = source.indexOf("derniereDemandeEnHaut();", debut);
  expect(fin).toBeGreaterThan(debut);
  return source.slice(debut, fin);
};

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

describe("la règle dépend de l'état, et de rien d'autre", () => {
  test("une fin de travail ramène à la demande", () => {
    expect(effetDeFin()).toContain('avant === "working" && agent.status !== "working"');
  });

  test("à l'ouverture, un agent `done` ramène à la demande", () => {
    // `avant === null` = première fois qu'on voit cet agent.
    expect(effetDeFin()).toContain('avant === null && agent.status === "done"');
  });

  test("à l'ouverture, un agent `idle` n'y ramène PAS", () => {
    // ⚠️ La distinction qui compte : `idle` veut dire « déjà lu ». Y ramener la
    // demande contredirait la convention du bas, et ferait sauter la vue à chaque
    // ouverture de conversation.
    expect(effetDeFin()).not.toContain('"idle"');
  });

  test("on ne ramène JAMAIS quelqu'un qui lisait plus haut", () => {
    expect(effetDeFin()).toContain("if (!atBottom.current) return;");
  });

  test("le statut vu est remis à zéro en changeant d'agent", () => {
    // Sans cela, le statut de l'agent précédent ferait croire à une transition.
    expect(source).toContain("statutVu.current = null;");
  });

  test("l'effet ne dépend pas des messages", () => {
    // Sinon il se rejouerait à chaque tour de rafraîchissement — toutes les
    // 400 ms pendant que l'agent travaille.
    const index = source.indexOf("const finitDeTravailler");
    const bloc = source.slice(index, index + 700);
    expect(bloc).not.toContain("messages");
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
