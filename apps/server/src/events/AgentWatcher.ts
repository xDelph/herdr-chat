/**
 * Veilleur d'agents — c'est ce qui produit le **direct**.
 *
 * Sans lui, le flux SSE n'émettait que les envois de prompt : l'onglet Activité
 * restait vide et l'interface ne montrait jamais un agent passer de `working` à
 * `done`. Le temps réel n'existait que sur les actions de l'utilisateur, jamais
 * sur ce que font les agents.
 *
 * Le veilleur interroge Herdr à intervalle régulier, **diffe** l'état précédent
 * et ne publie que les changements. Un état republié à l'identique toutes les
 * deux secondes noierait le flux et ferait clignoter l'interface.
 *
 * ⚠️ Herdr expose **une seule** méthode d'attente fiable : `events.wait` sur
 * `pane_agent_status_changed` (les 18 autres variantes du schéma renvoient
 * `unsupported_event_wait_match`, cf. `docs/PROTOCOL.md` §10). On n'utilise donc
 * **pas** `events.wait` chemin par chemin : un abonnement par pane serait
 * fragile et ne couvrirait pas l'apparition de nouveaux panes. La scrutation
 * différentielle est plus simple et couvre tout.
 */
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
import { AgentInfo, TabInfo, WorkspaceInfo } from "@herdr-remote/shared";
import type { EventHubApi } from "../events/EventHub.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import { namingFrom } from "../agents/AgentRegistry.ts";
import type { AgentView, NamingContext } from "../agents/AgentRegistry.ts";

/** Ce qu'on mémorise d'un agent pour détecter un changement. */
const signatureOf = (agent: AgentView): string =>
  [
    agent.status,
    agent.title ?? "",
    agent.cwd ?? "",
    agent.agent ?? "",
    agent.sessionPath ?? "",
  ].join("\u0000");

export interface WatchTick {
  readonly agents: ReadonlyArray<AgentView>;
  readonly changes: ReadonlyArray<{
    readonly paneId: string;
    readonly from: string | null;
    readonly to: string;
    readonly kind: "status" | "appeared" | "disappeared";
  }>;
}

export interface AgentWatcherApi {
  /** Un tour de veille : renvoie la vue à jour et publie les changements. */
  readonly tick: (agents: ReadonlyArray<AgentView>) => Effect.Effect<WatchTick>;
}

export class AgentWatcher extends Context.Service<AgentWatcher, AgentWatcherApi>()(
  "herdr-remote/AgentWatcher",
) {
  static readonly make = (hub: EventHubApi) =>
    Effect.gen(function* () {
      const previous = yield* Ref.make<ReadonlyMap<string, { signature: string; status: string }>>(
        new Map(),
      );

      const tick = (agents: ReadonlyArray<AgentView>) =>
        Ref.modify(previous, (before) => {
          const next = new Map<string, { signature: string; status: string }>();
          const changes: WatchTick["changes"][number][] = [];

          for (const agent of agents) {
            const signature = signatureOf(agent);
            next.set(agent.paneId, { signature, status: agent.status });
            const old = before.get(agent.paneId);
            if (old === undefined) {
              // Premier passage : on n'annonce pas « apparu » pour tout le parc,
              // sinon chaque démarrage produirait une rafale d'événements.
              if (before.size > 0) {
                changes.push({
                  from: null,
                  kind: "appeared",
                  paneId: agent.paneId,
                  to: agent.status,
                });
              }
            } else if (old.signature !== signature) {
              changes.push({
                from: old.status,
                kind: "status",
                paneId: agent.paneId,
                to: agent.status,
              });
            }
          }

          for (const paneId of before.keys()) {
            if (!next.has(paneId)) {
              changes.push({
                from: before.get(paneId)?.status ?? null,
                kind: "disappeared",
                paneId,
                to: "gone",
              });
            }
          }

          return [{ agents, changes }, next];
        }).pipe(
          Effect.tap((result) =>
            Effect.forEach(
              result.changes,
              (change) =>
                hub.publish("agent_status", {
                  from: change.from,
                  kind: change.kind,
                  paneId: change.paneId,
                  to: change.to,
                }),
              { discard: true },
            ),
          ),
        );

      return AgentWatcher.of({ tick });
    });

  static readonly layer = (hub: EventHubApi) => Layer.effect(AgentWatcher, AgentWatcher.make(hub));
}

