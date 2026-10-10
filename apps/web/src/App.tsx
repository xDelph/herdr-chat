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
import { useCallback, useEffect, useRef, useState } from "react";
import { Option, Schema } from "effect";
import {
  fetchAgentKinds,
  reportError,
  fetchHealth,
  launchAgent,
  fetchOverview,
  fetchSession,
  fetchTerminal,
  openEventStream,
  sendPrompt,
} from "./api.ts";
import type {
  AgentView,
  InstalledKind,
  Health,
  Overview,
  SendResult,
  SessionEntry,
  WorkspaceView,
} from "./api.ts";
import { toItems, toMessages, touchedFilesOf } from "./blocks.ts";
import { FilesSheet } from "./Files.tsx";
import { Gallery } from "./Gallery.tsx";
import { FileViewer } from "./Viewer.tsx";
import { AttentionCard } from "./Attention.tsx";
import type { RenderedMessage } from "./blocks.ts";
import { FileOpenerContext, ItemsView, UrlOpenerContext } from "./Blocks.tsx";
import { parseRoute, routeToHash, TabSchema } from "./routing.ts";
import type { Route, Tab } from "./routing.ts";

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

/** Premier pane de la liste, ou `undefined` s'il n'y a aucun agent. */
const filteredFirstPane = (agents: ReadonlyArray<AgentView>): string | undefined =>
  agents[0]?.paneId;

/** Rend un événement du flux lisible, sans JSON brut à l'écran. */
const describeEvent = (kind: string, data: unknown, names: ReadonlyMap<string, string>): string => {
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      Schema.Struct({
        from: Schema.optional(Schema.NullOr(Schema.String)),
        kind: Schema.optional(Schema.String),
        paneId: Schema.optional(Schema.String),
        reason: Schema.optional(Schema.String),
        status: Schema.optional(Schema.String),
        text: Schema.optional(Schema.String),
        to: Schema.optional(Schema.String),
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
        return `${label} — ${statusLabel(decoded.from ?? "?")} → ${statusLabel(decoded.to ?? "?")}`;
    }
  }

  if (kind === "prompt") return `message envoyé à ${label}`;
  if (kind === "prompt-suppressed") return `double envoi supprimé pour ${label}`;
  if (kind === "agent-launched") return `${label} — agent lancé (${decoded.kind ?? ""})`;
  if (kind === "resync") return "journal tronqué — rechargement complet";
  return kind;
};

const STATUS_LABEL: Record<string, string> = {
  blocked: "attend une réponse",
  done: "terminé",
  idle: "disponible",
  unknown: "état inconnu",
  working: "en cours",
};

/** Aucun statut `error` n'existe côté Herdr : on ne le fabrique pas. */
const statusLabel = (status: string): string => STATUS_LABEL[status] ?? status;

/**
 * Nom lisible d'un agent.
 *
 * Herdr fournit un libellé de projet et d'onglet. Afficher `wB:p1` à l'écran
 * n'apprend rien à personne : on préfère le projet, puis l'onglet, puis le nom
 * de l'agent. L'identifiant de pane reste visible, mais **en second**, pour le
 * diagnostic.
 */
/** Dernier segment d'un chemin : `…/projets/pixel` → `pixel`. */
const basename = (path: string | null): string | null => {
  if (path === null) return null;
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] ?? null) : null;
};

/**
 * Nom lisible d'un agent.
 *
 * ⚠️ **Ne retombe jamais sur un identifiant de pane.** `w3:p1` ne dit rien à
 * personne. La chaîne se termine sur le dossier de travail, qui est toujours
 * parlant, puis sur un libellé générique.
 */
const agentName = (agent: AgentView): string =>
  agent.workspaceLabel ??
  basename(agent.cwd) ??
  basename(agent.sessionCwd) ??
  agent.title ??
  agent.agent ??
  "Agent sans nom";

/**
 * Contexte d'un agent : onglet, type, dossier.
 *
 * **Aucun identifiant interne.** Un identifiant de pane ou de projet n'a jamais
 * aidé quelqu'un à comprendre ce qu'il regarde.
 */
const agentContext = (agent: AgentView): string => {
  const parts: string[] = [];
  if (agent.tabLabel !== null && agent.tabLabel !== undefined && agent.tabLabel.length > 0) {
    parts.push(agent.tabLabel);
  } else if (agent.tabNumber !== null && agent.tabNumber !== undefined) {
    // ⚠️ Plusieurs agents dans un même projet portent le même nom. Sans le
    // numéro d'onglet, les lignes sont **indistinguables**.
    parts.push(`onglet ${agent.tabNumber}`);
  }
  if (agent.agent !== null) parts.push(agent.agent);
  const folder = basename(agent.cwd);
  if (folder !== null && folder !== agent.workspaceLabel) parts.push(folder);
  return parts.join(" · ");
};

