/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
/**
 * AppShell v2 — Effect-native avec SubscriptionRef.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Effect, SubscriptionRef, Fiber, Stream } from "effect";
import type { Overview, Health } from "../api.ts";
import type { ConversationSummary } from "@herdr-remote/shared";
import { ChatScreen } from "../ChatScreen.tsx";
import { BandeauEtat } from "../EtatLecture.tsx";
import { SettingsSheet } from "../SettingsSheet.tsx";
import { FENETRE_DEMARRAGE_MS, etatLecture } from "../etats.ts";
import { ProjectDetail } from "../ProjectDetail.tsx";
import { ProjectPicker } from "../ProjectPicker.tsx";
import { parseRoute, routeToHash } from "../routing.ts";
import { groupesDe } from "../sections.ts";
import { retenirGroupement } from "../preferences.ts";
import { ConversationRow } from "../ConversationRow.tsx";
import { SectionTitle } from "../SectionTitle.tsx";
import { Notice } from "../Notice.tsx";
import { EVENEMENTS_RAFRAICHISSANTS, doitAppliquer, type Resultat } from "../rafraichissement.ts";
import { BandeauMiseAJour } from "../BandeauMiseAJour.tsx";
import { motion, AnimatePresence } from "./motion.tsx";
import { Chargement } from "../Chargement.tsx";
import { reportError } from "../api.ts";
import { HerdrClientLive } from "./services/HerdrClientLive.ts";
import { createEventStream } from "./services/EventStream.ts";
import { refreshLoop } from "./services/Refresh.ts";
import { createStateRef } from "./state.ts";
import type { AppState } from "./state.ts";
import { useSubscriptionRef } from "./useSubscriptionRef.ts";

const useViewport = (): void => {
  const coquille = useRef({ hauteur: 0, haut: 0 });
  useEffect(() => {
    const viewport = window.visualViewport;
    const applique = (hauteur: number, haut: number): void => {
      if (coquille.current.hauteur === hauteur && coquille.current.haut === haut) return;
      coquille.current = { hauteur, haut };
      document.documentElement.style.setProperty("--app-viewport-height", `${hauteur}px`);
      document.documentElement.style.setProperty("--app-viewport-top", `${haut}px`);
    };
    const syncViewport = () => {
      applique(viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0);
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    document.addEventListener("focusin", syncViewport);
    document.addEventListener("focusout", syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      document.removeEventListener("focusin", syncViewport);
      document.removeEventListener("focusout", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, []);
};

const useHashRoute = (): [AppState["route"], (next: AppState["route"]) => void] => {
  const [route, setRoute] = useState<AppState["route"]>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: AppState["route"]) => {
    const hash = routeToHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute(next);
  }, []);
  return [route, navigate];
};

export const AppShell = () => {
  useViewport();
  const [route, navigate] = useHashRoute();

  const stateRef = useMemo(() => Effect.runSync(createStateRef()), []);

  const overview = useSubscriptionRef(stateRef, (s) => s.overview);
  const health = useSubscriptionRef(stateRef, (s) => s.health);
  const conversations = useSubscriptionRef(stateRef, (s) => s.conversations);
  const error = useSubscriptionRef(stateRef, (s) => s.error);
  const chargement = useSubscriptionRef(stateRef, (s) => s.chargement);
  const dernierSucces = useSubscriptionRef(stateRef, (s) => s.dernierSucces);
  const live = useSubscriptionRef(stateRef, (s) => s.live);
  const kinds = useSubscriptionRef(stateRef, (s) => s.kinds);
  const groupement = useSubscriptionRef(stateRef, (s) => s.groupement);
  const memoire = useSubscriptionRef(stateRef, (s) => s.memoire);
  const maintenant = useSubscriptionRef(stateRef, (s) => s.maintenant);
  const agePage = useSubscriptionRef(stateRef, (s) => s.agePage);
  const reglagesOuverts = useSubscriptionRef(stateRef, (s) => s.reglagesOuverts);
  const projetChoisi = useSubscriptionRef(stateRef, (s) => s.projetChoisi);

  const client = HerdrClientLive;
  const generationAppliquee = useRef(0);

  const updateState = useCallback(
    (updater: (s: AppState) => AppState) => {
      Effect.runSync(SubscriptionRef.update(stateRef, updater));
    },
    [stateRef],
  );

  const applique = useCallback(
    (
      resultat: Resultat<Overview, Health, { conversations: ReadonlyArray<ConversationSummary> }>,
    ) => {
      if (!doitAppliquer(resultat, generationAppliquee.current)) return;
      generationAppliquee.current = resultat.generation;
      updateState((s) => ({
        ...s,
        overview: resultat.overview.ok ? resultat.overview.valeur : s.overview,
        health: resultat.health.ok ? resultat.health.valeur : s.health,
        conversations: resultat.conversations.ok
          ? resultat.conversations.valeur.conversations
          : s.conversations,
        error:
          resultat.overview.ok || resultat.conversations.ok || resultat.health.ok
            ? null
            : (resultat.conversations.cause ?? s.error),
        dernierSucces:
          resultat.overview.ok || resultat.conversations.ok || resultat.health.ok
            ? Date.now()
            : s.dernierSucces,
      }));
      if (!resultat.overview.ok)
        reportError("failed to load the overview", resultat.overview.cause);
    },
    [updateState],
  );

  const refresh = useCallback(async () => {
    updateState((s) => ({ ...s, chargement: true }));
    try {
      let overviewR: { ok: boolean; valeur?: Overview; cause?: string } = {
        ok: false,
        cause: "unknown",
      };
      let healthR: { ok: boolean; valeur?: Health; cause?: string } = {
        ok: false,
        cause: "unknown",
      };
      let convR: {
        ok: boolean;
        valeur?: { conversations: ReadonlyArray<ConversationSummary> };
        cause?: string;
      } = { ok: false, cause: "unknown" };

      try {
        const v = await Effect.runPromise(client.overview());
        overviewR = { ok: true, valeur: v };
      } catch (e) {
        overviewR = { ok: false, cause: String(e) };
      }

      try {
        const v = await Effect.runPromise(client.health());
        healthR = { ok: true, valeur: v };
      } catch (e) {
        healthR = { ok: false, cause: String(e) };
      }

      try {
        const v = await Effect.runPromise(client.conversations());
        convR = { ok: true, valeur: { conversations: v } };
      } catch (e) {
        convR = { ok: false, cause: String(e) };
      }

      const resultat: Resultat<
        Overview,
        Health,
        { conversations: ReadonlyArray<ConversationSummary> }
      > = {
        conversations:
          convR.ok && convR.valeur
            ? { ok: true, valeur: convR.valeur }
            : { ok: false, cause: convR.cause ?? "unknown" },
        generation: ++generationAppliquee.current,
        health:
          healthR.ok && healthR.valeur
            ? { ok: true, valeur: healthR.valeur }
            : { ok: false, cause: healthR.cause ?? "unknown" },
        overview:
          overviewR.ok && overviewR.valeur
            ? { ok: true, valeur: overviewR.valeur }
            : { ok: false, cause: overviewR.cause ?? "unknown" },
      };
      applique(resultat);
    } finally {
      updateState((s) => ({ ...s, chargement: false }));
    }
  }, [applique, client, updateState]);

  useEffect(() => {
    void refresh();
    const fiber = Effect.runFork(
      refreshLoop(
        () => refresh(),
        () => live === "live",
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [live, refresh]);

  useEffect(() => {
    void (async () => {
      try {
        const agentKinds = await Effect.runPromise(client.fetchAgentKinds());
        updateState((s) => ({ ...s, kinds: agentKinds }));
      } catch {
        updateState((s) => ({ ...s, kinds: [] }));
      }
    })();
  }, [client, updateState]);

  useEffect(() => {
    const stream = createEventStream();
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        const svc = yield* stream;
        yield* Stream.runForEach(
          svc.messages,
          (msg: { _tag: string; kind?: string; value?: "live" | "down" }) => {
            if (msg._tag === "status") {
              updateState((s) => ({ ...s, live: msg.value ?? "down" }));
            } else if (msg._tag === "resync") {
              void refresh();
            } else if (
              msg.kind &&
              (EVENEMENTS_RAFRAICHISSANTS as readonly string[]).includes(msg.kind)
            ) {
              void refresh();
            }
            return Effect.void;
          },
        );
      }),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [refresh, updateState]);

  const agents = useMemo(() => overview?.agents ?? [], [overview]);

  useEffect(() => {
    updateState((s) => {
      if (s.memoire.size === agents.length && agents.every((a) => s.memoire.get(a.paneId) === a))
        return s;
      const suivant = new Map(s.memoire);
      for (const a of agents) suivant.set(a.paneId, a);
      return { ...s, memoire: suivant };
    });
  }, [agents, updateState]);

  const selectedAgent =
    route.kind === "agent" ? (agents.find((a) => a.paneId === route.paneId) ?? null) : null;
  const agentMemorise = route.kind === "agent" ? (memoire.get(route.paneId) ?? null) : null;
  const agentAffiche = selectedAgent ?? agentMemorise;
  const agentPerime = selectedAgent === null && agentMemorise !== null;

  const total = conversations.length;
  const etat = etatLecture({
    chargement,
    depuisOuverture: agePage,
    erreur: error,
    live: live === "live",
    total,
    dernierSucces,
  });

  useEffect(() => {
    if (agePage >= FENETRE_DEMARRAGE_MS) return undefined;
    const debut = Date.now();
    const timer = window.setTimeout(() => {
      updateState((s) => ({ ...s, agePage: Date.now() - debut }));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [agePage, updateState]);

  const reessayer = useCallback(() => {
    void refresh();
  }, [refresh]);

  const projetDe = useCallback(
    (workspaceId: string): string =>
      overview?.workspaces.find((w) => w.workspaceId === workspaceId)?.label ?? "Workspace",
    [overview],
  );

  const groupes = useMemo(
    () => groupesDe(conversations, "recent", groupement, projetDe),
    [conversations, groupement, projetDe],
  );

  // --- Render ---
  if (route.kind === "agent" && agentAffiche !== null) {
    const voisins = agents
      .filter((candidat) => candidat.tabId === agentAffiche.tabId)
      .toSorted(
        (a, b) =>
          (a.paneRank ?? Number.MAX_SAFE_INTEGER) - (b.paneRank ?? Number.MAX_SAFE_INTEGER) ||
          a.paneId.localeCompare(b.paneId),
      );
    const conv = conversations.find((c) => c.paneId === agentAffiche.paneId);
    return (
      <div className="app">
        {agentPerime ? (
          <Notice ton="avertissement">
            This agent is no longer visible in Herdr. Showing its last known state.
          </Notice>
        ) : null}
        <ChatScreen
          agent={agentAffiche}
          voisins={voisins}
          onOuvrirVoisin={(paneId) => navigate({ kind: "agent", paneId })}
          currentModel={conv?.model}
          currentProvider={conv?.provider}
          currentThinking={conv?.thinking}
          onBack={() => navigate({ kind: "liste" })}
          question={undefined}
          trust={undefined}
          waiting={conv?.waiting}
        />
      </div>
    );
  }

  if (route.kind === "agent") {
    return (
      <div className="app">
        <header className="topbar">
          <button onClick={() => navigate({ kind: "liste" })} aria-label="Back">
            ←
          </button>
          <h1>Agent</h1>
        </header>
        <main className="app-main">
          <Notice ton="avertissement">This agent no longer exists in Herdr.</Notice>
        </main>
      </div>
    );
  }

  if (route.kind === "projet") {
    const workspace = overview?.workspaces.find((w) => w.workspaceId === route.workspaceId);
    const projetAgents = agents.filter((a) => a.workspaceId === route.workspaceId);
    return (
      <div className="app">
        <ProjectDetail
          workspace={workspace}
          agents={projetAgents}
          kinds={kinds}
          launching={false}
          onLaunch={(_wsId, _kind, _choice) => {
            void _wsId;
            void _kind;
            void _choice;
          }}
          onOpenAgent={(paneId) => navigate({ kind: "agent", paneId })}
          back={() => navigate({ kind: "liste" })}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Conversations</h1>
        <span className="sr-only">connected</span>
        <button
          onClick={() => updateState((s) => ({ ...s, reglagesOuverts: true }))}
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>
      <main className="screen screen--liste">
        <BandeauEtat etat={etat} libelleVide="No conversations" onReessayer={reessayer} />
        {chargement && conversations.length === 0 ? (
          <Chargement texte="Loading conversations…" />
        ) : (
          <div className="conversations">
            <AnimatePresence>
              {groupes.map((groupe) => (
                <motion.section
                  key={groupe.cle}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <SectionTitle count={groupe.conversations.length}>{groupe.titre}</SectionTitle>
                  {groupe.conversations.map((c) => (
                    <motion.div
                      key={c.paneId}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      initial={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.15 }}
                    >
                      <ConversationRow
                        conversation={c}
                        projet={projetDe(c.workspaceId)}
                        onglet=""
                        maintenant={maintenant}
                        onOpen={(paneId) => navigate({ kind: "agent", paneId })}
                      />
                    </motion.div>
                  ))}
                </motion.section>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
      {route.kind === "liste" ? (
        <footer className="app__footer">
          <button
            type="button"
            className="fab"
            onClick={() => updateState((s) => ({ ...s, projetChoisi: true }))}
          >
            + New agent
          </button>
        </footer>
      ) : null}

      <AnimatePresence>
        {reglagesOuverts ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            initial={{ opacity: 0, y: 20 }}
            key="settings"
            transition={{ duration: 0.2 }}
          >
            <SettingsSheet
              health={health}
              onClose={() => updateState((s) => ({ ...s, reglagesOuverts: false }))}
              sansSession={0}
              groupement={groupement}
              onGroupement={(g) => {
                updateState((s) => ({ ...s, groupement: g }));
                retenirGroupement(g);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {projetChoisi ? (
        <ProjectPicker
          onClose={() => updateState((s) => ({ ...s, projetChoisi: false }))}
          onPick={() => updateState((s) => ({ ...s, projetChoisi: false }))}
          workspaces={overview?.workspaces ?? []}
        />
      ) : null}

      <BandeauMiseAJour />
    </div>
  );
};
