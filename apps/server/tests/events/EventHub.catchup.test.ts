/**
 * Rattrapage du flux d'événements (B04).
 *
 * Le client trop en retard doit recevoir **un seul** `resync`, jamais deux,
 * et jamais un trou silencieux. Ce fichier teste la règle depuis le journal
 * jusqu'au texte émis sur le flux.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { EventHub } from "../../src/events/EventHub.ts";
import type { EventHubApi } from "../../src/events/EventHub.ts";

const nouveauHub = async (capacity = 500) => Effect.runPromise(EventHub.make(capacity));

/**
 * Publie dix événements : plus que la capacité de 3, c'est ce qui fait
 * tomber les plus anciens du journal.
 */
const publierDix = async (hub: EventHubApi) =>
  Effect.runPromise(
    Effect.all(
      Array.from({ length: 10 }, (_, i) => hub.publish("status", { i })),
      { discard: true },
    ),
  );

describe("B04 — resync unique et cursoré", () => {
  test("un curseur à jour ne déclenche aucun resync", async () => {
    const hub = await nouveauHub();
    await Effect.runPromise(hub.publish("ready", {}));
    await Effect.runPromise(hub.publish("status", {}));
    const last = await Effect.runPromise(hub.lastId());

    const catchUp = await Effect.runPromise(hub.since(last));
    expect(catchUp.resyncRequired).toBe(false);
  });

  test("un curseur trop ancien déclenche le resync et repart de l'ID courant", async () => {
    const hub = await nouveauHub(3);
    // On publie plus d'événements que la capacité : les plus anciens tombent.
    await publierDix(hub);

    const catchUp = await Effect.runPromise(hub.since(1));
    expect(catchUp.resyncRequired).toBe(true);
    // L'ID courant permet au client de repartir juste après le trou.
    expect(catchUp.resumeFrom).toBe(10);
  });

  /**
   * **Le défaut que B04 corrige.** Avant, le `resync` portait `resyncRequired`
   * mais pas de nouveau curseur : la boucle SSE réinterrogeait le même point
   * toutes les 300 ms et réémettait le même resync à l'infini. Avec
   * `resumeFrom`, le client avance et le flux redevient silencieux.
   */
  test("après le resync, le curseur avancé ne redemande plus de resync", async () => {
    const hub = await nouveauHub(3);
    await publierDix(hub);

    const premier = await Effect.runPromise(hub.since(1));
    expect(premier.resyncRequired).toBe(true);

    // Le client suit la consigne et repart de `resumeFrom`.
    const second = await Effect.runPromise(hub.since(premier.resumeFrom));
    expect(second.resyncRequired).toBe(false);
  });

  test("aucun événement manqué n'est renvoyé deux fois", async () => {
    const hub = await nouveauHub();
    await Effect.runPromise(hub.publish("a", {}));
    await Effect.runPromise(hub.publish("b", {}));
    await Effect.runPromise(hub.publish("c", {}));

    const depuisDebut = await Effect.runPromise(hub.since(0));
    expect(depuisDebut.events.map((event) => event.kind)).toEqual(["a", "b", "c"]);

    // Le client a reçu `a`, demande la suite : il ne doit pas revoir `a`.
    const aRecu = depuisDebut.events[0];
    expect(aRecu).toBeDefined();
    const suite = await Effect.runPromise(hub.since(aRecu?.id ?? 0));
    expect(suite.events.map((event) => event.kind)).toEqual(["b", "c"]);
  });

  test("un curseur 0 n'est jamais un resync", async () => {
    // 0 signifie « nouveau client », pas « trop en retard ».
    const hub = await nouveauHub(2);
    await publierDix(hub);
    const catchUp = await Effect.runPromise(hub.since(0));
    expect(catchUp.resyncRequired).toBe(false);
  });
});
