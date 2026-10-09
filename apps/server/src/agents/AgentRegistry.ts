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
import type { AgentInfo, WorkspaceInfo } from "@herdr-remote/shared";
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

/** Enrichit un agent Herdr avec les métadonnées lues dans son fichier de session. */
const enrich = (agent: AgentInfo): Effect.Effect<AgentView> =>
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
      title: agent.terminal_title ?? null,
      workspaceId: agent.workspace_id,
    } satisfies AgentView;
  });

export const toAgentViews = (
  agents: ReadonlyArray<AgentInfo>,
): Effect.Effect<ReadonlyArray<AgentView>> => Effect.forEach(agents, enrich);

export const toWorkspaceViews = (
  workspaces: ReadonlyArray<WorkspaceInfo>,
): ReadonlyArray<WorkspaceView> =>
  workspaces.map((workspace) => ({
    agentStatus: workspace.agent_status ?? null,
    focused: workspace.focused ?? false,
    label: workspace.label ?? null,
    paneCount: workspace.pane_count ?? 0,
    tabCount: workspace.tab_count ?? 0,
    workspaceId: workspace.workspace_id,
  }));

/**
 * Construit la vue d'accueil.
 *
 * ⚠️ On lit `workspaces` **depuis le snapshot** plutôt que de le reconstruire
 * en regroupant les agents : Herdr porte déjà `agent_status`, `pane_count` et
 * `tab_count` par workspace, et une reconstruction divergerait.
 */
export const buildOverview = (snapshot: {
  readonly agents: ReadonlyArray<AgentInfo>;
  readonly workspaces: ReadonlyArray<WorkspaceInfo>;
  readonly version: string;
  readonly protocol: number;
}): Effect.Effect<OverviewView> =>
  Effect.gen(function* () {
    const agents = yield* toAgentViews(snapshot.agents);
    return {
      agents,
      herdrProtocol: snapshot.protocol,
      herdrVersion: snapshot.version,
      withoutSession: agents.filter((agent) => agent.sessionPath === null).length,
      workspaces: toWorkspaceViews(snapshot.workspaces),
    };
  });
