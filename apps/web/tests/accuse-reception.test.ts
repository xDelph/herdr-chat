/**
 * L'acquittement d'une réponse par l'usage (défiler, écrire).
 *
 * ⚠️ **Décision produit explicite** : plus de bouton « mark as read ». Une
 * réponse `done` devient lue dès que l'utilisateur agit dans la conversation.
 * Ce qui reste interdit : acquitter un `blocked` (une question posée n'est pas
 * une réponse à lire) et acquitter sans interaction.
 */
import { describe, expect, test } from "bun:test";
import { doitAcquitter } from "../src/accuse-reception.ts";

describe("quand acquitter", () => {
  test("un agent `done` + une interaction = acquittement", () => {
    expect(doitAcquitter({ aInteragi: true, dejaAcquitte: false, statut: "done" })).toBe(true);
  });

  test("sans interaction, on n'acquitte pas", () => {
    // Ouvrir pour regarder ne vaut pas lecture : c'est C24, et ça reste vrai.
    expect(doitAcquitter({ aInteragi: false, dejaAcquitte: false, statut: "done" })).toBe(false);
  });

  test("`blocked` ne s'acquitte JAMAIS", () => {
    // L'agent pose une question : l'effacer de « Needs attention » ferait
    // passer une question pour lue.
    expect(
      doitAcquitter({
        aInteragi: true,
        dejaAcquitte: false,
        statut: "blocked",
      }),
    ).toBe(false);
  });

  test("`working` et `idle` ne s'acquittent pas", () => {
    expect(
      doitAcquitter({
        aInteragi: true,
        dejaAcquitte: false,
        statut: "working",
      }),
    ).toBe(false);
    expect(doitAcquitter({ aInteragi: true, dejaAcquitte: false, statut: "idle" })).toBe(false);
  });

  test("un épisode déjà acquitté ne renvoie rien", () => {
    // Sinon chaque défilement re-focaliserait le pane sur le Mac.
    expect(doitAcquitter({ aInteragi: true, dejaAcquitte: true, statut: "done" })).toBe(false);
  });
});
