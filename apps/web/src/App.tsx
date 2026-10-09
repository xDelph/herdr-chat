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
  fetchHealth,
  fetchOverview,
  fetchSession,
  fetchTerminal,
  openEventStream,
  sendPrompt,
} from "./api.ts";
import type {
  AgentView,
  Health,
  Overview,
  SendResult,
  SessionEntry,
  WorkspaceView,
} from "./api.ts";

const TabSchema = Schema.Literals(["projets", "agents", "activite", "reglages"]);
type Tab = typeof TabSchema.Type;

/** Rend un événement du flux lisible, sans JSON brut à l'écran. */
const describeEvent = (kind: string, data: unknown): string => {
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

  if (kind === "agent_status") {
    const pane = decoded.paneId ?? "?";
    switch (decoded.kind) {
      case "appeared":
        return `${pane} — agent apparu (${decoded.to ?? "?"})`;
      case "disappeared":
        return `${pane} — agent disparu`;
      default:
        return `${pane} — ${statusLabel(decoded.from ?? "?")} → ${statusLabel(decoded.to ?? "?")}`;
    }
  }

  if (kind === "prompt")
    return `prompt envoyé à ${decoded.paneId ?? "?"} (${decoded.status ?? ""})`;
  if (kind === "prompt-suppressed") return `double envoi supprimé pour ${decoded.paneId ?? "?"}`;
  return kind;
};

/** Forme minimale reconnue d'une ligne de message de session. */
const MessageLine = Schema.Struct({
  message: Schema.optional(
    Schema.Struct({
      content: Schema.optional(Schema.Unknown),
      role: Schema.optional(Schema.String),
    }),
  ),
});
const decodeMessageLine = Schema.decodeUnknownOption(MessageLine);

/** Extrait le texte d'un contenu qui peut être une chaîne ou des blocs. */
const contentToText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const decoded = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Struct({ text: Schema.String }))(block),
      );
      return decoded?.text ?? "";
    })
    .join("");
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
const agentName = (agent: AgentView): string =>
  agent.workspaceLabel ?? agent.title ?? agent.agent ?? "agent";

const agentContext = (agent: AgentView): string => {
  const parts: string[] = [];
  if (agent.tabLabel !== null && agent.tabLabel !== undefined && agent.tabLabel.length > 0) {
    parts.push(agent.tabLabel);
  } else if (agent.tabNumber !== null && agent.tabNumber !== undefined) {
    parts.push(`onglet ${agent.tabNumber}`);
  }
  if (agent.agent !== null) parts.push(agent.agent);
  parts.push(agent.paneId);
  return parts.join(" · ");
};

const shortPath = (path: string | null): string => {
  if (path === null) return "—";
  const parts = path.split("/");
  return parts.length <= 3 ? path : `…/${parts.slice(-2).join("/")}`;
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
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [lastSend, setLastSend] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const placeholder = `Message à ${agentName(agent)}…`;

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
            : await fetchSession(agent.paneId, { tail: 131_072 });

        cursor.current = { offset: session.offset, path: session.sessionPath };

        if (session.incremental) {
          if (session.entries.length > 0) {
            setEntries((current) => [...current, ...session.entries]);
          }
        } else {
          setEntries(session.entries);
        }
        setError(null);
      } catch (cause) {
        // La cause réelle est affichée : pas de message générique qui masque.
        setError(cause instanceof Error ? cause.message : String(cause));
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  const messages = useMemo(
    () =>
      entries
        .filter((entry) => entry.type === "message")
        .flatMap((entry) => {
          const decoded = Option.getOrUndefined(decodeMessageLine(entry.raw));
          if (decoded === undefined) return [];
          const text = contentToText(decoded.message?.content);
          if (text.trim().length === 0) return [];
          return [
            { id: entry.id ?? entry.raw.slice(0, 12), role: decoded.message?.role ?? "?", text },
          ];
        }),
    [entries],
  );

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
    <section className="screen">
      <header className="screen__head">
        <button type="button" className="ghost" onClick={onBack}>
          ‹ Retour
        </button>
        <div>
          <strong>{agentName(agent)}</strong>
          <div className="muted small">
            {agentContext(agent)} · {statusLabel(agent.status)}
          </div>
        </div>
      </header>

      {agent.sessionPath === null ? (
        <p className="notice notice--warn">
          Aucun chemin de session exposé par Herdr pour cet agent. Le contenu n'est pas affichable —
          et il n'est pas reconstruit artificiellement.
        </p>
      ) : null}

      {error !== null ? <p className="notice notice--error">{error}</p> : null}

      <div className="messages">
        {messages.map((message) => (
          <article key={message.id} className={`bubble bubble--${message.role}`}>
            <span className="bubble__role">{message.role}</span>
            <pre className="bubble__text">{message.text}</pre>
          </article>
        ))}
        <div ref={endRef} />
      </div>

      <footer className="composer">
        <textarea value={draft} onChange={onDraftChange} placeholder={placeholder} rows={2} />
        <button type="button" onClick={onSubmit} disabled={sending}>
          {sending ? "…" : "Envoyer"}
        </button>
      </footer>

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
  );
};

/**
 * Ligne de projet. **Cliquable** : ouvre les agents de ce projet.
 *
 * Avant, la ligne était statique — le clic ne faisait rien, ce qui laissait
 * croire à une application cassée.
 */
