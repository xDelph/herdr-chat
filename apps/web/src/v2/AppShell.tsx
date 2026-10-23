/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
/* oxlint-disable react-perf/jsx-no-jsx-as-prop */
/**
 * AppShell v2 — Effect-native avec SubscriptionRef.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Effect, SubscriptionRef, Fiber, Stream } from "effect";
import type { Overview, Health } from "../api.ts";
import type { ConversationSummary } from "@herdr-remote/shared";
import { lazy, Suspense } from "react";
const ChatScreen = lazy(async () => {
  const m = await import("../ChatScreen.tsx");
  return { default: m.ChatScreen };
});
import { BandeauEtat } from "../EtatLecture.tsx";
import { SettingsSheet } from "../SettingsSheet.tsx";
import { FENETRE_DEMARRAGE_MS, etatLecture } from "../etats.ts";
import { ProjectDetail } from "../ProjectDetail.tsx";
import { ProjectPicker } from "../ProjectPicker.tsx";
import { parseRoute, routeToHash } from "../routing.ts";
import { ORDRE_LABEL, groupesDe } from "../sections.ts";
import { retenirGroupement } from "../preferences.ts";
import { ConversationRow } from "../ConversationRow.tsx";
import { SectionTitle } from "../SectionTitle.tsx";
import { Notice } from "../Notice.tsx";
import { EVENEMENTS_RAFRAICHISSANTS, doitAppliquer, type Resultat } from "../rafraichissement.ts";
import { BandeauMiseAJour } from "../BandeauMiseAJour.tsx";
import { miseAJourEnAttente } from "../mise-a-jour.ts";
import { motion, AnimatePresence } from "./motion.tsx";
import { Skeleton } from "../Skeleton.tsx";
import { TrustRequiredError, launchAgent, reportError } from "../api.ts";
import type { TrustRequired } from "../api.ts";
import type { LaunchChoice } from "../launch.ts";
import { TrustCard } from "../TrustCard.tsx";
import { HerdrClientLive } from "./services/HerdrClientLive.ts";
import { createEventStream } from "./services/EventStream.ts";
import { refreshLoop } from "./services/Refresh.ts";
import { createStateRef } from "./state.ts";
import type { AppState } from "./state.ts";
import { useSubscriptionRef } from "./useSubscriptionRef.ts";

/**
 * L'état de connexion, dit en un mot — le même vocabulaire que la v1.
 *
 * ⚠️ **Ce n'est pas décoratif** : le shell v2 affichait `connected` en dur
 * (`sr-only`), donc annonçait une connexion même flux coupé. Un état qu'on ne
 * peut pas vérifier ne doit pas être affiché — ici il est calculé.
 */
type Connexion = "live" | "reconnexion" | "hors-ligne" | "inconnu";

const LIBELLE_CONNEXION: Record<Connexion, string> = {
  live: "connected",
  reconnexion: "reconnecting",
  "hors-ligne": "offline",
  inconnu: "unknown status",
};

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

/**
 * La route vit dans le **fragment d'URL** — une seule source, partageable.
 *
 * ⚠️ `AppState.route` a été retiré : il doublonnait la route sans jamais être lu
 * (le vrai propriétaire est le hash, et c'est ce qui rend un lien ouvrable).
 */
type Route = ReturnType<typeof parseRoute>;

