/**
 * Registre d'agents : assemble la vue affichée par la PWA.
 *
 * Deux sources, jamais mélangées :
 *
 * - **Herdr** (`session.snapshot`) → identité, état, workspace, **chemin de la
 *   session** (`agent_session.value`). C'est Herdr qui fournit le chemin : rien
 *   n'est deviné (D008, écart E1).
 * - **JSONL Pi** → contenu de la conversation. Le rattrapage après coupure
 *   vient d'ici, jamais d'Herdr (E3 : `revision` vaut toujours 0).
 *
 * Les champs optionnels d'`AgentInfo` sont réellement optionnels : `tokens` et
 * `state_labels` étaient **absents** sur l'instance mesurée, pas vides.
 */
import { Effect, Result, Schema } from "effect";
import type { AgentInfo, SnapshotPane, TabInfo, WorkspaceInfo } from "@herdr-remote/shared";
import { readHeader } from "../sessions/SessionReader.ts";

/** Vue d'un agent exposée à l'interface. */
export interface AgentView {
  readonly paneId: string;
  readonly tabId: string;
  readonly workspaceId: string;
  readonly agent: string | null;
  readonly title: string | null;
  readonly status: string;
  readonly cwd: string | null;
  readonly focused: boolean;
  /** Libellé humain de l'onglet. `null` = nom par défaut côté Herdr. */
  readonly tabLabel: string | null;
  readonly tabNumber: number | null;
  /** Libellé humain du projet. `null` = nom par défaut côté Herdr. */
  readonly workspaceLabel: string | null;
  /** Chemin absolu du fichier de session, fourni par Herdr. */
  readonly sessionPath: string | null;
  /** `path` ou `id` — dans quel référentiel `sessionPath`/`sessionId` vit. */
  readonly sessionKind: "id" | "path" | null;
  readonly sessionId: string | null;
  /** `cwd` de l'en-tête de session : sert à **vérifier** la corrélation. */
  readonly sessionCwd: string | null;
  /** `true` quand `sessionCwd` concorde avec `cwd` d'Herdr. */
  readonly sessionCwdMatches: boolean | null;
  /** Fenêtre de conversation : liaison avec la session d'origine si fork. */
  readonly parentSession: string | null;
}

export interface WorkspaceView {
  readonly workspaceId: string;
  readonly label: string | null;
  readonly agentStatus: string | null;
  readonly paneCount: number;
  readonly tabCount: number;
  readonly focused: boolean;
  /** Panes d'agents présents dans ce projet : sert à savoir s'il y en a déjà un. */
  readonly agentPanes: ReadonlyArray<string>;
  /** Chemin du projet — cible de lancement d'un nouvel agent. */
  readonly checkoutPath: string | null;
}

export interface OverviewView {
  readonly herdrVersion: string;
  readonly herdrProtocol: number;
  readonly workspaces: ReadonlyArray<WorkspaceView>;
  readonly agents: ReadonlyArray<AgentView>;
  /** Agents dont le chemin de session n'a pas pu être exploité. */
  readonly withoutSession: number;
}

export class SnapshotError extends Schema.TaggedError<SnapshotError>()("SnapshotError", {
  detail: Schema.String,
}) {}

/** Un libellé n'est utile que s'il n'est pas le numéro d'onglet par défaut. */
const usefulLabel = (label: string | null): string | null => {
  if (label === null || label.trim().length === 0) return null;
  return /^\d+$/.test(label.trim()) ? null : label;
};

/** Contexte de nommage : évite d'afficher des identifiants de pane à l'écran. */
export interface NamingContext {
  readonly workspaces: ReadonlyMap<string, string | null>;
  readonly tabs: ReadonlyMap<string, { label: string | null; number: number }>;
}

export const emptyNaming: NamingContext = { tabs: new Map(), workspaces: new Map() };

/** Construit le contexte de nommage depuis un snapshot. */
export const namingFrom = (
  workspaces: ReadonlyArray<WorkspaceInfo>,
  tabs: ReadonlyArray<TabInfo>,
): NamingContext => ({
  tabs: new Map(tabs.map((tab) => [tab.tab_id, { label: tab.label, number: tab.number }])),
  workspaces: new Map(
    workspaces.map((workspace) => [workspace.workspace_id, workspace.label ?? null]),
  ),
});

