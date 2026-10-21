/**
 * AppShell — seul propriétaire de la route, du flux SSE et de l'overview.
 *
 * Phase 0 : on garde la logique existante (rafraîchissement, SSE, mémoire)
 * mais on l'organise dans un module dédié. La migration vers Effect (streams,
 * fibers, SubscriptionRef) se fait en Phase 1–2.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAgentKinds,
  fetchConversations,
  fetchHealth,
  fetchOverview,
  openEventStream,
  reportError,
} from "../api.ts";
import type { Overview, Health, InstalledKind, AgentView } from "../api.ts";
import type { ConversationSummary } from "@herdr-remote/shared";
import { ChatScreen } from "../ChatScreen.tsx";
import { BandeauEtat } from "../EtatLecture.tsx";
import { SettingsSheet } from "../SettingsSheet.tsx";
import { FENETRE_DEMARRAGE_MS, etatLecture } from "../etats.ts";
import { ProjectDetail } from "../ProjectDetail.tsx";
// launch/trust unused in v2 shell for now
import { parseRoute, routeToHash } from "../routing.ts";
import { groupesDe } from "../sections.ts";
import type { Ordre } from "../sections.ts";
import { lireGroupement, retenirGroupement, type Groupement } from "../preferences.ts";
import { ConversationRow } from "../ConversationRow.tsx";
import { SectionTitle } from "../SectionTitle.tsx";
// ProjectPicker unused in v2 shell for now
import type { Route } from "../routing.ts";
import { Notice } from "../Notice.tsx";
import {
  EVENEMENTS_RAFRAICHISSANTS,
  cadence,
  creeClient,
  creeRegroupement,
  doitAppliquer,
  type Resultat,
} from "../rafraichissement.ts";
// miseAJourEnAttente unused in v2 shell for now
import { BandeauMiseAJour } from "../BandeauMiseAJour.tsx";
import { Chargement } from "../Chargement.tsx";
// (already imported above)

// Re-use the viewport hook logic inline (will be extracted in P0.x)
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

  const client = useMemo(
    () =>
      creeClient({
        conversations: fetchConversations,
        health: fetchHealth,
        overview: fetchOverview,
      }),
    [],
  );
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

  const refresh = useCallback(async () => {
    setChargement(true);
    try {
      applique(await client.lit());
    } finally {
      setChargement(false);
    }
  }, [applique, client]);

  useEffect(() => {
    void refresh();
    let timer: number | null = null;
    const programme = (): void => {
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(
        () => {
          void refresh();
        },
        cadence(document.visibilityState === "visible", live === "live"),
      );
    };
    const surVisibilite = (): void => {
      programme();
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    programme();
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [live, refresh]);

  useEffect(() => {
    void (async () => {
      try {
        setKinds(await fetchAgentKinds());
      } catch {
        setKinds([]);
      }
    })();
  }, []);

  useEffect(() => {
    const regroupement = creeRegroupement(() => {
      void refresh();
    });
    const fermer = openEventStream({
      onEvent: (kind: string) => {
        if ((EVENEMENTS_RAFRAICHISSANTS as readonly string[]).includes(kind))
          regroupement.signale();
      },
      onResync: () => {
        void refresh();
      },
      onStatus: setLive,
    });
    return () => {
      regroupement.annule();
      fermer();
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
    // Agent never seen
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
            /* launch logic */
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

  // Liste (default)
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

/** Lit le fragment courant et se resynchronise sur les navigations. */
const useHashRoute = (): [Route, (next: Route) => void] => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next);
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
    setRoute(next);
  }, []);

  return [route, navigate];
};
