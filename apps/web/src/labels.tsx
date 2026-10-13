/**
 * Nommage et libellés d'un agent — **partagés par tous les écrans** (A02).
 *
 * Ces aides vivaient au milieu de la navigation dans un `App.tsx` de plus de
 * 1100 lignes, alors que quatre écrans les utilisent. Les déplacer ensemble
 * évite d'avoir à les dupliquer.
 */
import type { AgentStatus, AgentView } from "@herdr-remote/shared";

/**
 * Libellés par état.
 *
 * La clé est **typée** : un état absent de cette table ne compile pas, donc
 * impossible d'oublier un libellé en ajoutant un état à l'union (A04).
 */
export const STATUS_LABEL: Record<AgentStatus, string> = {
  blocked: "waiting for input",
  done: "finished",
  idle: "idle",
  unknown: "unknown status",
  working: "working",
};

/** Tous les états, dans l'ordre d'affichage du filtre. */
export const ALL_STATUSES = ["working", "blocked", "idle", "done", "unknown"] as const;

/** L'état vient du contrat : pas de repli qui laisserait fuire la valeur brute. */
export const statusLabel = (status: AgentStatus): string => STATUS_LABEL[status];

/** Couleur sémantique : `unknown` est neutre, jamais vert ni rouge. */
export const statusClass = (status: AgentStatus): string => {
  switch (status) {
    case "working":
      return "dot dot--working";
    case "blocked":
      return "dot dot--blocked";
    case "done":
      return "dot dot--done";
    case "idle":
      return "dot dot--idle";
    case "unknown":
      return "dot dot--unknown";

    default:
      // Inatteignable tant que l'union ne change pas : on le dit plutôt que de
      // rendre `undefined` et de casser la classe CSS en silence.
      return "dot dot--unknown";
  }
};

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
export const agentName = (agent: AgentView): string =>
  agent.workspaceLabel ??
  basename(agent.cwd) ??
  basename(agent.sessionCwd) ??
  agent.title ??
  agent.agent ??
  "Unnamed agent";

/**
 * Contexte d'un agent : onglet, type, dossier.
 *
 * **Aucun identifiant interne.** Un identifiant de pane ou de projet n'a jamais
 * aidé quelqu'un à comprendre ce qu'il regarde.
 */
export const agentContext = (agent: AgentView): string => {
  const parts: string[] = [];
  if (agent.tabLabel !== null && agent.tabLabel !== undefined && agent.tabLabel.length > 0) {
    parts.push(agent.tabLabel);
  } else if (agent.tabNumber !== null && agent.tabNumber !== undefined) {
    // ⚠️ Plusieurs agents dans un même projet portent le même nom. Sans le
    // numéro d'onglet, les lignes sont **indistinguables**.
    parts.push(`tab ${agent.tabNumber}`);
  }
  if (agent.agent !== null) parts.push(agent.agent);
  const folder = basename(agent.cwd);
  if (folder !== null && folder !== agent.workspaceLabel) parts.push(folder);
  return parts.join(" · ");
};

/**
 * Ligne de contexte de l'en-tête de conversation.
 *
 * Le statut passe **devant** le détail : sur un iPhone, cette ligne est
 * tronquée à l'ellipse, et le détail d'onglet ne vaut rien une fois coupé —
 * contrairement à « en cours » ou « attend une réponse ».
 */
export const headerContext = (agent: AgentView): string => {
  const status = statusLabel(agent.status);
  const detail = agentContext(agent);
  return detail.length === 0 ? status : `${status} · ${detail}`;
};