/**
 * Boucle de veille : publie les changements **et** met en cache la dernière vue.
 *
 * Le dernier état est gardé en mémoire pour que `/api/overview` puisse répondre
 * immédiatement, sans interroger Herdr à chaque requête — l'iPhone rafraîchit
 * souvent et Herdr n'a pas à payer pour chaque client.
 */
export interface WatchLoop {
  readonly lastAgents: () => Effect.Effect<ReadonlyArray<AgentView>>;
  readonly lastAt: () => Effect.Effect<number>;
  readonly errorCount: () => Effect.Effect<number>;
}

/** Forme utile de `session.snapshot` : agents **et** contexte de nommage. */
const WatchSnapshot = Schema.Struct({
  agents: Schema.Array(AgentInfo),
  tabs: Schema.optional(Schema.Array(TabInfo)),
  workspaces: Schema.optional(Schema.Array(WorkspaceInfo)),
});
const decodeWatchSnapshot = Schema.decodeUnknownOption(WatchSnapshot);

/**
 * Extrait du `session.snapshot` brut ce dont la veille a besoin.
 *
 * ⚠️ `snapshot()` renvoie le `result` brut : les agents sont sous
 * `snapshot.agents`, PAS sous `agents`. Lire le mauvais niveau donne une liste
 * vide à chaque tour, et le veilleur ne détecte donc jamais rien.
 *
 * Une forme inattendue est **signalée**, jamais silencieusement transformée en
 * liste vide — c'est précisément ce silence qui a masqué le défaut.
 */
const decodeWatch = (payload: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const decoded = Option.getOrUndefined(decodeWatchSnapshot(payload["snapshot"]));
    if (decoded === undefined) {
      return yield* Effect.fail("snapshot sans `agents` exploitable");
    }
    return {
      agents: decoded.agents,
      naming: namingFrom(decoded.workspaces ?? [], decoded.tabs ?? []),
    };
  });

export const startWatchLoop = (
  herdr: HerdrApi,
  watcher: AgentWatcherApi,
  buildViews: (
    agents: ReadonlyArray<AgentInfo>,
    naming?: NamingContext,
  ) => Effect.Effect<ReadonlyArray<AgentView>>,
  intervalMs = 2_000,
) =>
  Effect.gen(function* () {
    const cache = yield* Ref.make<ReadonlyArray<AgentView>>([]);
    const lastAt = yield* Ref.make(0);
    const errors = yield* Ref.make(0);

    const once = Effect.gen(function* () {
      const payload = yield* herdr.snapshot();
      const { agents, naming } = yield* decodeWatch(payload);
      // Le nommage vient du **même** snapshot : le cache du veilleur porte donc
      // les libellés, et l'écran n'affiche plus d'identifiants de pane.
      const views = yield* buildViews(agents, naming);
      const result = yield* watcher.tick(views);
      if (result.changes.length > 0) {
        yield* Effect.logInfo(
          `veille : ${result.changes.length} changement(s) — ${result.changes
            .map((c) => `${c.paneId} ${c.from ?? "-"}→${c.to}`)
            .join(", ")}`,
        );
      }
      yield* Ref.set(cache, result.agents);
      yield* Ref.set(lastAt, Date.now());
      return result;
    });

    const loop = Effect.gen(function* () {
      for (;;) {
        yield* once.pipe(
          Effect.catch((error) =>
            Effect.andThen(
              Ref.update(errors, (n) => n + 1),
              Effect.logWarning(`veille : Herdr injoignable (${String(error).slice(0, 80)})`),
            ),
          ),
        );
        yield* Effect.sleep(`${intervalMs} millis`);
      }
    });

    yield* Effect.forkScoped(loop);

    return {
      errorCount: () => Ref.get(errors),
      lastAgents: () => Ref.get(cache),
      lastAt: () => Ref.get(lastAt),
    } satisfies WatchLoop;
  });
