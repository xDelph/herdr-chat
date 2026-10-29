/**
 * Les mots de l'interface — **un seul endroit**, en français.
 *
 * Couleur = état : chaque statut a un mot, une forme et une couleur, et les
 * trois sont décidés ici et dans `ui/atomes.tsx`, nulle part ailleurs.
 */
import type { AgentStatus } from "@herdr-remote/shared";

export const LIBELLE_STATUT: Record<AgentStatus, string> = {
  blocked: "À toi",
  done: "Terminé",
  idle: "Au repos",
  unknown: "Inconnu",
  working: "Travaille",
};

/** Libellé d'un niveau de réflexion. Un niveau inconnu s'affiche tel quel. */
export const libelleReflexion = (niveau: string): string => {
  switch (niveau) {
    case "off":
      return "aucune";
    case "minimal":
      return "minimale";
    case "low":
      return "faible";
    case "medium":
      return "moyenne";
    case "high":
      return "haute";
    case "xhigh":
      return "très haute";
    case "max":
      return "maximale";
    default:
      return niveau;
  }
};

/** Monogramme et nom d'une famille d'agent. Une famille inconnue reste lisible. */
export const marqueAgent = (
  kind: string | null,
): { readonly lettres: string; readonly famille: string; readonly nom: string } => {
  switch (kind) {
    case "claude":
      return { famille: "claude", lettres: "C", nom: "Claude Code" };
    case "codex":
      return { famille: "codex", lettres: "Cx", nom: "Codex" };
    case "pi":
      return { famille: "pi", lettres: "π", nom: "Pi" };
    case "opencode":
      return { famille: "oc", lettres: "oc", nom: "opencode" };
    case "devin":
      return { famille: "devin", lettres: "D", nom: "Devin" };
    case null:
      return { famille: "inconnu", lettres: "?", nom: "Agent" };
    default:
      return { famille: "inconnu", lettres: kind.slice(0, 2), nom: kind };
  }
};

/**
 * Le titre d'une conversation, **sans la décoration de l'agent**.
 *
 * Herdr publie le titre du terminal tel que l'agent l'écrit : `π - herdr-pwa`,
 * `OC | Pixel naming`, `✳ Revue` ou `◑ Migration` (le glyphe tourne pendant le
 * travail). Le monogramme dit déjà quel agent parle, et le statut dit s'il
 * travaille : on retire le préfixe, rien d'autre.
 */
export const titrePropre = (titre: string | null | undefined): string => {
  if (titre === null || titre === undefined) return "";
  return titre.replace(/^\s*(?:π\s*[-–—]\s*|OC\s*\|\s*|[✳✻✶✷✸✹◐◑◒◓⠁-⣿·•*]+\s+)/u, "").trim();
};

/** Le premier non-vide d'une liste de libellés. */
export const premierNonVide = (...valeurs: ReadonlyArray<string | null | undefined>): string => {
  for (const valeur of valeurs) {
    const propre = valeur?.trim();
    if (propre !== undefined && propre.length > 0) return propre;
  }
  return "";
};

/** Dernier segment d'un chemin. */
export const dossierDe = (chemin: string | null | undefined): string | null => {
  if (chemin === null || chemin === undefined) return null;
  const morceaux = chemin.split("/").filter((morceau) => morceau.length > 0);
  return morceaux.at(-1) ?? null;
};

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/**
 * Le temps écoulé depuis une activité, au format de la liste.
 *
 * `à l'instant`, `25 min`, `3 h`, `hier`, `lun.`, puis la date. Plancher, jamais
 * d'arrondi vers le haut : une durée exagérée est ce qu'on compare avec son
 * souvenir.
 */
export const quand = (instant: number, maintenant: number): string => {
  const ecart = Math.max(0, maintenant - instant);
  const minutes = Math.floor(ecart / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `${String(minutes)} min`;
  const heures = Math.floor(minutes / 60);
  const date = new Date(instant);
  const aujourdhui = new Date(maintenant);
  const debutDuJour = new Date(
    aujourdhui.getFullYear(),
    aujourdhui.getMonth(),
    aujourdhui.getDate(),
  ).getTime();
  if (instant >= debutDuJour) return `${String(heures)} h`;
  const jours = Math.ceil((debutDuJour - instant) / 86_400_000);
  if (jours <= 1) return "hier";
  if (jours < 7) return JOURS[date.getDay()] ?? "";
  return `${String(date.getDate())} ${MOIS[date.getMonth()] ?? ""}`;
};

/** Un chronomètre : `0:38`, `4:05`, `1:02:03`. */
export const chrono = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const heures = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secondes = total % 60;
  const ss = String(secondes).padStart(2, "0");
  if (heures === 0) return `${String(minutes)}:${ss}`;
  return `${String(heures)}:${String(minutes).padStart(2, "0")}:${ss}`;
};

/** Des jetons, lisibles d'un regard : `850`, `18,4 k`, `1,2 M`. */
export const jetons = (nombre: number): string => {
  if (!Number.isFinite(nombre) || nombre <= 0) return "";
  if (nombre < 1000) return String(Math.round(nombre));
  if (nombre < 1_000_000) return `${(nombre / 1000).toFixed(1).replace(".", ",")} k`;
  return `${(nombre / 1_000_000).toFixed(1).replace(".", ",")} M`;
};

/** L'heure d'un horodatage ISO, ou `null` s'il est illisible. */
export const heureDe = (iso: string | null | undefined): string | null => {
  if (iso === null || iso === undefined) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/**
 * Un aperçu d'une ligne, **sans la syntaxe Markdown** : la liste montre
 * « Baseline (what the code…) », pas « ## Baseline » ni « ```ts ».
 *
 * Seule la ponctuation de mise en forme est retirée ; les mots restent.
 */
export const apercuTexte = (markdown: string): string =>
  markdown
    .replace(/```[\w-]*/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
