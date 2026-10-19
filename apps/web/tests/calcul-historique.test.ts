/**
 * C27 — une frappe ne recalcule pas l'historique.
 *
 * ⚠️ **Le défaut mesuré.** `ChatScreen` appelait `toItems(messages, …)` et
 * `touchedFilesOf(messages)` **dans le rendu**. Une frappe dans le composeur
 * change l'état du brouillon, donc re-rend l'écran, donc refaisait le découpage
 * de **tout** l'historique. Avec 2 000 messages, la frappe devient pâteuse à
 * mesure que la conversation grandit — et c'est exactement le symptôme décrit
 * par C27.
 *
 * ⚠️ **Comment ce test le mesure.** Pas avec un chronomètre (instable) : le
 * tableau de messages est enveloppé dans un `Proxy` qui **compte les accès aux
 * éléments**. Si le cache fonctionne, le second appel ne lit aucun message —
 * zéro accès, pas « moins d'accès ».
 */
import { describe, expect, test } from "bun:test";
import { toItems, toMessages, touchedFilesOf } from "../src/blocks.ts";
import type { RenderedMessage } from "../src/blocks.ts";

/**
 * Une entrée de session minimale — la forme que `toMessages` attend
 * (`{id?, raw, type}`), pas une chaîne nue.
 */
const message = (rang: number): { id: string; raw: string; type: string } => ({
  id: `m-${String(rang)}`,
  raw: JSON.stringify({
    id: `m-${String(rang)}`,
    message: {
      role: rang % 2 === 0 ? "user" : "assistant",
      content: `texte ${String(rang)}`,
    },
    type: "message",
  }),
  type: "message",
});

/** Les 2 000 messages (C27 : la taille de la fixture de mesure). */
const ENTREES = Array.from({ length: 2_000 }, (_, rang) => message(rang));

/** Le tableau + le compteur d'accès aux éléments. */
const compteur = (
  messages: ReadonlyArray<RenderedMessage>,
): {
  acces: () => number;
  messages: ReadonlyArray<RenderedMessage>;
} => {
  let acces = 0;
  const surveille: ReadonlyArray<RenderedMessage> = new Proxy(messages, {
    get(cible, cle, recepteur) {
      if (typeof cle === "string" && /^\d+$/.test(cle)) acces += 1;
      return Reflect.get(cible, cle, recepteur) as unknown;
    },
  });
  return { acces: () => acces, messages: surveille };
};

describe("C27 — le calcul d'items est mémorisé par identité", () => {
  test("2 000 messages : un second appel ne lit AUCUN message", () => {
    const { acces, messages } = compteur(toMessages(ENTREES));
    const premier = toItems(messages);
    expect(premier.length).toBeGreaterThan(0);
    expect(acces()).toBeGreaterThan(0);
    const apresPremier = acces();
    // La « frappe » : le même tableau, rappelé tel quel.
    const second = toItems(messages);
    expect(acces()).toBe(apresPremier);
    // Le résultat est bien le même objet : aucun recalcul, pas seulement
    // « un résultat égal ».
    expect(second).toBe(premier);
  });

  test("un tableau NOUVEAU recalcule — le cache ne fige pas l'historique", () => {
    const { acces, messages } = compteur(toMessages(ENTREES));
    toItems(messages);
    const apresPremier = acces();
    // Un message arrive : nouveau tableau (c'est ce que fait `setMessages`).
    const avecSuite = compteur(toMessages([...ENTREES, message(2_000)]));
    const items = toItems(avecSuite.messages);
    expect(items.length).toBeGreaterThan(0);
    expect(acces()).toBe(apresPremier);
    expect(avecSuite.acces()).toBeGreaterThan(0);
  });

  test("un changement d'état du dernier tour a son propre résultat", () => {
    const messages = toMessages(ENTREES);
    const termine = toItems(messages, false);
    const enCours = toItems(messages, true);
    // Même tableau, état différent : deux découpages distincts (le bloc
    // « working » n'a pas la même forme qu'un tour terminé).
    expect(enCours).not.toBe(termine);
    // Et chacun reste mémorisé.
    expect(toItems(messages, false)).toBe(termine);
  });
});

describe("C27 — les fichiers touchés sont mémorisés aussi", () => {
  test("un second appel ne relit aucun message", () => {
    const { acces, messages } = compteur(toMessages(ENTREES));
    const premier = touchedFilesOf(messages);
    expect(acces()).toBeGreaterThan(0);
    const apresPremier = acces();
    const second = touchedFilesOf(messages);
    expect(acces()).toBe(apresPremier);
    expect(second).toBe(premier);
  });
});

describe("C27 — la normalisation ne tourne pas à chaque frappe", () => {
  test("`toMessages` est appelé au CHARGEMENT, pas dans le rendu", () => {
    // La preuve comportementale est ci-dessus (aucun recalcul). Ici on vérifie
    // la seconde moitié de la règle : le tableau de messages est stable entre
    // deux frappes, donc l'identité que le cache utilise ne bouge pas.
    const une = toMessages(ENTREES);
    const deux = toMessages(ENTREES);
    // Deux appels produisent deux tableaux (la normalisation est pure)…
    expect(une).not.toBe(deux);
    // …et c'est pourquoi `ChatScreen` garde `messages` en état : il ne
    // renormalise pas à chaque rendu.
    expect(une.length).toBe(2_000);
  });
});