const WorkspaceRow = ({
  workspace,
  onOpen,
}: {
  workspace: WorkspaceView;
  onOpen: (workspaceId: string) => void;
}) => {
  const handleClick = useCallback(
    () => onOpen(workspace.workspaceId),
    [onOpen, workspace.workspaceId],
  );

  return (
    <button type="button" className="row" onClick={handleClick}>
      <span className={statusClass(workspace.agentStatus ?? "unknown")} />
      <span className="row__main">
        <strong>{workspace.label ?? workspace.workspaceId}</strong>
        <span className="muted small">
          {workspace.paneCount} pane(s) · {workspace.tabCount} onglet(s)
        </span>
      </span>
      <span className="row__side small muted">voir les agents ›</span>
    </button>
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
    <button type="button" className="row" data-pane={agent.paneId} onClick={handleClick}>
      <span className={statusClass(agent.status)} />
      <span className="row__main">
        <strong>{agent.title ?? agent.paneId}</strong>
        <span className="muted small">
          {agent.paneId} · {agent.agent ?? "?"} · {statusLabel(agent.status)}
        </span>
      </span>
      <span className="row__side small muted">{shortPath(agent.cwd)}</span>
    </button>
  );
};

export const App = () => {
  const [tab, setTab] = useState<Tab>("projets");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<"live" | "down">("down");
  const activitySeq = useRef(0);
  const [activity, setActivity] = useState<readonly { at: number; id: number; text: string }[]>([]);
  const [selected, setSelected] = useState<AgentView | null>(null);
  const [terminal, setTerminal] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("tous");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("tous");

  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextHealth] = await Promise.all([fetchOverview(), fetchHealth()]);
      setOverview(nextOverview);
      setHealth(nextHealth);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(
    () =>
      openEventStream({
        onEvent: (kind, data) => {
          activitySeq.current += 1;
          const entry = {
            at: Date.now(),
            id: activitySeq.current,
            text: describeEvent(kind, data),
          };
          setActivity((current) => [entry, ...current].slice(0, 80));
          // Un changement d'état d'agent est le signal du **direct** : on
          // rafraîchit la vue, servie depuis le cache du veilleur.
          if (kind === "agent_status") void refresh();
        },
        onResync: () => {
          // Continuité rompue côté serveur : on recharge au lieu de croire
          // à un flux continu.
          activitySeq.current += 1;
          const entry = {
            at: Date.now(),
            id: activitySeq.current,
            text: "resync — journal tronqué, rechargement complet",
          };
          setActivity((current) => [entry, ...current]);
          void refresh();
        },
        onStatus: setLive,
      }),
    [refresh],
  );

  const agents = overview?.agents ?? [];
  const filtered = agents.filter(
    (agent) =>
      (statusFilter === "tous" || agent.status === statusFilter) &&
      (workspaceFilter === "tous" || agent.workspaceId === workspaceFilter),
  );

  // Handlers stables : évite de recréer une fonction à chaque rendu.
  const onTabClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const next = event.currentTarget.dataset["tab"];
    const valid = Option.getOrUndefined(Schema.decodeUnknownOption(TabSchema)(next));
    if (valid !== undefined) setTab(valid);
  }, []);
  const onWorkspaceFilter = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setWorkspaceFilter(event.target.value);
  }, []);
  const onStatusFilter = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(event.target.value);
  }, []);

  const closeAgent = useCallback(() => setSelected(null), []);

  const openAgent = useCallback(async (agent: AgentView) => {
    setSelected(agent);
    setTerminal("");
    try {
      const read = await fetchTerminal(agent.paneId);
      setTerminal(read.text);
    } catch {
      setTerminal("(sortie terminal indisponible)");
    }
  }, []);

  const onOpenWorkspace = useCallback((workspaceId: string) => {
    setWorkspaceFilter(workspaceId);
    setStatusFilter("tous");
    setTab("agents");
  }, []);

  const onOpenAgent = useCallback(
    (paneId: string) => {
      const agent = (overview?.agents ?? []).find((candidate) => candidate.paneId === paneId);
      if (agent !== undefined) void openAgent(agent);
    },
    [openAgent, overview],
  );

  if (selected !== null) {
    return (
      <div className="app">
        <ChatScreen agent={selected} onBack={closeAgent} />
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
          <p className="muted small">Toucher un projet ouvre ses agents.</p>
          <ul className="list">
            {overview?.workspaces.map((workspace) => (
              <li key={workspace.workspaceId}>
                <WorkspaceRow workspace={workspace} onOpen={onOpenWorkspace} />
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

      {tab === "activite" ? (
        <section className="screen">
          <h2>Activité</h2>
          {activity.length === 0 ? (
            <p className="muted">Aucun événement reçu.</p>
          ) : (
            <ul className="list list--compact">
              {activity.map((item) => (
                <li key={item.id} className="small mono">
                  {new Date(item.at).toLocaleTimeString()} — {item.text}
                </li>
              ))}
            </ul>
          )}
          {terminal.length > 0 ? (
            <details>
              <summary>Sortie terminal (lecture)</summary>
              <pre className="terminal">{terminal.slice(-4000)}</pre>
            </details>
          ) : null}
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
        </section>
      ) : null}

      <nav className="tabs">
        {(
          [
            ["projets", "Projets"],
            ["agents", "Agents"],
            ["activite", "Activité"],
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
