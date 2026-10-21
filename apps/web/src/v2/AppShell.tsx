/**
 * AppShell v2 — Effect-native.
 *
 * Migration en cours : on remplace progressivement useState/fetch/setTimeout
 * par SubscriptionRef/Effect services/Fiber. Cette version utilise les services
 * Effect pour le réseau et le flux SSE, tout en gardant useState pour l'état
 * (la migration vers SubscriptionRef est la prochaine étape).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Overview, Health, InstalledKind, AgentView } from "../api.ts";
import type { Route } from "../routing.ts";
import { reportError } from "../api.ts";
import type { ConversationSummary } from "@herdr-remote/shared";
import { ChatScreen } from "../ChatScreen.tsx";
import { BandeauEtat } from "../EtatLecture.tsx";
import { SettingsSheet } from "../SettingsSheet.tsx";
import { FENETRE_DEMARRAGE_MS, etatLecture } from "../etats.ts";
import { ProjectDetail } from "../ProjectDetail.tsx";
import { parseRoute, routeToHash } from "../routing.ts";
import { groupesDe } from "../sections.ts";
import type { Ordre } from "../sections.ts";
import { lireGroupement, retenirGroupement, type Groupement } from "../preferences.ts";
import { ConversationRow } from "../ConversationRow.tsx";
import { SectionTitle } from "../SectionTitle.tsx";
import { Notice } from "../Notice.tsx";
import { EVENEMENTS_RAFRAICHISSANTS, doitAppliquer, type Resultat } from "../rafraichissement.ts";
import { BandeauMiseAJour } from "../BandeauMiseAJour.tsx";
import { Chargement } from "../Chargement.tsx";
// useHashRoute defined locally below
import { HerdrClientLive } from "./services/HerdrClientLive.ts";
import { createEventStream } from "./services/EventStream.ts";
import { refreshLoop } from "./services/Refresh.ts";
import { Effect } from "effect";
import { Fiber } from "effect";
import { Stream } from "effect";

// Hooks
const useViewport = (): void => {
  useEffect(() => {
    const viewport = window.visualViewport;
    const applique = (hauteur: number, haut: number): void => {
      document.documentElement.style.setProperty("--app-viewport-height", `${hauteur}px`);
      document.documentElement.style.setProperty("--app-viewport-top", `${haut}px`);
    };
    const sync = () => {
      applique(viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0);
    };
    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    window.addEventListener("resize", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
};

export const AppShell = () => {
  useViewport();
  const [route, navigate] = useHashRoute();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<"live" | "down">("down");
  const [conversations, setConversations] = useState<ReadonlyArray<ConversationSummary>>([]);
  const [reglagesOuverts, setReglagesOuverts] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [dernierSucces, setDernierSucces] = useState<number | null>(null);
  const [groupement, setGroupement] = useState<Groupement>(lireGroupement);
  const ordre: Ordre = "recent";
  const [kinds, setKinds] = useState<readonly InstalledKind[]>([]);
  const [memoire, setMemoire] = useState<ReadonlyMap<string, AgentView>>(() => new Map());
  const [maintenant] = useState<number>(() => Date.now());
  const [agePage, setAgePage] = useState(0);
  const debutPage = useRef<number | null>(null);

  // Effect-based client
  const client = HerdrClientLive;

  const generationAppliquee = useRef(0);

  const applique = useCallback(
    (
      resultat: Resultat<Overview, Health, { conversations: ReadonlyArray<ConversationSummary> }>,
    ) => {
      if (!doitAppliquer(resultat, generationAppliquee.current)) return;
      generationAppliquee.current = resultat.generation;
      if (resultat.overview.ok) setOverview(resultat.overview.valeur);
      else reportError("failed to load the overview", resultat.overview.cause);
      if (resultat.health.ok) setHealth(resultat.health.valeur);
      if (resultat.conversations.ok) setConversations(resultat.conversations.valeur.conversations);
      else if (!resultat.overview.ok) setError(resultat.conversations.cause);
      if (resultat.overview.ok || resultat.conversations.ok || resultat.health.ok) {
        setDernierSucces(Date.now());
        setError(null);
      }
    },
    [],
  );

  // Fetch via Effect service (replaces creeClient)
  const refresh = useCallback(async () => {
    setChargement(true);
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
      setChargement(false);
    }
  }, [applique, client]);

  // Effect-based refresh loop (replaces setTimeout cascade)
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

  // Agent kinds
  useEffect(() => {
    void (async () => {
      try {
        const agentKinds = await Effect.runPromise(client.fetchAgentKinds());
        setKinds(agentKinds);
      } catch {
        setKinds([]);
      }
    })();
  }, [client]);

  // SSE via Effect Stream (replaces openEventStream + creeRegroupement)
  useEffect(() => {
    const stream = createEventStream();
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        const svc = yield* stream;
        yield* Stream.runForEach(
          svc.messages,
          (msg: { _tag: string; kind?: string; value?: "live" | "down" }) => {
            if (msg._tag === "status") {
              setLive(msg.value ?? "down");
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
  }, [refresh]);

  const agents = useMemo(() => overview?.agents ?? [], [overview]);

  useEffect(() => {
    setMemoire((precedent) => {
      if (precedent.size === agents.length && agents.every((a) => precedent.get(a.paneId) === a))
        return precedent;
      const suivant = new Map(precedent);
      for (const a of agents) suivant.set(a.paneId, a);
      return suivant;
    });
  }, [agents]);

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
    if (debutPage.current === null) debutPage.current = Date.now();
    if (agePage >= FENETRE_DEMARRAGE_MS) return undefined;
    const debut = debutPage.current;
    const timer = window.setTimeout(() => setAgePage(Date.now() - debut), 500);
    return () => window.clearTimeout(timer);
  }, [agePage]);

  const reessayer = useCallback(() => {
    void refresh();
  }, [refresh]);

  const projetDe = useCallback(
    (workspaceId: string): string =>
      overview?.workspaces.find((w) => w.workspaceId === workspaceId)?.label ?? "Workspace",
    [overview],
  );

  const groupes = useMemo(
    () => groupesDe(conversations, ordre, groupement, projetDe),
    [conversations, ordre, groupement, projetDe],
  );

  // --- Render ---
  if (route.kind === "agent") {
    const agent = memoire.get(route.paneId) ?? agents.find((a) => a.paneId === route.paneId);
    if (agent) {
      const voisins = agents
        .filter((a) => a.tabId === agent.tabId)
        .toSorted(
          (a, b) => (a.paneRank ?? 999) - (b.paneRank ?? 999) || a.paneId.localeCompare(b.paneId),
        );
      const conv = conversations.find((c) => c.paneId === agent.paneId);
      return (
        <div className="app">
          <ChatScreen
            agent={agent}
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
    return (
      <div className="app">
        <header className="app-header">
          <button onClick={() => navigate({ kind: "liste" })} aria-label="Back">
            ←
          </button>
          <h1>Agent</h1>
        </header>
        <main className="app-main">
          <Notice ton="avertissement">This agent is no longer visible in Herdr.</Notice>
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
      <header className="app-header">
        <h1>Conversations</h1>
        <button onClick={() => setReglagesOuverts(true)} aria-label="Settings">
          ⚙
        </button>
      </header>
      <main className="app-main">
        <BandeauEtat etat={etat} libelleVide="No conversations" onReessayer={reessayer} />
        {chargement && conversations.length === 0 ? (
          <Chargement texte="Loading conversations…" />
        ) : (
          <div className="conversations">
            {groupes.map((groupe) => (
              <section key={groupe.cle}>
                <SectionTitle count={groupe.conversations.length}>{groupe.titre}</SectionTitle>
                {groupe.conversations.map((c) => (
                  <ConversationRow
                    key={c.paneId}
                    conversation={c}
                    projet={projetDe(c.workspaceId)}
                    onglet=""
                    maintenant={maintenant}
                    onOpen={(paneId) => navigate({ kind: "agent", paneId })}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </main>
      {reglagesOuverts ? (
        <SettingsSheet
          health={health}
          onClose={() => setReglagesOuverts(false)}
          sansSession={0}
          groupement={groupement}
          onGroupement={(g) => {
            setGroupement(g);
            retenirGroupement(g);
          }}
        />
      ) : null}
      <BandeauMiseAJour />
    </div>
  );
};

// Keep useHashRoute defined locally (used by AppShell)
const useHashRoute = (): [Route, (next: Route) => void] => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute(next);
  }, []);
  return [route, navigate];
};

export { useHashRoute };