/** Enrichit un agent Herdr avec les métadonnées lues dans son fichier de session. */
export const enrichAgent = (
  agent: AgentInfo,
  naming: NamingContext = emptyNaming,
): Effect.Effect<AgentView> =>
  Effect.gen(function* () {
    const session = agent.agent_session ?? null;
    const path = session?.kind === "path" ? session.value : null;

    let sessionCwd: string | null = null;
    let sessionId: string | null = null;
    let parentSession: string | null = null;

    if (path !== null) {
      const header = Result.getOrUndefined(yield* Effect.result(readHeader(path)));
      if (header !== undefined) {
        sessionCwd = header.cwd ?? null;
        sessionId = header.id ?? null;
        parentSession = header.parentSession ?? null;
      }
    } else if (session !== null) {
      // `kind: "id"` : aucun mécanisme de résolution documenté (INCONNU, D008).
      // On expose l'identifiant sans inventer de chemin.
      sessionId = session.value;
    }

    const herdrCwd = agent.cwd ?? null;

    return {
      agent: agent.agent ?? null,
      cwd: herdrCwd,
      focused: agent.focused,
      paneId: agent.pane_id,
      parentSession,
      sessionCwd,
      // `null` = non vérifiable, volontairement distinct de `false`.
      sessionCwdMatches: sessionCwd !== null && herdrCwd !== null ? sessionCwd === herdrCwd : null,
      sessionId,
      sessionKind: session?.kind ?? null,
      sessionPath: path,
      status: agent.agent_status,
      tabId: agent.tab_id,
      // Herdr nomme les onglets par défaut « 1 », « 2 »… Un libellé purement
      // numérique n'apprend rien : on le traite comme absent et on affiche le
      // numéro d'onglet, qui au moins est exact.
      tabLabel: usefulLabel(naming.tabs.get(agent.tab_id)?.label ?? null),
      tabNumber: naming.tabs.get(agent.tab_id)?.number ?? null,
      title: agent.terminal_title ?? null,
      workspaceId: agent.workspace_id,
      workspaceLabel: naming.workspaces.get(agent.workspace_id) ?? null,
    } satisfies AgentView;
  });

export const toAgentViews = (
  agents: ReadonlyArray<AgentInfo>,
  naming: NamingContext = emptyNaming,
): Effect.Effect<ReadonlyArray<AgentView>> =>
  Effect.forEach(agents, (agent) => enrichAgent(agent, naming));

export const toWorkspaceViews = (
  workspaces: ReadonlyArray<WorkspaceInfo>,
  agents: ReadonlyArray<AgentView> = [],
  panes: ReadonlyArray<SnapshotPane> = [],
): ReadonlyArray<WorkspaceView> =>
  workspaces.map((workspace) => {
    // Dossier de travail : `worktree.checkout_path` quand il existe, sinon le
    // `cwd` du premier pane du projet. `worktree` est souvent `null`, alors
    // qu'un pane en porte toujours un.
    const paneCwd = panes.find(
      (pane) =>
        pane.workspace_id === workspace.workspace_id && pane.cwd !== null && pane.cwd !== undefined,
    )?.cwd;
    return {
      agentPanes: agents
        .filter((agent) => agent.workspaceId === workspace.workspace_id)
        .map((agent) => agent.paneId),
      agentStatus: workspace.agent_status ?? null,
      checkoutPath: workspace.worktree?.checkout_path ?? paneCwd ?? null,
      focused: workspace.focused ?? false,
      label: workspace.label ?? null,
      paneCount: workspace.pane_count ?? 0,
      tabCount: workspace.tab_count ?? 0,
      workspaceId: workspace.workspace_id,
    };
  });

/**
 * Construit la vue d'accueil.
 *
 * ⚠️ On lit `workspaces` **depuis le snapshot** plutôt que de le reconstruire
 * en regroupant les agents : Herdr porte déjà `agent_status`, `pane_count` et
 * `tab_count` par workspace, et une reconstruction divergerait.
 */
export const buildOverview = (snapshot: {
  readonly agents: ReadonlyArray<AgentInfo>;
  readonly panes: ReadonlyArray<SnapshotPane> | undefined;
  /**
   * `undefined` explicite, et non une propriété optionnelle : avec
   * `exactOptionalPropertyTypes`, `{ tabs: undefined }` n'est pas assignable à
   * une propriété optionnelle.
   */
  readonly tabs: ReadonlyArray<TabInfo> | undefined;
  readonly workspaces: ReadonlyArray<WorkspaceInfo>;
  readonly version: string;
  readonly protocol: number;
}): Effect.Effect<OverviewView> =>
  Effect.gen(function* () {
    const naming = namingFrom(snapshot.workspaces, snapshot.tabs ?? []);
    const agents = yield* toAgentViews(snapshot.agents, naming);
    return {
      agents,
      herdrProtocol: snapshot.protocol,
      herdrVersion: snapshot.version,
      withoutSession: agents.filter((agent) => agent.sessionPath === null).length,
      workspaces: toWorkspaceViews(snapshot.workspaces, agents, snapshot.panes ?? []),
    };
  });
