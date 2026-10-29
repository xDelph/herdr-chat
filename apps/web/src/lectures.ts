/**
 * Ce que **j'ai lu** — tenu sur le téléphone, indépendant d'Herdr.
 *
 * ⚠️ **Pourquoi (revue du 2026-10-17, point 7).** Le seul « lu » qui existait
 * était le statut `done` d'Herdr, et la seule façon de l'acquitter était de
 * poser le focus sur le pane — donc de **voler le clavier du Mac** en lisant sur
 * le téléphone. Lire ne touche plus au Mac : la lecture est notée ici, et le
 * focus bureau est une action explicite du menu.
 *
 * La conséquence est assumée : un agent `done` reste `done` côté Herdr tant
 * qu'on ne l'a pas regardé sur le Mac. Le point « non lu » de la liste, lui,
 * s'éteint dès qu'on a ouvert la conversation ici.
 *
 * ⚠️ Ce n'est pas du contenu : un horodatage par pane, rien d'autre.
 */
import type { Stockage } from "./memoire-defilement.ts";

const CLE = "herdr-chat.lectures";
/** Au-delà, les plus anciennes lectures sont oubliées. */
const MAXIMUM = 200;

export type Lectures = ReadonlyMap<string, number>;

export const litLectures = (stockage: Stockage): Lectures => {
  const brut = stockage.lit(CLE);
  if (brut === null) return new Map();
  try {
    const valeur: unknown = JSON.parse(brut);
    if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return new Map();
    const lectures = new Map<string, number>();
    for (const [pane, instant] of Object.entries(valeur)) {
      if (typeof instant === "number" && Number.isFinite(instant)) lectures.set(pane, instant);
    }
    return lectures;
  } catch {
    return new Map();
  }
};

/** Note qu'on a vu la conversation jusqu'à `instant` (jamais en arrière). */
export const noteLecture = (lectures: Lectures, paneId: string, instant: number): Lectures => {
  const deja = lectures.get(paneId);
  if (deja !== undefined && deja >= instant) return lectures;
  const suivantes = new Map(lectures);
  suivantes.set(paneId, instant);
  if (suivantes.size > MAXIMUM) {
    const triees = [...suivantes.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, MAXIMUM);
    return new Map(triees);
  }
  return suivantes;
};

export const ecritLectures = (stockage: Stockage, lectures: Lectures): void => {
  try {
    stockage.ecrit(CLE, JSON.stringify(Object.fromEntries(lectures)));
  } catch {
    // Stockage plein ou interdit : la lecture vaut pour la session, c'est tout.
  }
};

/**
 * Une conversation a-t-elle du **neuf** pour moi ?
 *
 * - jamais ouverte ici : seul `done` (Herdr dit « fini, pas encore vu ») compte ;
 * - déjà ouverte : non lue si sa dernière activité est **postérieure** à ma
 *   dernière lecture.
 *
 * Sans horodatage, on ne sait pas : on ne marque rien plutôt que de deviner.
 */
export const estNonLue = (
  conversation: {
    readonly paneId: string;
    readonly status: string;
    readonly timestamp?: number | undefined;
  },
  lectures: Lectures,
): boolean => {
  if (conversation.status === "working" || conversation.status === "blocked") return false;
  const vue = lectures.get(conversation.paneId);
  if (vue === undefined) return conversation.status === "done";
  return conversation.timestamp !== undefined && conversation.timestamp > vue;
};
