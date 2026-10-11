/**
 * Bus d'événements vers la PWA.
 *
 * Herdr ne fournit **aucun compteur de rattrapage exploitable** : `revision`
 * vaut `0` en permanence et `events.wait` n'implémente pas `pane_output_changed`
 * (E3, `docs/PROTOCOL.md` §10). Le rattrapage est donc assuré **ici**, par un
 * journal borné à identifiants monotones : un client qui se reconnecte avec son
 * dernier identifiant reçoit exactement ce qu'il a manqué.
 *
 * Le journal est **borné** : au-delà de `capacity`, les plus anciens événements
 * disparaissent. Un client trop en retard reçoit alors `resync`, ce qui lui
 * ordonne de recharger l'état complet plutôt que de croire à une continuité
 * qu'on ne peut pas garantir. Un trou silencieux serait pire qu'un resync.
 */
import { Context, Effect, Layer, Ref } from "effect";

export interface BusEvent {
  readonly id: number;
  readonly kind: string;
  readonly at: number;
  readonly data: unknown;
}

export interface CatchUp {
  readonly events: ReadonlyArray<BusEvent>;
  /** `true` quand la continuité n'est pas garantie (client trop en retard). */
  readonly resyncRequired: boolean;
  /** Dernier identifiant émis. À utiliser comme curseur après un `resync`. */
  readonly resumeFrom: number;
}

export interface EventHubApi {
  readonly publish: (kind: string, data: unknown) => Effect.Effect<BusEvent>;
  /** Événements strictement postérieurs à `sinceId`, avec état de continuité. */
  readonly since: (sinceId: number) => Effect.Effect<CatchUp>;
  readonly lastId: () => Effect.Effect<number>;
}

export class EventHub extends Context.Service<EventHub, EventHubApi>()("herdr-remote/EventHub") {
  static readonly make = (capacity = 500) =>
    Effect.gen(function* () {
      const state = yield* Ref.make<{ nextId: number; events: ReadonlyArray<BusEvent> }>({
        events: [],
        nextId: 1,
      });

      const publish = (kind: string, data: unknown) =>
        Ref.modify(state, ({ events, nextId }) => {
          const event: BusEvent = { at: Date.now(), data, id: nextId, kind };
          const merged = [...events, event];
          return [
            event,
            {
              events: merged.length > capacity ? merged.slice(merged.length - capacity) : merged,
              nextId: nextId + 1,
            },
          ];
        });

      const since = (sinceId: number) =>
        Ref.get(state).pipe(
          Effect.map(({ events, nextId }) => {
            const oldest = events[0]?.id;
            // Le client demande un point plus ancien que ce qu'on conserve :
            // la continuité est rompue, il faut resynchroniser.
            const resyncRequired = sinceId > 0 && oldest !== undefined && sinceId < oldest - 1;
            return {
              events: events.filter((event) => event.id > sinceId),
              resyncRequired,
              // **L'ID courant** accompagne le resync (B04) : le client doit
              // repartir de là, sinon il redemande le même point et reçoit un
              // second resync à la boucle suivante.
              resumeFrom: nextId - 1,
            };
          }),
        );

      const lastId = () => Ref.get(state).pipe(Effect.map(({ nextId }) => nextId - 1));

      return EventHub.of({ lastId, publish, since });
    });

  static readonly layer = Layer.effect(EventHub, EventHub.make());
}
