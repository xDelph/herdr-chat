/**
 * Herdr Remote — interface iPhone.
 *
 * Quatre onglets : Projets · Agents · Activité · Réglages.
 *
 * Règles d'affichage issues du protocole, pas d'un choix esthétique :
 *
 * - Herdr n'a **pas** de statut `error` : l'erreur vient de l'appel, jamais du
 *   statut. On n'invente donc aucun état (E2 / PROTOCOL.md §2.5).
 * - Un envoi **non confirmé** n'est jamais présenté comme « envoyé » (D007.2).
 * - Un double envoi supprimé est un **état normal**, pas un échec (D007.2).
 * - Ce qui n'est pas exposé par la source est affiché comme absent, jamais
 *   remplacé par un substitut inventé.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Option, Schema } from "effect";
import {
  fetchAgentKinds,
  reportError,
  TrustRequiredError,
  fetchHealth,
  launchAgent,
  fetchOverview,
  openEventStream,
} from "./api.ts";
import type {
  AgentView,
  InstalledKind,
  Health,
  Overview,
  TrustRequired,
  WorkspaceView,
} from "./api.ts";
import { AgentStatus } from "@herdr-remote/shared";
import { ALL_STATUSES, agentContext, agentName, statusClass, statusLabel } from "./labels.tsx";
import { ChatScreen } from "./ChatScreen.tsx";
import { ProjectAgentsOf } from "./ProjectDetail.tsx";
import { Gallery } from "./Gallery.tsx";
import { LaunchOptions } from "./LaunchOptions.tsx";
import type { LaunchChoice } from "./LaunchOptions.tsx";
import { TrustCard } from "./TrustCard.tsx";
import { AttentionCard } from "./Attention.tsx";
import { DEFAULT_TAB, parseRoute, routeToHash, TabSchema, TABS, TAB_LABEL } from "./routing.ts";
import type { Route, Tab } from "./routing.ts";

/**
 * Modèle et niveau de raisonnement choisis au lancement.
 *
 * Les champs **absents** signifient « je ne choisis pas » : l'agent garde alors
 * ses propres valeurs. Une chaîne vide aurait un autre sens et briserait ça.
 */
/**
 * Lit le fragment courant et se resynchronise sur les navigations, y compris le
 * bouton retour. L'analyse vit dans `routing.ts`, où elle est testée.
 */
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
      // Passer par l'historique : le bouton retour redevient utile.
      window.location.hash = hash;
    }
    setRoute(next);
  }, []);

  return [route, navigate];
};

/**
 * Table `paneId → nom lisible`.
 *
 * Sert partout où un identifiant de pane apparaît — y compris dans le journal
 * d'activité, qui affichait `w8:p1` au lieu du nom du projet.
 */
const nameByPane = (agents: ReadonlyArray<AgentView>): ReadonlyMap<string, string> =>
  new Map(agents.map((agent) => [agent.paneId, agentName(agent)]));

/** Rend un événement du flux lisible, sans JSON brut à l'écran. */
const describeEvent = (kind: string, data: unknown, names: ReadonlyMap<string, string>): string => {
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      Schema.Struct({
        from: Schema.optional(Schema.NullOr(AgentStatus)),
        kind: Schema.optional(Schema.String),
        paneId: Schema.optional(Schema.String),
        reason: Schema.optional(Schema.String),
        status: Schema.optional(Schema.String),
        text: Schema.optional(Schema.String),
        to: Schema.optional(Schema.NullOr(AgentStatus)),
      }),
    )(data),
  );

  if (decoded === undefined) return kind;

  // Un identifiant de pane n'apprend rien : on affiche le nom du projet quand
  // on le connaît, et un libellé neutre sinon — **jamais** l'identifiant.
  const raw = decoded.paneId ?? "";
  const label = raw.length > 0 ? (names.get(raw) ?? "un agent") : "un agent";

  if (kind === "agent_status") {
    switch (decoded.kind) {
      case "appeared":
        return `${label} — agent lancé`;
      case "disappeared":
        return `${label} — agent arrêté`;
      default:
        return `${label} — ${statusLabel(decoded.from ?? "unknown")} → ${statusLabel(decoded.to ?? "unknown")}`;
    }
  }

  if (kind === "prompt") return `message envoyé à ${label}`;
  if (kind === "prompt-suppressed") return `double envoi supprimé pour ${label}`;
  if (kind === "agent-launched") return `${label} — agent lancé (${decoded.kind ?? ""})`;
  if (kind === "resync") return "journal tronqué — rechargement complet";
  return kind;
};

