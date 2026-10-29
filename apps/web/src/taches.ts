/**
 * Les tâches de fond d'un agent et les messages de son harnais — données et
 * règles, **sans rendu** (testables sans application).
 *
 * Deux sources, jamais confondues :
 *
 * - `/api/agents/{paneId}/taches` (H20) : la liste mesurée sur disque par le
 *   démon (sous-agents en arrière-plan, commandes passées en fond) ;
 * - les messages `custom` de la session (`customType` `subagent-report` /
 *   `task-notification`) : ce que le harnais de l'agent a écrit en rôle
 *   `user` sans que l'utilisateur l'ait tapé — un rapport de sous-agent n'est
 *   **jamais** une demande de l'utilisateur.
 *
 * ⚠️ **Un état invérifiable n'est pas affiché comme vrai** : `inconnu` reste
 * `inconnu` (ni fin écrite, ni activité récente), jamais « en cours ».
 */
import { Option, Schema } from "effect";
import { chrono, dureeLongue, quand } from "./libelles.ts";
import {
  BackgroundTasksResponse,
  SessionResponse,
  type BackgroundTask,
  type BackgroundTaskStatus,
} from "@herdr-remote/shared";

export type { BackgroundTask, BackgroundTaskStatus } from "@herdr-remote/shared";

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

const ErreurApi = Schema.Struct({ error: Schema.String });

const lire = async (chemin: string): Promise<unknown> => {
  const reponse = await fetch(chemin);
  const texte = await reponse.text();
  let corps: unknown;
  try {
    corps = JSON.parse(texte);
  } catch {
    throw new Error(`réponse illisible (${String(reponse.status)})`);
  }
  if (!reponse.ok) {
    const erreur = Option.getOrUndefined(Schema.decodeUnknownOption(ErreurApi)(corps));
    // La cause réelle, jamais un message générique.
    throw new Error(erreur?.error ?? `échec (${String(reponse.status)})`);
  }
  return corps;
};

/** H20 — les tâches de fond d'un pane. */
export const fetchTaches = async (paneId: string): Promise<BackgroundTasksResponse> => {
  const corps = await lire(`/api/agents/${encodeURIComponent(paneId)}/taches`);
  const decode = Option.getOrUndefined(Schema.decodeUnknownOption(BackgroundTasksResponse)(corps));
  if (decode === undefined) throw new Error("forme de réponse inattendue : taches");
  return decode;
};

/** H21 — une page de la transcription d'une tâche (curseurs opaques, comme H04). */
export const fetchSessionDeTache = async (
  paneId: string,
  id: string,
  options: { readonly cursor?: string; readonly before?: string } = {},
): Promise<SessionResponse> => {
  const requete = new URLSearchParams();
  if (options.cursor !== undefined) requete.set("cursor", options.cursor);
  if (options.before !== undefined) requete.set("before", options.before);
  const suffixe = requete.size > 0 ? `?${requete.toString()}` : "";
  const corps = await lire(
    `/api/agents/${encodeURIComponent(paneId)}/taches/${encodeURIComponent(id)}/session${suffixe}`,
  );
  const decode = Option.getOrUndefined(Schema.decodeUnknownOption(SessionResponse)(corps));
  if (decode === undefined) throw new Error("forme de réponse inattendue : transcription");
  return decode;
};

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------

/** Statut d'une tâche → mot, ton (couleur) et forme : jamais la couleur seule. */
export const STATUT_TACHE: Record<
  BackgroundTaskStatus,
  { readonly mot: string; readonly ton: "work" | "ok" | "err" | "idle" | "unknown" }
> = {
  arretee: { mot: "arrêtée", ton: "idle" },
  echouee: { mot: "échouée", ton: "err" },
  en_cours: { mot: "en cours", ton: "work" },
  inconnu: { mot: "état inconnu", ton: "unknown" },
  terminee: { mot: "terminée", ton: "ok" },
};