/** Couleur sémantique : `unknown` est neutre, jamais vert ni rouge. */
const statusClass = (status: string): string => {
  switch (status) {
    case "working":
      return "dot dot--working";
    case "blocked":
      return "dot dot--blocked";
    case "done":
      return "dot dot--done";
    case "idle":
      return "dot dot--idle";
    default:
      return "dot dot--unknown";
  }
};

const ChatScreen = ({ agent, onBack }: { agent: AgentView; onBack: () => void }) => {
  const [entries, setEntries] = useState<readonly SessionEntry[]>([]);
  /**
   * Messages déjà analysés.
   *
   * ⚠️ Analyser **toute** la conversation à chaque rafraîchissement coûtait un
   * `JSON.parse` et un décodage par entrée, toutes les 2 s. En incrémental, on
   * n'analyse que ce qui arrive.
   */
  const [messages, setMessages] = useState<readonly RenderedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [lastSend, setLastSend] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const placeholder = `Message à ${agentName(agent)}…`;
  const files = touchedFilesOf(messages);
  const [showFiles, setShowFiles] = useState(false);
  /** Fichier ouvert dans la visionneuse plein écran. */
  const [openFile, setOpenFile] = useState<string | null>(null);
  /** `true` quand la visionneuse a été ouverte depuis la liste des fichiers. */
  const [fromFiles, setFromFiles] = useState(false);
  const onToggleFiles = useCallback(() => setShowFiles((value) => !value), []);

  /**
   * Chargement **incrémental** de la conversation.
   *
   * Premier passage : on lit la fin du fichier (`tail`), pour peindre vite.
   * Ensuite : on ne demande que ce qui suit le dernier offset connu (`since`).
   *
   * Avant, chaque rafraîchissement re-téléchargeait la session entière — 1,8 Mo
   * sur une session réelle, toutes les 2,5 s — et l'écran ne s'affichait jamais.
   */
  const cursor = useRef<{ offset: number; path: string } | null>(null);
  const loading = useRef(false);

  const load = useCallback(
    async (mode: "initial" | "incremental") => {
      if (loading.current) return;
      loading.current = true;
      try {
        const known = cursor.current;
        const session =
          mode === "incremental" && known !== null
            ? await fetchSession(agent.paneId, { since: known.offset })
            : await fetchSession(agent.paneId, { tail: 524_288 });

        cursor.current = { offset: session.offset, path: session.sessionPath };

        if (session.incremental) {
          if (session.entries.length > 0) {
            // Analyse des seules entrées nouvelles.
            const added = toMessages(session.entries);
            setEntries((current) => [...current, ...session.entries]);
            setMessages((current) => [...current, ...added]);
          }
        } else {
          setEntries(session.entries);
          setMessages(toMessages(session.entries));
        }
        setError(null);
      } catch (cause) {
        // La cause réelle est affichée : pas de message générique qui masque.
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        reportError("échec du chargement de session", { message, paneId: agent.paneId });
      } finally {
        loading.current = false;
      }
    },
    [agent.paneId],
  );

  useEffect(() => {
    cursor.current = null;
    void load("initial");
    const timer = setInterval(() => {
      void load("incremental");
    }, 2000);
    return () => clearInterval(timer);
  }, [load]);

  /**
   * Défilement automatique — **conditionnel**.
   *
   * Avant, chaque arrivée de message déclenchait un `scrollIntoView` animé.
   * Pendant la saisie, l'animation se battait avec le clavier iOS et le
   * défilement partait en vrille. On ne défile donc que si l'utilisateur est
   * déjà en bas, et **sans animation** : un saut instantané ne se bat avec rien.
   */
  const atBottom = useRef(true);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    // 48 px de tolérance : un doigt sur un écran ne vise pas le pixel.
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    if (!atBottom.current) return;
    const el = scrollerRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const onDraftChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
  }, []);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    try {
      const result = await sendPrompt(agent.paneId, text);
      setLastSend(result);
      if (result.kind === "sent") setDraft("");
    } finally {
      setSending(false);
    }
  }, [agent.paneId, draft, sending]);

  const onSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  return (
    // La visionneuse est fournie au fond de l'arbre : un bloc qui cite une image
    // l'ouvre sans qu'aucun composant intermédiaire n'ait à la connaître.
    <UrlOpenerContext.Provider
      value={(url) => {
        setFromFiles(false);
        setOpenFile(url);
      }}
    >
      <FileOpenerContext.Provider
        value={(path) => {
          setFromFiles(false);
          setOpenFile(path);
        }}
      >
        <section className="chat">
          <header className="screen__head">
            <button type="button" className="ghost" onClick={onBack}>
              ‹ Retour
            </button>
            <div className="screen__title">
              <strong>{agentName(agent)}</strong>
              <div className="muted small">
                {agentContext(agent)} · {statusLabel(agent.status)}
              </div>
            </div>
            {/*
          Les fichiers sont une **action**, pas une section permanente : un
          bouton discret, avec le compte, uniquement s'il y en a.
        */}
            {files.length > 0 ? (
              <button type="button" className="row__action" onClick={onToggleFiles}>
                Fichiers · {files.length}
              </button>
            ) : null}
          </header>

          {agent.sessionPath === null ? (
            <p className="notice notice--warn">
              Aucun chemin de session exposé par Herdr pour cet agent. Le contenu n'est pas
              affichable — et il n'est pas reconstruit artificiellement.
            </p>
          ) : null}

          {error !== null ? <p className="notice notice--error">{error}</p> : null}

          <div className="messages" ref={scrollerRef} onScroll={onScroll}>
            <ItemsView items={toItems(messages)} />
          </div>

          {openFile !== null ? (
            // La visionneuse est **au-dessus** de tout : elle ne peut pas être
            // recouverte par le composeur, contrairement à l'ancien panneau.
            <FileViewer
              path={openFile}
              onClose={() => {
                setOpenFile(null);
                setFromFiles(false);
              }}
              onBack={
                // Revenir d'un cran **seulement** si on vient de la liste.
                fromFiles
                  ? () => {
                      setOpenFile(null);
                      setShowFiles(true);
                    }
                  : undefined
              }
            />
          ) : showFiles ? (
            <FilesSheet
              files={files}
              onClose={onToggleFiles}
              onOpenFile={(path) => {
                setShowFiles(false);
                // ⚠️ Sans ce drapeau, la visionneuse n'a pas de retour : « Fermer »
                // ferme tout et on perd la liste qu'on parcourait.
                setFromFiles(true);
                setOpenFile(path);
              }}
            />
          ) : null}

          <div className="composer">
            <textarea value={draft} onChange={onDraftChange} placeholder={placeholder} rows={2} />
            <button type="button" onClick={onSubmit} disabled={sending}>
              {sending ? "…" : "Envoyer"}
            </button>
          </div>

          {lastSend !== null ? (
            <p className="sendState">
              {lastSend.kind === "sent" && lastSend.confirmation === "confirmed"
                ? "envoyé (confirmé par Herdr)"
                : null}
              {lastSend.kind === "sent" && lastSend.confirmation === "unknown"
                ? "envoi effectué, confirmation incertaine — état inconnu"
                : null}
              {lastSend.kind === "suppressed" ? `double envoi supprimé — ${lastSend.reason}` : null}
              {lastSend.kind === "failed" ? `échec : ${lastSend.message}` : null}
            </p>
          ) : null}
        </section>
      </FileOpenerContext.Provider>
    </UrlOpenerContext.Provider>
  );
};

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
  onLaunch: (workspaceId: string, kind: string) => void;
  onOpen: (workspaceId: string) => void;
}) => {
  const hasAgent = agentPaneCount > 0;
  // `pi` par défaut : c'est l'agent réellement utilisé, mais le choix reste
  // ouvert à tout ce que Herdr sait démarrer.
  const [kind, setKind] = useState<string>("pi");
  const handleOpen = useCallback(
    () => onOpen(workspace.workspaceId),
    [onOpen, workspace.workspaceId],
  );
  const handleLaunch = useCallback(
    () => onLaunch(workspace.workspaceId, kind),
    [kind, onLaunch, workspace.workspaceId],
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
  const tab: Tab = route.kind === "tab" ? route.tab : "agents";
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

  const [terminal, setTerminal] = useState<string>("");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("tous");
  const [launching, setLaunching] = useState<string | null>(null);
  /** Types **réellement installés**, lus depuis Herdr — pas une liste codée. */
  const [kinds, setKinds] = useState<readonly InstalledKind[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);
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

  const agents = overview?.agents ?? [];
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
  const screenshotPaths = ["00-a-traiter", "01-projets", "02-agents", "03-conversation"].map(
    (name) => `${projectRoot}/apps/web/public/screenshots/${name}.png`,
  );
  // Onglet Activité : le terminal est lu pour l'agent sélectionné s'il y en a un,
  // sinon le premier de la liste. Jamais deviné au-delà.
  const activePaneId = route.kind === "agent" ? route.paneId : (filteredFirstPane(agents) ?? "");
  const filtered = agents.filter(
    (agent) =>
      (statusFilter === "tous" || agent.status === statusFilter) &&
      (workspaceFilter === "tous" || agent.workspaceId === workspaceFilter),
  );

  // Handlers stables : évite de recréer une fonction à chaque rendu.
  const onTabClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const next = event.currentTarget.dataset["tab"];
      const valid = Option.getOrUndefined(Schema.decodeUnknownOption(TabSchema)(next));
      if (valid !== undefined) navigate({ kind: "tab", tab: valid });
    },
    [navigate],
  );
  /**
   * Lecture du terminal — **uniquement sur demande explicite**.
   *
   * C'est le seul appel de l'application qui interroge le pane côté Herdr. Il
   * n'a donc pas sa place dans l'ouverture d'un agent : le contenu de la
   * conversation vient du fichier de session, pas du terminal.
   */
  const onLoadTerminal = useCallback(async () => {
    if (terminalLoading) return;
    setTerminalLoading(true);
    setTerminalError(null);
    try {
      const read = await fetchTerminal(activePaneId);
      setTerminal(read.text);
    } catch (cause) {
      setTerminalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTerminalLoading(false);
    }
  }, [activePaneId, terminalLoading]);

  // Wrapper synchrone : `onClick` attend un retour `void`.
  const onLoadTerminalClick = useCallback(() => {
    void onLoadTerminal();
  }, [onLoadTerminal]);

  const onLaunchAgent = useCallback(
    (workspaceId: string, kind: string) => {
      void (async () => {
        setLaunching(workspaceId);
        setLaunchError(null);
        try {
          const started = await launchAgent(workspaceId, kind);
          // Le projet a maintenant un agent : on ouvre sa conversation.
          navigate({ kind: "agent", paneId: started.paneId });
          await refresh();
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          setLaunchError(message);
          reportError("échec du lancement d'agent", { message, workspaceId, kind });
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

  const closeAgent = useCallback(() => navigate({ kind: "tab", tab: "agents" }), [navigate]);

  const openAgent = useCallback(
    (agent: AgentView) => {
      // ⚠️ Naviguer **est** l'ouverture : le rendu se fonde sur la route. Mettre
      // à jour un état local sans toucher à la route ne faisait rien du tout.
      navigate({ kind: "agent", paneId: agent.paneId });
    },
    [navigate],
  );

  const onOpenWorkspace = useCallback(
    (workspaceId: string) => {
      setWorkspaceFilter(workspaceId);
      setStatusFilter("tous");
      navigate({ kind: "tab", tab: "agents" });
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

      {tab === "projets" ? (
        <section className="screen">
          <h2>Projets</h2>
          <p className="muted small">
            Toucher un projet ouvre son agent. Le <strong>+</strong> ajoute un agent — dans un
            projet vide, ou dans un nouvel onglet s'il en a déjà un.
          </p>
          {launchError !== null ? <p className="notice notice--error">{launchError}</p> : null}
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

      {tab === "agents" ? (
        <section className="screen">
          <h2>Agents</h2>
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
              {["working", "blocked", "idle", "done", "unknown"].map((status) => (
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
        </section>
      ) : null}

      {/*
        « À traiter » : ce qui demande une intervention, puis ce qui a bougé.
        Un simple journal est inutile — on commence par ce qui bloque, avec la
        question de l'agent et de quoi y répondre sans changer d'écran.
      */}
      {tab === "a-traiter" ? (
        <section className="screen">
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

          <h2>Sortie terminal</h2>
          <button
            type="button"
            className="ghost"
            onClick={onLoadTerminalClick}
            disabled={terminalLoading}
          >
            {terminalLoading ? "Lecture…" : "Lire la sortie terminal"}
          </button>
          {terminalError !== null ? <p className="notice notice--error">{terminalError}</p> : null}
          {terminal.length > 0 ? <pre className="terminal">{terminal.slice(-4000)}</pre> : null}
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
        {(
          [
            ["projets", "Projets"],
            ["agents", "Agents"],
            ["a-traiter", "À traiter"],
            ["reglages", "Réglages"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-tab={key}
            className={tab === key ? "tab tab--active" : "tab"}
            onClick={onTabClick}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
};