/**
 * Libellés par état.
 *
 * La clé est **typée** : un état absent de cette table ne compile pas, donc
 * impossible d'oublier un libellé en ajoutant un état à l'union (A04).
/**
 * Ligne de projet. **Cliquable** : ouvre les agents de ce projet.
 *
 * Avant, la ligne était statique — le clic ne faisait rien, ce qui laissait
 * croire à une application cassée.
 */
/**
 * Ligne de projet.
 *
 * Elle montre **ce qui s'y passe** et propose l'action utile : ouvrir l'agent
 * s'il y en a un, en lancer un sinon. Une ligne qui ne fait rien laisse croire
 * que l'application est cassée.
 */
const WorkspaceRow = ({
  workspace,
  agentPaneCount,
  kinds,
  launching,
  onLaunch,
  onOpen,
}: {
  workspace: WorkspaceView;
  agentPaneCount: number;
  launching: boolean;
  kinds: ReadonlyArray<InstalledKind>;
  onLaunch: (workspaceId: string, kind: string, choice: LaunchChoice) => void;
  onOpen: (workspaceId: string) => void;
}) => {
  const hasAgent = agentPaneCount > 0;
  // `pi` par défaut : c'est l'agent réellement utilisé, mais le choix reste
  // ouvert à tout ce que Herdr sait démarrer.
  const [kind, setKind] = useState<string>("pi");
  const [showOptions, setShowOptions] = useState(false);
  const handleOpen = useCallback(
    () => onOpen(workspace.workspaceId),
    [onOpen, workspace.workspaceId],
  );
  /** Modèle et raisonnement choisis — transmis à `agent.start`. */
  const [choice, setChoice] = useState<LaunchChoice>({});
  const onChoice = useCallback((next: LaunchChoice) => setChoice(next), []);
  const handleLaunch = useCallback(
    () => onLaunch(workspace.workspaceId, kind, choice),
    [choice, kind, onLaunch, workspace.workspaceId],
  );
  const onKindChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setKind(event.target.value);
  }, []);

  return (
    /*
      Un vrai `<button>` pour la zone « ouvrir », et les contrôles de lancement
      **à côté** — jamais imbriqués. Un bouton dans un bouton est du HTML
      invalide ; le lint l'a signalé, et il avait raison.
    */
    <div className="row row--project">
      <button
        type="button"
        className="row__open"
        aria-label={
          hasAgent
            ? `Ouvrir ${workspace.label ?? "le projet"}`
            : `Lancer un agent dans ${workspace.label ?? "le projet"}`
        }
        onClick={hasAgent ? handleOpen : handleLaunch}
      >
        <span className={statusClass(workspace.agentStatus ?? "unknown")} />
        <span className="row__main">
          <strong>{workspace.label ?? "(projet sans nom)"}</strong>
          <span className="muted small">
            {agentPaneCount === 0
              ? // « état inconnu » sur un projet sans agent est du bruit : il n'y a
                // pas d'état à connaître.
                "aucun agent"
              : `${String(agentPaneCount)} agent${agentPaneCount > 1 ? "s" : ""} · ${statusLabel(workspace.agentStatus ?? "unknown")}`}
          </span>
        </span>
      </button>
      {/* Lancement possible **même si un agent tourne** : cela crée un nouvel
          onglet dans le projet. */}
      {
        <span
          className="launch"
          role="presentation"
          // Le choix du type et le lancement ne doivent pas déclencher
          // l'ouverture du projet.
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <select
            className="launch__kind"
            value={kind}
            onChange={onKindChange}
            aria-label="Type d'agent à lancer"
          >
            {kinds.map((candidate) => (
              <option key={candidate.kind} value={candidate.kind}>
                {candidate.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost launch__toggle"
            aria-expanded={showOptions}
            onClick={() => setShowOptions((value) => !value)}
          >
            {showOptions ? "Masquer" : "Modèle"}
          </button>
          <button
            type="button"
            className="row__action row__action--primary"
            onClick={handleLaunch}
            disabled={launching || workspace.checkoutPath === null || kinds.length === 0}
          >
            {/* ⚠️ Un seul libellé : dans tous les cas on **ajoute** un agent.
                « Lancer » et « + » faisaient la même chose sous deux noms. */}
            {launching ? "…" : "+"}
          </button>
        </span>
      }
      {/*
        Modèle et raisonnement sont **dépliants** : une ligne de projet doit
        rester lisible d'un coup d'œil, et 439 modèles ne tiennent pas dans
        une rangée.
      */}
      {showOptions ? (
        <div
          className="launch__panel"
          role="presentation"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <LaunchOptions kind={kind} onChange={onChoice} />
        </div>
      ) : null}
    </div>
  );
};

const AgentRow = ({ agent, onOpen }: { agent: AgentView; onOpen: (paneId: string) => void }) => {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const paneId = event.currentTarget.dataset["pane"];
      if (paneId !== undefined) onOpen(paneId);
    },
    [onOpen],
  );

  return (
    <button
      type="button"
      className="row"
      aria-label={`Ouvrir ${agentName(agent)}`}
      data-pane={agent.paneId}
      onClick={handleClick}
    >
      <span className={statusClass(agent.status)} />
      <span className="row__main">
        <strong>{agentName(agent)}</strong>
        <span className="muted small">
          {/*
            ⚠️ Un agent fraîchement lancé est détecté par Herdr au bout de
            ~20 secondes. Pendant ce délai `agent` est nul : sans ce message, la
            ligne ressemble à un agent cassé.
          */}
          {agent.agent === null
            ? "démarrage en cours…"
            : `${agentContext(agent)} · ${statusLabel(agent.status)}`}
        </span>
      </span>
    </button>
  );
};

export const App = () => {
  const [route, navigate] = useHashRoute();
  const tab: Tab = route.kind === "tab" ? route.tab : DEFAULT_TAB;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<"live" | "down">("down");
  const activitySeq = useRef(0);
  /**
   * Activité brute : on stocke `(kind, data)`, pas le texte.
   *
   * ⚠️ Résoudre le nom **à la réception** produisait « un agent » pour tout
   * l'historique rejoué : le journal du serveur renvoie les événements passés
   * dès la connexion, **avant** que la liste des agents ne soit chargée. Le nom
   * n'existe pas encore à cet instant.
   *
   * En résolvant au **rendu**, un nom arrivé plus tard s'applique aussi aux
   * événements passés.
   */
  const [activity, setActivity] = useState<
    readonly { at: number; data: unknown; id: number; kind: string }[]
  >([]);

  const [statusFilter, setStatusFilter] = useState<string>("tous");
  const [launching, setLaunching] = useState<string | null>(null);
  /** Types **réellement installés**, lus depuis Herdr — pas une liste codée. */
  const [kinds, setKinds] = useState<readonly InstalledKind[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);
  /**
   * Invite de confiance en attente de décision.
   *
   * ⚠️ Volontairement **distincte** de `launchError` : un agent bloqué sur
   * « Trust this folder? » n'a pas échoué, il attend. L'afficher comme une
   * erreur rouge serait mentir sur ce qui se passe.
   */
  const [trustRequest, setTrustRequest] = useState<TrustRequired | null>(null);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("tous");

  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextHealth] = await Promise.all([fetchOverview(), fetchHealth()]);
      setOverview(nextOverview);
      setHealth(nextHealth);
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      // Journalisé : une barre rouge disparaît au rechargement, pas le journal.
      reportError("échec du chargement de la vue d'ensemble", message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Une seule lecture : les intégrations installées ne changent pas en cours de
  // session. Un échec laisse la liste vide et désactive le lancement, plutôt que
  // de proposer des agents inexistants.
  useEffect(() => {
    void (async () => {
      try {
        setKinds(await fetchAgentKinds());
      } catch {
        setKinds([]);
      }
    })();
  }, []);

  useEffect(
    () =>
      openEventStream({
        onEvent: (kind, data) => {
          activitySeq.current += 1;
          const entry = { at: Date.now(), data, id: activitySeq.current, kind };
          setActivity((current) => [entry, ...current].slice(0, 80));
          // Un changement d'état d'agent est le signal du **direct** : on
          // rafraîchit la vue, servie depuis le cache du veilleur.
          if (kind === "agent_status") void refresh();
        },
        onResync: () => {
          // Continuité rompue côté serveur : on recharge au lieu de croire
          // à un flux continu.
          activitySeq.current += 1;
          const entry = { at: Date.now(), data: {}, id: activitySeq.current, kind: "resync" };
          setActivity((current) => [entry, ...current]);
          void refresh();
        },
        onStatus: setLive,
      }),
    [refresh],
  );

  /**
   * Agents du parc, **stables tant que l'overview ne change pas**.
   *
   * `overview?.agents ?? []` créait un **nouveau tableau vide** à chaque rendu
   * quand l'overview est absent, et une nouvelle référence à chaque rendu sinon
   * dès que le parent se rend. Passé en prop, ce tableau redessinait les
   * écrans — et faisait perdre le défilement au rafraîchissement du snapshot.
   */
  const agents = useMemo(() => overview?.agents ?? [], [overview]);
  // Table de noms **du rendu** : un nom arrivé après un événement s'y applique.
  const activityNames = nameByPane(agents);

  /**
   * Racine du projet courant, déduite d'un agent qui tourne dedans.
   *
   * On ne code pas le chemin en dur : il vient de Herdr, comme tout le reste.
   * En l'absence d'agent dans ce projet, on retombe sur le dossier de travail
   * du premier agent disponible — la galerie est un outil de développement, et
   * elle disparaît d'elle-même si aucun chemin n'est connu.
   */
  const projectRoot =
    agents.find((agent) => agent.workspaceLabel === "herdr-pwa")?.cwd ?? agents[0]?.cwd ?? "";
  // Un agent « bloqué » attend une intervention : c'est la seule catégorie qui
  // appelle une action de l'utilisateur.
  const awaiting = agents.filter((agent) => agent.status === "blocked");
  /** `true` si au moins un agent tourne — sert à ne jamais afficher un vide. */
  const waiting = agents.length > 0;

  /**
   * Captures servies par le backend.
   *
   * Elles vivent dans `apps/web/public/screenshots`, donc sous le dossier du
   * projet : le service de fichiers les accepte comme n'importe quel fichier de
   * projet, sans route dédiée.
   */
  // Hors du corps du composant : le tableau ne dépend que de `projectRoot`, donc
  // il est identique à chaque rendu. Le reconstruire ici en créait une nouvelle
  // référence et redessinait la galerie entière (react-perf).
  const screenshotPaths = useMemo(
    () =>
      ["00-a-traiter", "01-projets", "02-agents", "03-conversation"].map(
        (name) => `${projectRoot}/apps/web/public/screenshots/${name}.png`,
      ),
    [projectRoot],
  );
  const filtered = agents.filter(
    (agent) =>
      (statusFilter === "tous" || agent.status === statusFilter) &&
      (workspaceFilter === "tous" || agent.workspaceId === workspaceFilter),
  );

  // Détail d'un projet (U05) : ses conversations, et rien d'autre. Le filtre de
  // la liste globale ne s'applique pas ici — ce sont **toutes** les
  // conversations du projet, sinon un agent masqué par un filtre resterait
  // invisible dans le projet où il se trouve.
  const projectWorkspaceId = route.kind === "projet" ? route.workspaceId : "";
  /**
   * Conversations du projet — **comparaison explicite**, pas `useMemo`.
   *
   * Les deux règles du lint se contredisent si on se contente de mémoïser :
   * `exhaustive-deps` veut `agents` en dépendance (donc nouvelle référence à
   * chaque rafraîchissement), et `jsx-no-new-array-as-prop` veut une prop
   * stable. On les applique donc à la main, et c'est `useStable` qui décide.
   */
  const projectWorkspace = (overview?.workspaces ?? []).find(
    (workspace) => workspace.workspaceId === projectWorkspaceId,
  );
  const onBackToProjects = useCallback(() => navigate({ kind: "tab", tab: "projets" }), [navigate]);

  // Handlers stables : évite de recréer une fonction à chaque rendu.
  const onTabClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const next = event.currentTarget.dataset["tab"];
      const valid = Option.getOrUndefined(Schema.decodeUnknownOption(TabSchema)(next));
      if (valid !== undefined) navigate({ kind: "tab", tab: valid });
    },
    [navigate],
  );
  // Wrapper synchrone : `onClick` attend un retour `void`.
  const onLaunchAgent = useCallback(
    (workspaceId: string, kind: string, choice: LaunchChoice) => {
      void (async () => {
        setLaunching(workspaceId);
        setLaunchError(null);
        setTrustRequest(null);
        try {
          const started = await launchAgent(workspaceId, kind, choice);
          // Le projet a maintenant un agent : on ouvre sa conversation.
          navigate({ kind: "agent", paneId: started.paneId });
          await refresh();
        } catch (cause: unknown) {
          // L'invite de confiance a son propre affichage : elle n'est pas une erreur.
          if (cause instanceof TrustRequiredError) {
            setTrustRequest(cause.request);
          } else {
            const message = cause instanceof Error ? cause.message : String(cause);
            setLaunchError(message);
            reportError("échec du lancement d'agent", { message, workspaceId, kind });
          }
        } finally {
          setLaunching(null);
        }
      })();
    },
    [navigate, refresh],
  );

  const onWorkspaceFilter = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setWorkspaceFilter(event.target.value);
  }, []);
  const onStatusFilter = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(event.target.value);
  }, []);

  const closeAgent = useCallback(() => navigate({ kind: "tab", tab: DEFAULT_TAB }), [navigate]);

  const openAgent = useCallback(
    (agent: AgentView) => {
      // ⚠️ Naviguer **est** l'ouverture : le rendu se fonde sur la route. Mettre
      // à jour un état local sans toucher à la route ne faisait rien du tout.
      navigate({ kind: "agent", paneId: agent.paneId });
    },
    [navigate],
  );

  /**
   * Ouvre le **détail** d'un projet (U05).
   *
   * Avant, toucher un projet filtrait la liste des agents et revenait à
   * l'accueil. Le filtre se combinait mal avec la navigation : l'utilisateur
   * perdait le contexte du projet, et « revenir » ne menait nulle part.
   */
  const onOpenWorkspace = useCallback(
    (workspaceId: string) => {
      navigate({ kind: "projet", workspaceId });
    },
    [navigate],
  );

  const onOpenAgent = useCallback(
    (paneId: string) => {
      const agent = (overview?.agents ?? []).find((candidate) => candidate.paneId === paneId);
      if (agent !== undefined) openAgent(agent);
    },
    [openAgent, overview],
  );

  // L'agent affiché est **dérivé de la route** : après un rafraîchissement, le
  // fragment `#/agent/<paneId>` rouvre le même agent.
  const selectedAgent =
    route.kind === "agent" ? (agents.find((a) => a.paneId === route.paneId) ?? null) : null;

  if (route.kind === "agent" && selectedAgent !== null) {
    return (
      <div className="app">
        <ChatScreen agent={selectedAgent} onBack={closeAgent} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Herdr Remote</h1>
          <span className="muted small">
            {health?.herdr.version !== undefined
              ? `Herdr ${health.herdr.version} · protocole ${health.herdr.protocol}`
              : "Herdr injoignable"}
          </span>
        </div>
        <span className={live === "live" ? "pill pill--live" : "pill pill--down"}>
          {live === "live" ? "temps réel" : "hors ligne"}
        </span>
      </header>

      {error !== null ? <p className="notice notice--error">{error}</p> : null}
      {overview !== null && overview.withoutSession > 0 ? (
        <p className="notice notice--warn">
          {overview.withoutSession} agent(s) sans chemin de session exposé
        </p>
      ) : null}

      {route.kind === "projet" ? (
        <ProjectAgentsOf
          agents={agents}
          back={onBackToProjects}
          kinds={kinds}
          launching={launching === route.workspaceId}
          onLaunch={onLaunchAgent}
          onOpenAgent={onOpenAgent}
          workspaceId={projectWorkspaceId}
          workspace={projectWorkspace}
        />
      ) : null}

      {tab === "projets" ? (
        <section className="screen">
          <h2>Projets</h2>
          <p className="muted small">
            Toucher un projet ouvre son agent. Le <strong>+</strong> ajoute un agent — dans un
            projet vide, ou dans un nouvel onglet s'il en a déjà un.
          </p>
          {launchError !== null ? <p className="notice notice--error">{launchError}</p> : null}
          {trustRequest !== null ? (
            <TrustCard request={trustRequest} onDone={() => setTrustRequest(null)} />
          ) : null}
          <ul className="list">
            {overview?.workspaces.map((workspace) => (
              <li key={workspace.workspaceId}>
                <WorkspaceRow
                  agentPaneCount={workspace.agentPanes.length}
                  kinds={kinds}
                  launching={launching === workspace.workspaceId}
                  onLaunch={onLaunchAgent}
                  onOpen={onOpenWorkspace}
                  workspace={workspace}
                />
              </li>
            ))}
          </ul>
          {overview !== null && overview.workspaces.length === 0 ? (
            <p className="muted">Aucun workspace.</p>
          ) : null}
        </section>
      ) : null}

      {/*
        Conversations — destination initiale (U04).

        `À traiter` n’est plus un onglet : c’est la **première section** de
        Conversations. Ouvrir sur « Agents » obligeait à choisir entre « qui
        existe » et « de quoi s’occuper » — deux listes, une seule réponse.
      */}
      {tab === "conversations" ? (
        <section className="screen">
          <h2>Conversations</h2>
          <div className="filters">
            <select value={workspaceFilter} onChange={onWorkspaceFilter}>
              <option value="tous">tous les projets</option>
              {overview?.workspaces.map((workspace) => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.label ?? workspace.workspaceId}
                </option>
              ))}
            </select>
            <select value={statusFilter} onChange={onStatusFilter}>
              <option value="tous">tous les états</option>
              {ALL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </div>
          <ul className="list">
            {filtered.map((agent) => (
              <li key={agent.paneId}>
                <AgentRow agent={agent} onOpen={onOpenAgent} />
              </li>
            ))}
          </ul>
          {filtered.length === 0 ? <p className="muted">Aucun agent pour ce filtre.</p> : null}

          {/* Première section de Conversations, plus un onglet séparé. */}
          <h2>À traiter</h2>
          {awaiting.length === 0 ? (
            waiting ? (
              /*
                ⚠️ Un écran d'accueil ne doit pas être vide. Quand rien n'attend,
                on montre **l'état du parc** : qui tourne, et depuis quand.
              */
              <ul className="list list--compact">
                {agents.map((agent) => (
                  <li key={agent.paneId} className="row row--static">
                    <span className={statusClass(agent.status)} />
                    <span className="row__main">
                      <strong>{agentName(agent)}</strong>
                      <span className="muted small">{statusLabel(agent.status)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Rien ne tourne pour l'instant.</p>
            )
          ) : (
            <div className="attention__list">
              {awaiting.map((agent) => (
                <AttentionCard key={agent.paneId} agent={agent} onOpen={onOpenAgent} />
              ))}
            </div>
          )}

          <h2>Activité récente</h2>
          {activity.length === 0 ? (
            <p className="muted small">
              Rien reçu pour l'instant. Les lancements, messages et changements d'état apparaissent
              ici.
            </p>
          ) : (
            <ul className="list list--compact">
              {activity.map((item) => (
                <li key={item.id} className="small">
                  <span className="mono muted">{new Date(item.at).toLocaleTimeString()}</span>{" "}
                  {describeEvent(item.kind, item.data, activityNames)}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "reglages" ? (
        <section className="screen">
          <h2>Réglages</h2>
          <dl className="kv">
            <dt>Socket Herdr</dt>
            <dd className="mono small">{health?.herdr.socket ?? "—"}</dd>
            <dt>Herdr joignable</dt>
            <dd>{health?.herdr.reachable === true ? "oui" : "non"}</dd>
            <dt>Chemin de session</dt>
            <dd>
              {agents.every((agent) => agent.sessionCwdMatches !== false)
                ? "cohérent pour tous les agents"
                : "divergence détectée"}
            </dd>
            <dt>Écoute</dt>
            <dd className="mono small">127.0.0.1 — accès via Tailscale uniquement</dd>
          </dl>
          <p className="muted small">
            Le contenu des conversations est lu dans les fichiers de session Pi, jamais depuis
            Herdr. Aucune action shell arbitraire n'est exposée.
          </p>
          {projectRoot.length > 0 ? <Gallery paths={screenshotPaths} /> : null}
        </section>
      ) : null}

      <nav className="tabs">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            data-tab={key}
            className={tab === key ? "tab tab--active" : "tab"}
            onClick={onTabClick}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </nav>
    </div>
  );
};