/** Le statut écrit par le harnais (`<status>`) → le statut du contrat. */
export const statutDuHarnais = (status: string | null): BackgroundTaskStatus | null => {
  switch (status) {
    case "completed":
      return "terminee";
    case "failed":
      return "echouee";
    case "killed":
    case "stopped":
    case "cancelled":
    case "canceled":
      return "arretee";
    case null:
      return null;
    default:
      return "inconnu";
  }
};

/** « 2 tâches de fond », « 1 tâche de fond ». */
export const nombreDeTaches = (nombre: number): string =>
  `${String(nombre)} ${nombre > 1 ? "tâches" : "tâche"} de fond`;

/** Le libellé d'une ligne de liste qui attend ses tâches, ou `null`. */
export const attenteDeTaches = (compte: { readonly enCours: number } | undefined): string | null =>
  compte === undefined || compte.enCours <= 0 ? null : `Attend ${nombreDeTaches(compte.enCours)}`;

/**
 * Le résumé d'une tâche, s'il dit quelque chose de plus que son titre :
 * « Agent "X" finished » répète la description et l'état ; « … failed with
 * exit code 1 » apporte le code de sortie.
 */
export const resumeUtile = (tache: BackgroundTask): string | null => {
  const resume = tache.summary;
  if (resume === undefined || tache.status === "en_cours") return null;
  if (tache.description !== undefined && resume === `Agent "${tache.description}" finished`)
    return null;
  return resume;
};

/** La sorte d'une tâche, en mots. */
export const sorteDeTache = (tache: BackgroundTask): string =>
  tache.kind === "commande" ? "Commande" : (tache.agentType ?? "Sous-agent");

// ---------------------------------------------------------------------------
// Messages du harnais (forme commune `custom`)
// ---------------------------------------------------------------------------

export const SORTES_HARNAIS = ["subagent-report", "task-notification"] as const;
export type SorteHarnais = (typeof SORTES_HARNAIS)[number];

/** Le bloc affiché d'un message du harnais. */
export interface RapportDeTache {
  readonly kind: "rapportTache";
  readonly sorte: SorteHarnais;
  readonly taskId: string | null;
  /** Le statut du contrat (déjà traduit), ou `null` s'il n'est pas écrit. */
  readonly status: BackgroundTaskStatus | null;
  readonly description: string | null;
  /** `agent` / `commande`, quand le harnais le dit. */
  readonly genre: "agent" | "commande" | null;
  /** `true` : le rapport final d'un sous-agent (`SubagentHandback`). */
  readonly handback: boolean;
  readonly dureeMs: number | null;
  /** Le corps, en Markdown. */
  readonly corps: string;
}

const texteDe = (objet: unknown, cle: string): string | null => {
  if (typeof objet !== "object" || objet === null) return null;
  const valeur: unknown = Reflect.get(objet, cle);
  return typeof valeur === "string" && valeur.length > 0 ? valeur : null;
};

const nombreDe = (objet: unknown, cle: string): number | null => {
  if (typeof objet !== "object" || objet === null) return null;
  const valeur: unknown = Reflect.get(objet, cle);
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
};

const estSorte = (valeur: string | null): valeur is SorteHarnais =>
  valeur === "subagent-report" || valeur === "task-notification";

/** `details.midTurn` : arrivé PENDANT un tour — n'en ouvre pas un. */
export const estPendantTour = (details: unknown): boolean =>
  typeof details === "object" && details !== null && Reflect.get(details, "midTurn") === true;

/**
 * Le bloc d'un message `custom` du harnais — `undefined` pour une autre sorte
 * (le rendu générique s'applique alors).
 */
