/**
 * Répondre à une question posée à l'écran.
 *
 * ⚠️ **La règle qui compte plus que les autres :** on n'envoie **jamais** une
 * touche qui n'est pas un choix **offert par la question affichée**. Pas de
 * « 1 par défaut », pas de touche devinée, pas de `enter` seul. Une invite de
 * codex peut autoriser l'exécution de code ; envoyer un chiffre que personne n'a
 * proposé serait envoyer une décision que l'utilisateur n'a pas prise.
 *
 * ⚠️ **On relit après avoir frappé** — même discipline que `TrustPrompt`. Un
 * succès de `sendKeys` est un succès de **transport**, pas d'application. Une
 * invite qui reste à l'écran n'a pas reçu de réponse, et le dire est plus utile
 * que d'afficher « envoyé ».
 */
import type { HerdrApi } from "../herdr/HerdrClient.ts";

/**
 * Ce dont répondre à une question a besoin — et rien de plus.
 *
 * ⚠️ **Pourquoi un port étroit.** Prendre tout `HerdrApi` obligerait les tests à
 * fabriquer seize méthodes pour en exercer deux, et le `as unknown as HerdrApi`
 * qui s'ensuit désactive justement la vérification qu'on veut garder. Ici, un
 * faux client de six lignes suffit, et il est **vérifié** par le type.
 */
export type HerdrPourQuestion = Pick<HerdrApi, "readAgent" | "sendKeys">;
import { Effect } from "effect";
import { questionDeLEcran } from "@herdr-remote/shared";

/** Ce qui s'est réellement passé. */
export interface ReponseQuestion {
  /**
   * `appliquee` : l'invite a disparu — la réponse a été prise.
   * `transmise` : la frappe est partie, l'invite est **toujours là**.
   * `refusee` : rien n'a été envoyé, et la cause est nommée.
   */
  readonly state: "appliquee" | "transmise" | "refusee";
  readonly detail: string;
}

/**
 * Le numéro est-il un choix réellement proposé ?
 *
 * Exporté pour être testé seul : c'est la garde qui empêche d'envoyer une
 * décision qui n'existe pas.
 */
export const numeroOffert = (
  choix: ReadonlyArray<{ readonly numero: number }>,
  numero: number,
): boolean => Number.isInteger(numero) && choix.some((c) => c.numero === numero);

/**
 * Répond à la question affichée sur un pane.
 *
 * Ne lève jamais pour un refus : un refus est une **valeur**, pour que la route
 * puisse en faire une réponse lisible.
 */
export const repondreQuestion = (
  herdr: HerdrPourQuestion,
  paneId: string,
  numero: number,
): Effect.Effect<ReponseQuestion, unknown> =>
  Effect.gen(function* () {
    // Lecture **avant** : quelle est la question, et quels choix offre-t-elle ?
    const avant = yield* herdr.readAgent(paneId, 200, "visible");
    const question = questionDeLEcran(avant.text);

    if (question === undefined) {
      return {
        detail: "no readable question on screen — nothing was sent",
        state: "refusee" as const,
      };
    }

    if (!numeroOffert(question.choix, numero)) {
      const offerts = question.choix.map((c) => c.numero).join(", ");
      return {
        detail: `choice ${String(numero)} refused: the question only offers ${offerts} — nothing was sent`,
        state: "refusee" as const,
      };
    }

    // `enter` valide le choix : le numéro seul le sélectionne sans le soumettre.
    yield* herdr.sendKeys(paneId, [String(numero), "enter"]);

    // Relecture : l'application est un **fait observé**, pas une intention.
    const apres = yield* herdr.readAgent(paneId, 200, "visible");
    const choix = question.choix.find((c) => c.numero === numero);
    const libelle = choix?.libelle ?? String(numero);

    if (questionDeLEcran(apres.text) !== undefined) {
      return {
        detail: `“${libelle}” sent — the question is still on screen, so it is not proven applied`,
        state: "transmise" as const,
      };
    }

    return { detail: `“${libelle}” — the agent resumed`, state: "appliquee" as const };
  });
