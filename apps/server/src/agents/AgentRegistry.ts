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
import { rangsDesPanes } from "@herdr-remote/shared";
import type {
  AgentInfo,
  AgentStatus,
  SnapshotPane,
  PaneLayout,
  TabInfo,
  WorkspaceInfo,
} from "@herdr-remote/shared";
import { readHeader } from "../sessions/SessionReader.ts";
import { sessionLisible, typeLisible } from "./Lisibilite.ts";
import { sourceSession } from "./SessionLocator.ts";

/** Vue d'un agent exposée à l'interface. */
export interface AgentView {
  readonly paneId: string;
  readonly tabId: string;
  readonly workspaceId: string;
  readonly agent: string | null;
  readonly title: string | null;
  /** État métier en union fermée (A04) : une string libre accepterait n'importe quoi. */
  readonly status: AgentStatus;
  readonly cwd: string | null;
  readonly focused: boolean;
  /** Libellé humain de l'onglet. `null` = nom par défaut côté Herdr. */
  readonly tabLabel: string | null;
  readonly tabNumber: number | null;
  /** Libellé humain du projet. `null` = nom par défaut côté Herdr. */
  readonly workspaceLabel: string | null;
  /** Nom exigé unique par `agent.start`. `null` = lancé à la main. */
  readonly name: string | null;
  /** Rang du pane dans son tab, en ordre de lecture. `null` si inconnu. */
  readonly paneRank: number | null;
  /** Nombre de panes du tab. `1` = seul. */
  readonly tabPaneCount: number;
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
/**
 * Nom à donner à un agent qu'on lance.
 *
 * ⚠️ **Herdr exige un nom unique** (il répond `agent_name_taken` sinon), et ce
 * nom est **visible** dès que l'onglet compte plusieurs panes — c'est l'étiquette
 * qui les distingue les uns des autres.
 *
 * ⚠️ **Le libellé du projet ne convient donc pas.** Mesuré : nommer le premier
 * agent d'un projet « pixel » faisait que son étiquette retombait sur
 * `pane N` — la règle écarte un nom qui ne dit rien de plus que la ligne du
 * dessus — pendant que ses voisins affichaient « pixel-2 », « pixel-3 ». Trois
 * libellés qui ne se ressemblaient pas pour la même chose.
 *
 * On numérote donc **dès le premier** : `pixel-1`, `pixel-2`… Uniforme, unique,
 * et jamais confondu avec le nom du projet.
 *
 * ⚠️ Un nom **choisi** par l'appelant passe tel quel : c'est le seul qui vienne
 * de quelqu'un.
 */
export const nomDeLancement = (base: string, pris: ReadonlySet<string>): string => {
  for (let suffixe = 1; suffixe < 100; suffixe += 1) {
    const candidat = `${base}-${String(suffixe)}`;
    if (!pris.has(candidat)) return candidat;
  }
  // Cent agents du même nom : on rend le dernier essayé plutôt que rien.
  return `${base}-1`;
};

export const usefulLabel = (label: string | null): string | null => {
  if (label === null || label.trim().length === 0) return null;
  return /^\d+$/.test(label.trim()) ? null : label;
};

/**
 * Dossier de travail d'un projet — **source unique**.
 *
 * `worktree.checkout_path` est **souvent `null`** ; le `cwd` du premier pane du
 * projet, lui, existe toujours. Deux chemins de calcul pour la même donnée
 * avaient divergé : l'aperçu trouvait le dossier, le lancement non — d'où
 * « aucun dossier de travail connu » sur un projet parfaitement valide.
 */
export const checkoutPathOf = (
  workspace: WorkspaceInfo,
  panes: ReadonlyArray<SnapshotPane>,
): string | null =>
  workspace.worktree?.checkout_path ??
  panes.find(
    (pane) =>
      pane.workspace_id === workspace.workspace_id && pane.cwd !== null && pane.cwd !== undefined,
  )?.cwd ??
  null;

/**
 * Contexte de nommage : évite d'afficher des identifiants de pane à l'écran.
 *
 * ⚠️ **Il porte aussi les dispositions**, et ce n'est pas un abus de langage : la
 * question à laquelle il répond est « comment nommer et **situer** ce pane ? ».
 * Le rang dans le tab vient de la disposition, et c'est le seul discriminant
 * possible — Herdr ne numérote pas les panes.
 */
export interface NamingContext {
  readonly workspaces: ReadonlyMap<string, string | null>;
  readonly tabs: ReadonlyMap<string, { label: string | null; number: number }>;
  /** Par pane : son rang dans son tab, et le nombre de panes du tab. */
  readonly panes: ReadonlyMap<string, { rank: number | null; tabPaneCount: number }>;
}

export const emptyNaming: NamingContext = {
  panes: new Map(),
  tabs: new Map(),
  workspaces: new Map(),
};

/**
 * Construit le contexte de nommage depuis un snapshot.
 *
 * ⚠️ `layouts` est **optionnel** : un snapshot sans dispositions reste
 * exploitable, les agents n'ont simplement pas de rang. Le nommage d'un agent
 * lancé par Herdr (`name`) continue de fonctionner, lui.
 */
export const namingFrom = (
  workspaces: ReadonlyArray<WorkspaceInfo>,
  tabs: ReadonlyArray<TabInfo>,
  layouts: ReadonlyArray<PaneLayout> = [],
): NamingContext => {
  const panes = new Map<string, { rank: number | null; tabPaneCount: number }>();
  for (const layout of layouts) {
    const rangs = rangsDesPanes(layout.panes);
    for (const pane of layout.panes) {
      panes.set(pane.pane_id, {
        rank: rangs.get(pane.pane_id) ?? null,
        tabPaneCount: layout.panes.length,
      });
    }
  }
  return {
    panes,
    tabs: new Map(tabs.map((tab) => [tab.tab_id, { label: tab.label, number: tab.number }])),
    workspaces: new Map(
      workspaces.map((workspace) => [workspace.workspace_id, workspace.label ?? null]),
    ),
  };
};

/** Enrichit un agent Herdr avec les métadonnées lues dans son fichier de session. */
export const enrichAgent = (
  agent: AgentInfo,
  naming: NamingContext = emptyNaming,
): Effect.Effect<AgentView> =>
  Effect.gen(function* () {
    const session = agent.agent_session ?? null;
    // ⚠️ Résolution unique : `path` passe tel quel, `id` est résolu pour codex
    // (nom de fichier) et pour opencode (clé de base).
    const source = sourceSession(agent.agent ?? null, session);
    // Pour opencode, `base` est le fichier SQLite : c'est ce qui rend l'agent
    // **visible**, puisque c'est la présence d'un chemin qui le fait figurer dans
    // la liste. Le chemin du magasin est donc le bon, et non un chemin de session.
    const path = source?.base ?? null;

    let sessionCwd: string | null = null;
    let sessionId: string | null = null;
    let parentSession: string | null = null;

    if (source?.kind === "fichier") {
      const header = Result.getOrUndefined(yield* Effect.result(readHeader(source.base)));
      if (header !== undefined) {
        sessionCwd = header.cwd ?? null;
        sessionId = header.id ?? null;
        parentSession = header.parentSession ?? null;
      }
    } else if (source?.kind === "sqlite") {
      // Pas d'en-tête à lire dans une base : l'identifiant **est** celui
      // qu'Herdr expose, et c'est la clé primaire de `session_v2`. On ne lit
      // donc rien ici — la lecture coûteuse appartient à la route de session.
      sessionId = source.sessionId;
    } else if (session !== null) {
      // `kind: "id"` sans mécanisme de résolution (devin, INCONNU, D008).
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
      // ⚠️ Le nom vient de l'agent, le rang de la **disposition de son tab** :
      // deux sources, deux questions differentes (« comment s'appelle-t-il ? »,
      // « ou est-il ? »). Un pane absent du contexte (snapshot partiel) n'a pas
      // de rang, et l'etiquette saura s'en passer.
      name: agent.name ?? null,
      paneRank: naming.panes.get(agent.pane_id)?.rank ?? null,
      tabPaneCount: naming.panes.get(agent.pane_id)?.tabPaneCount ?? 1,
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
    return {
      agentPanes: agents
        .filter((agent) => agent.workspaceId === workspace.workspace_id)
        .map((agent) => agent.paneId),
      agentStatus: workspace.agent_status ?? null,
      checkoutPath: checkoutPathOf(workspace, panes),
      focused: workspace.focused ?? false,
      label: workspace.label ?? null,
      paneCount: workspace.pane_count ?? 0,
      tabCount: workspace.tab_count ?? 0,
      workspaceId: workspace.workspace_id,
    };
  });

/**
 * Répartit les agents : ceux qu'on sait lire, et le nombre de ceux qu'on ne peut pas.
 *
 * ⚠️ **Un seul endroit applique cette règle**, parce qu'il y a deux chemins pour
 * `/api/overview` : un rapide qui sert le cache du veilleur, et un lent qui relit
 * le snapshot. Le filtre n'était appliqué qu'au lent — le chemin **rapide**, donc
 * celui qui sert la plupart du temps, exposait encore les agents muets. C'est
 * exactement ce que « deux endroits pour la même règle » produit : le second
 * finit par ne plus être à jour.
 */
/**
 * Un agent est-il a montrer ?
 *
 * ⚠️ **La regle a change deux fois, et la mesure l'a imposee chaque fois.**
 *
 * 1. Elle etait « a une session lisible ». Sur un tab a cinq panes reels, trois
 *    agents sur cinq ont donc disparu : codex, claude et opencode n'ecrivent
 *    leur session qu'au premier message. Or l'un des trois etait **`blocked`** —
 *    et le veilleur lit ces memes vues, donc il ne l'a jamais surveille : ni
 *    ligne, ni notification. Le seul agent qui attendait une reponse etait celui
 *    qu'on ne voyait pas.
 * 2. Elle est devenue « lisible OU l'etat demande quelque chose ». Restait le cas
 *    du tab a plusieurs panes : les verificateurs **au repos et sans session**
 *    restaient invisibles, alors que le tab est justement l'unite de travail
 *    qu'on veut voir entiere.
 *
 * 3. Elle ignorait le **type** de l'agent. Un agent dont on **sait** lire la
 *    session n'est pourtant pas un agent muet : c'est un agent dont Herdr n'a pas
 *    publie la session.
 *
 * ⚠️ **Mesure du 2026-10-17, `wB:p1B`.** Un agent codex qui avait reellement
 * travaille (sa session est sur le disque, `~/.codex/sessions/2026/10/17/`) a
 * **disparu de la liste** : plus de session exposee, etat `done`, seul dans son
 * onglet. Sa session existait ; c'est `pane.report_agent_session` du cote
 * d'Herdr qui echouait (« api request completed outcome=error », au moment exact
 * de la creation de la session). L'application l'a donc masque **alors qu'il
 * venait de travailler** — le seul agent qu'on veut voir est celui qu'on ne voit
 * plus. Conclure « pas de session » = « rien a dire » etait une premisse fausse.
 *
 * La regle est donc : **lisible, OU l'etat demande quelque chose, OU le tab
 * compte plusieurs panes, OU le type est un type dont on sait lire la session.**
 *
 * ⚠️ Le dernier cas est le plus faible des quatre, et c'est assume : il dit
 * seulement « cette famille d'agent produit une session que nous savons lire ».
 * Il ne montre **aucun** contenu — un agent sans session ouverte garde son
 * panneau neutre. Il refuse juste de faire disparaitre l'agent.
 *
 * ⚠️ La signature est **structurelle** et pas `AgentView` : la route des
 * conversations travaille sur l'`AgentInfo` brut, et elle doit appliquer la meme
 * regle. Deux expressions de cette regle divergeraient — c'est exactement ce que
 * U14 interdit.
 */
export const attireLeRegard = (status: AgentStatus): boolean =>
  status === "blocked" || status === "working";

export const estVisible = (agent: {
  readonly kind: string | null;
  readonly sessionPath: string | null;
  readonly status: AgentStatus;
  readonly tabPaneCount: number;
}): boolean =>
  sessionLisible(agent.sessionPath) ||
  attireLeRegard(agent.status) ||
  agent.tabPaneCount > 1 ||
  typeLisible(agent.kind ?? "");

export const repartirAgents = (
  tous: ReadonlyArray<AgentView>,
): { readonly agents: ReadonlyArray<AgentView>; readonly masquees: number } => ({
  agents: tous.filter((agent) =>
    estVisible({
      kind: agent.agent,
      sessionPath: agent.sessionPath,
      status: agent.status,
      tabPaneCount: agent.tabPaneCount,
    }),
  ),
  masquees: tous.filter(
    (agent) =>
      !estVisible({
        kind: agent.agent,
        sessionPath: agent.sessionPath,
        status: agent.status,
        tabPaneCount: agent.tabPaneCount,
      }),
  ).length,
});

/**
 * Compose la vue d'accueil à partir d'agents **déjà convertis**.
 *
 * Les deux chemins de `/api/overview` passent par ici : le cache du veilleur et
 * le snapshot relu ne peuvent donc pas diverger sur ce qui est visible.
 */
export const composerOverview = ({
  herdrProtocol,
  herdrVersion,
  panes,
  tous,
  workspaces,
}: {
  readonly herdrProtocol: number;
  readonly herdrVersion: string;
  readonly panes: ReadonlyArray<SnapshotPane> | undefined;
  readonly tous: ReadonlyArray<AgentView>;
  readonly workspaces: ReadonlyArray<WorkspaceInfo>;
}) => {
  const { agents, masquees } = repartirAgents(tous);
  return {
    agents,
    herdrProtocol,
    herdrVersion,
    withoutSession: masquees,
    workspaces: toWorkspaceViews(workspaces, agents, panes ?? []),
  };
};

/**
 * Construit la vue d'accueil depuis le snapshot brut.
 *
 * ⚠️ On lit `workspaces` **depuis le snapshot** plutôt que de le reconstruire en
 * regroupant les agents : Herdr porte déjà `agent_status`, `pane_count` et
 * `tab_count` par projet, et une reconstruction divergerait.
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
  /** Dispositions des tabs : source du rang de chaque pane. */
  readonly layouts?: ReadonlyArray<PaneLayout> | undefined;
  readonly workspaces: ReadonlyArray<WorkspaceInfo>;
  readonly version: string;
  readonly protocol: number;
}): Effect.Effect<OverviewView> =>
  Effect.gen(function* () {
    const naming = namingFrom(snapshot.workspaces, snapshot.tabs ?? [], snapshot.layouts ?? []);
    const tous = yield* toAgentViews(snapshot.agents, naming);
    return composerOverview({
      herdrProtocol: snapshot.protocol,
      herdrVersion: snapshot.version,
      panes: snapshot.panes,
      tous,
      workspaces: snapshot.workspaces,
    });
  });