export const rapportDe = (
  customType: string | undefined,
  details: unknown,
  corps: string,
): RapportDeTache | undefined => {
  const sorte = customType ?? null;
  if (!estSorte(sorte)) return undefined;
  const genre = texteDe(details, "kind");
  const usage =
    typeof details === "object" && details !== null ? Reflect.get(details, "usage") : undefined;
  return {
    corps,
    description: texteDe(details, "description"),
    dureeMs: nombreDe(usage, "durationMs"),
    genre: genre === "agent" || genre === "commande" ? genre : null,
    handback:
      typeof details === "object" && details !== null && Reflect.get(details, "handback") === true,
    kind: "rapportTache",
    sorte,
    status: statutDuHarnais(texteDe(details, "status")),
    taskId: texteDe(details, "taskId"),
  };
};

/** Ce qu'on sait d'une tâche, pour titrer son rapport. */
export interface InfoTache {
  readonly description: string | null;
  readonly status: BackgroundTaskStatus | null;
  readonly genre: "agent" | "commande" | null;
  /** Un rapport complet (`SubagentHandback`) existe dans le fil. */
  readonly rapport: boolean;
}

/**
 * Les informations des tâches, réunies depuis les messages du fil et la liste
 * du démon — la plus précise gagne (la liste, mesurée maintenant, sur la
 * notification, écrite à l'instant de la fin).
 */
export const infosDesTaches = (
  rapports: ReadonlyArray<RapportDeTache>,
  taches: ReadonlyArray<BackgroundTask>,
): ReadonlyMap<string, InfoTache> => {
  const infos = new Map<string, InfoTache>();
  for (const rapport of rapports) {
    if (rapport.taskId === null) continue;
    const connue = infos.get(rapport.taskId);
    infos.set(rapport.taskId, {
      description: rapport.description ?? connue?.description ?? null,
      genre: rapport.genre ?? connue?.genre ?? null,
      rapport:
        (connue?.rapport ?? false) || (rapport.sorte === "subagent-report" && rapport.handback),
      status: rapport.status ?? connue?.status ?? null,
    });
  }
  for (const tache of taches) {
    const connue = infos.get(tache.id);
    infos.set(tache.id, {
      description: tache.description ?? connue?.description ?? null,
      genre: tache.kind,
      rapport: connue?.rapport ?? false,
      status: tache.status,
    });
  }
  return infos;
};

/** Le titre d'une carte de rapport : « Rapport de sous-agent · Audit · terminée ». */
export const titreDuRapport = (
  rapport: RapportDeTache,
  info: InfoTache | undefined,
): ReadonlyArray<string> => {
  const genre = rapport.genre ?? info?.genre ?? null;
  const tete =
    rapport.sorte === "subagent-report"
      ? rapport.handback
        ? "Rapport de sous-agent"
        : "Message d'un agent"
      : genre === "commande"
        ? "Commande de fond"
        : "Tâche de fond";
  const description = rapport.description ?? info?.description ?? null;
  const statut =
    rapport.status ?? (rapport.sorte === "subagent-report" ? (info?.status ?? null) : null);
  return [tete, description, statut === null ? null : STATUT_TACHE[statut].mot].filter(
    (morceau): morceau is string => morceau !== null && morceau.length > 0,
  );
};

/** Les durées d'une tâche, en mots — rien n'est calculé sans ses deux bornes. */
export const dureesDe = (tache: BackgroundTask, maintenant: number): ReadonlyArray<string> => {
  const morceaux: string[] = [];
  if (tache.startedAt !== undefined && tache.endedAt !== undefined) {
    morceaux.push(`durée ${dureeLongue(tache.endedAt - tache.startedAt)}`);
  } else if (tache.startedAt !== undefined && tache.status === "en_cours") {
    morceaux.push(`depuis ${chrono(maintenant - tache.startedAt)}`);
  } else if (tache.startedAt !== undefined) {
    morceaux.push(`lancée ${quand(tache.startedAt, maintenant)}`);
  }
  if (tache.lastActivity !== undefined && tache.endedAt === undefined) {
    morceaux.push(`activité ${quand(tache.lastActivity, maintenant)}`);
  }
  return morceaux;
};

/** Au-delà, le corps d'un rapport est replié (aperçu + « Tout lire »). */
export const SEUIL_REPLI = 600;