const useHashRoute = (): [Route, (next: Route) => void] => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next);
    const doNavigate = () => {
      if (window.location.hash !== hash) window.location.hash = hash;
      setRoute(next);
    };
    // View Transitions API (progressive enhancement)
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(doNavigate);
    } else {
      doNavigate();
    }
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
  /*
    ⚠️ **DEUX compteurs, et pas un seul.** `generationAppliquee` retient la
    dernière génération ACCEPTÉE ; `prochaineGeneration` produit les numéros.
    Le shell n'en avait qu'un : il faisait `generation: ++generationAppliquee`
    dans la lecture, puis `doitAppliquer` comparait `generation > appliquee` —
    égalité stricte, donc **faux à chaque fois**. Toutes les lectures étaient
    jetées : liste vide, statut inconnu, réglages « Herdr illisible », alors que
    `/api/overview`, `/api/health` et `/api/conversations` répondaient 200.
  */
  const generationAppliquee = useRef(0);
  const prochaineGeneration = useRef(0);

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
        generation: ++prochaineGeneration.current,
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

  /*
    ⚠️ **La recherche et l'ordre sont revenus.** Le shell v2 les avait perdus en
    remplaçant `App.tsx` : la liste se triait toujours « récent », et filtrer
    vingt conversations demandait de faire défiler. La recherche porte sur ce que
    la ligne affiche DÉJÀ (agent, dernier message, modèle, nom) : aucune requête
    en plus, ces champs arrivent avec la liste.
  */
  const [recherche, setRecherche] = useState("");
  const ordre = useSubscriptionRef(stateRef, (s) => s.ordre);
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [trustRequest, setTrustRequest] = useState<TrustRequired | null>(null);

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

  /*
    ⚠️ **La question, l'invite de confiance et l'attente viennent de la LISTE.**
    La v2 les passait à `undefined` en dur : un agent `blocked` n'affichait donc
    ni sa question ni sa carte de confiance, et un agent qui attendait sur un
    formulaire sans choix numéroté (opencode) n'affichait rien du tout. Elles
    suivent le même rafraîchissement que la liste, donc elles disparaissent
    d'elles-mêmes dès que l'agent reprend.
  */
  const ligneDe = (paneId: string | undefined) =>
    paneId === undefined ? undefined : conversations.find((ligne) => ligne.paneId === paneId);

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

  /**
   * L'état de connexion affiché — calculé, jamais supposé.
   */
  const connexion: Connexion =
    etat.phase === "erreur" || etat.phase === "hors-ligne"
      ? "hors-ligne"
      : etat.phase === "reconnexion"
        ? "reconnexion"
        : live === "live"
          ? "live"
          : "inconnu";

  /**
   * L'horloge des lignes.
   *
   * ⚠️ **Sans elle, « il y a 2 min » se fige au chargement.** `maintenant` était
   * dans l'état mais n'était jamais réécrit : les âges relatifs restaient ceux de
   * l'ouverture, indéfiniment. On la met à jour à chaque lecture (elle suit la
   * veille) et par une horloge de 30 s au repos.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      updateState((s) => ({ ...s, maintenant: Date.now() }));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [updateState]);

  const lancer = useCallback(
    (workspaceId: string, kind: string, choice: LaunchChoice) => {
      void (async () => {
        setLaunching(workspaceId);
        setLaunchError(null);
        setTrustRequest(null);
        try {
          const demarre = await launchAgent(workspaceId, kind, choice);
          navigate({ kind: "agent", paneId: demarre.paneId });
          await refresh();
        } catch (cause: unknown) {
          // L'invite de confiance a son propre affichage : elle n'est pas une erreur.
          if (cause instanceof TrustRequiredError) {
            setTrustRequest(cause.request);
          } else {
            const message = cause instanceof Error ? cause.message : String(cause);
            setLaunchError(message);
            reportError("failed to launch an agent", { kind, message, workspaceId });
          }
        } finally {
          setLaunching(null);
        }
      })();
    },
    [navigate, refresh],
  );

  const projetDe = useCallback(
    (workspaceId: string): string =>
      overview?.workspaces.find((w) => w.workspaceId === workspaceId)?.label ?? "Workspace",
    [overview],
  );

  const conversationsFiltrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (terme.length === 0) return conversations;
    return conversations.filter((conversation) =>
      [conversation.agent, conversation.lastPrompt, conversation.model, conversation.name]
        .filter((champ): champ is string => typeof champ === "string")
        .some((champ) => champ.toLowerCase().includes(terme)),
    );
  }, [conversations, recherche]);

  const groupes = useMemo(
    () => groupesDe(conversationsFiltrees, ordre, groupement, projetDe),
    [conversationsFiltrees, ordre, groupement, projetDe],
  );

  /**
   * Le libellé d'onglet d'un pane — vide quand Herdr n'en donne pas, ou quand il
   * est purement numérique (« – 3 » n'apprend rien).
   */
  const ongletDe = useCallback(
    (paneId: string): string => {
      const label = agents.find((candidat) => candidat.paneId === paneId)?.tabLabel ?? null;
      return label === null || /^\d+$/.test(label.trim()) ? "" : label;
    },
    [agents],
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
    const conv = ligneDe(agentAffiche.paneId);
    return (
      <div className="app">
        {agentPerime ? (
          <Notice ton="avertissement">
            This agent is no longer visible in Herdr. Showing its last known state.
          </Notice>
        ) : null}
        <Suspense fallback={<div className="skeleton" aria-busy="true" aria-label="Loading" />}>
          <ChatScreen
            agent={agentAffiche}
            voisins={voisins}
            onOuvrirVoisin={(paneId) => navigate({ kind: "agent", paneId })}
            currentModel={conv?.model}
            currentProvider={conv?.provider}
            currentThinking={conv?.thinking}
            onBack={() => navigate({ kind: "liste" })}
            question={conv?.question}
            trust={conv?.trust}
            waiting={conv?.waiting}
          />
        </Suspense>
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
          launching={launching === route.workspaceId}
          onLaunch={lancer}
          onOpenAgent={(paneId) => navigate({ kind: "agent", paneId })}
          back={() => navigate({ kind: "liste" })}
        />
      </div>
    );
  }

  return (
    <div className="app">
      {/*
        L'en-tête de la v1, rétabli : titre, **recherche**, **état de connexion
        réel**, réglages. Le shell v2 n'avait que le titre et un `connected` écrit
        en dur — il annonçait donc une connexion même flux coupé.
      */}
      <header className="topbar">
        <h1>Conversations</h1>
        <div className="topbar__droite">
          {/*
            ⚠️ La recherche apparaît au-delà de six conversations : en dessous,
            elle prendrait la place du titre pour filtrer trois lignes.
          */}
          {conversations.length > 6 ? (
            <label className="topbar__recherche">
              <span className="sr-only">Search conversations</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="m16 16 4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              <input
                autoComplete="off"
                onChange={(evenement) => setRecherche(evenement.target.value)}
                placeholder="Search"
                type="search"
                value={recherche}
              />
            </label>
          ) : null}
          <span className={`point point--${connexion}`} aria-hidden="true" />
          <span className="sr-only">Herdr {LIBELLE_CONNEXION[connexion]}</span>
          <button
            className="ghost topbar__engrenage"
            onClick={() => updateState((s) => ({ ...s, reglagesOuverts: true }))}
            aria-label="Settings"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3.75" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M12 4.5v2m0 11v2m7.5-7.5h-2m-11 0h-2m12.3-5.3-1.4 1.4m-7.8 7.8-1.4 1.4m10.6 0-1.4-1.4M6.5 6.5 5.1 5.1"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        </div>
      </header>
      {launchError === null ? null : <Notice ton="erreur">{launchError}</Notice>}
      {trustRequest === null ? null : (
        <TrustCard onDone={() => setTrustRequest(null)} request={trustRequest} />
      )}
      <main className="screen screen--liste">
        <BandeauEtat etat={etat} libelleVide="No conversations" onReessayer={reessayer} />
        {chargement && conversations.length === 0 ? (
          <Skeleton lignes={5} />
        ) : (
          <>
            {/*
            ⚠️ **Le tri est revenu.** Le shell v2 n'avait plus que « récent » :
            `ordre` vivait dans l'état mais n'était lu par personne. Le bouton est
            le même qu'en v1 — deux états, un geste, la place d'une icône.
          */}
            <div className="ordre">
              <button
                aria-label={ordre === "nom" ? "Sort by date" : "Sort by name"}
                aria-pressed={ordre === "nom"}
                className="ordre__bascule"
                onClick={() =>
                  updateState((s) => ({ ...s, ordre: s.ordre === "recent" ? "nom" : "recent" }))
                }
                title={ORDRE_LABEL[ordre]}
                type="button"
              >
                <span aria-hidden="true">{ordre === "nom" ? "A→Z" : "⏱"}</span>
              </button>
            </div>
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
                          onglet={ongletDe(c.paneId)}
                          maintenant={maintenant}
                          onOpen={(paneId) => navigate({ kind: "agent", paneId })}
                        />
                      </motion.div>
                    ))}
                  </motion.section>
                ))}
              </AnimatePresence>
            </div>
          </>
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
              sansSession={overview?.withoutSession ?? 0}
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
          onPick={(workspaceId) => {
            updateState((s) => ({ ...s, projetChoisi: false }));
            navigate({ kind: "projet", workspaceId });
          }}
          workspaces={overview?.workspaces ?? []}
        />
      ) : null}

      {/*
        ⚠️ **Le bandeau n'existe QUE si un worker attend vraiment.**
        `BandeauMiseAJour` se rend toujours lui-même : sans cette garde il
        s'affichait en permanence, et son bouton ne faisait rien — il n'y avait
        aucun worker en attente à qui envoyer `SKIP_WAITING`. C'était le cas
        mesuré sur les deux PWA : « A new version is ready » à chaque ouverture,
        sur un build parfaitement à jour.
      */}
      {miseAJourEnAttente() ? <BandeauMiseAJour /> : null}
    </div>
  );
};
