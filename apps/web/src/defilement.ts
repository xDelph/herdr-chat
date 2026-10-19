/**
 * Les règles de **défilement du fil** (T071) — pures, donc vérifiables.
 *
 * ⚠️ **Pourquoi ce module existe.** Trois décisions de défilement vivaient
 * éparpillées dans `ChatScreen` : où se poser quand une réponse arrive, quand
 * charger l'historique, et comment ne pas sauter quand on préfixe des messages.
 * Chacune a un cas limite qui se voit à l'œil nu (« la vue saute », « ça charge
 * deux fois », « ça ne charge jamais ») et aucune n'était testée, parce qu'elles
 * étaient mêlées au DOM. Ici elles sont des fonctions : on peut les affirmer.
 */

/**
 * Faut-il **suivre le bas** du fil ?
 *
 * ⚠️ La tolérance n'est pas un détail : un doigt sur un écran ne vise pas le
 * pixel, et un `scrollHeight` calculé pendant une animation de clavier diffère
 * de quelques pixels. 48 px est la marge du fil, on la garde.
 */
export const PIXELS_BAS = 48;

export const suitLeBas = (metriques: {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}): boolean => metriques.scrollHeight - metriques.scrollTop - metriques.clientHeight < PIXELS_BAS;

/**
 * Où se poser quand le statut d'un agent **change**.
 *
 * ⚠️ **La règle demandée est une règle de lecture, pas de statut** : si la
 * dernière réponse n'a pas été vue, on montre la **demande** qui l'a provoquée
 * (on lit la réponse *avec* sa question) ; si elle a été vue, on va **au bas**,
 * comme toute messagerie.
 *
 * L'application n'a pas d'état « lu » explicite : c'est le statut de l'agent qui
 * le porte. `done` = il a fini et personne ne l'a encore regardé ; `idle` = il
 * n'a rien à dire de neuf. D'où :
 *
 * - il **finissait** de travailler et il s'arrête → `demande` (réponse neuve) ;
 * - on **arrive** sur un agent déjà `done` → `demande` (on ne l'a pas vue) ;
 * - on arrive sur un agent `idle` → `bas` (rien de neuf à signaler) ;
 * - on lisait plus haut → `aucun` (on ne tire jamais quelqu'un de sa lecture).
 */
export type Ancrage = "demande" | "bas" | "aucun";

export const ancrage = (etat: {
  readonly avant: string | null;
  readonly apres: string;
  readonly suivaitLeBas: boolean;
}): Ancrage => {
  if (!etat.suivaitLeBas) return "aucun";
  /*
    ⚠️ **`blocked` va au BAS, pas à la demande.** Un agent bloqué pose une
    question : elle est le dernier contenu du fil. Ancrer la vue sur la demande
    laisserait la question hors de l'écran — on verrait la question sans la
    réponse… et sans la question. C'est l'inverse du but recherché.
  */
  if (etat.apres === "blocked") return "bas";
  const finitDeTravailler = etat.avant === "working" && etat.apres !== "working";
  if (finitDeTravailler) return "demande";
  // On arrive sur la conversation : `done` = réponse pas vue, sinon rien de neuf.
  if (etat.avant === null) return etat.apres === "done" ? "demande" : "bas";
  return "aucun";
};

/**
 * La position à appliquer **après avoir préfixé** des messages plus anciens.
 *
 * ⚠️ **Sans ce calcul, la vue saute.** Ajouter du contenu au-dessus d'une liste
 * défilante augmente `scrollHeight` sans toucher `scrollTop` : visuellement, le
 * texte qu'on lisait est poussé de la hauteur ajoutée, et l'utilisateur se
 * retrouve ailleurs. On compense donc exactement le delta — le message en cours
 * de lecture reste sous les yeux.
 */
export const positionApresPrepend = (mesure: {
  readonly hauteurAvant: number;
  readonly hauteurApres: number;
  readonly scrollAvant: number;
}): number => {
  const ajout = mesure.hauteurApres - mesure.hauteurAvant;
  // Un ajout négatif (liste reconstruite plus courte) ne doit pas produire une
  // position négative : on retombe sur 0, jamais sur une valeur impossible.
  return Math.max(0, mesure.scrollAvant + ajout);
};

/**
 * Faut-il déclencher le chargement de l'historique ?
 *
 * ⚠️ **Deux conditions, pas une.** Être près du haut ne suffit pas : tant qu'un
 * chargement est en cours, un second appui (ou un second passage de
 * l'observateur) doublerait la page. Et s'il n'y a plus de curseur, il n'y a
 * plus rien à charger — insister ferait tourner une boucle pour rien.
 */
export const doitChargerPlusTot = (etat: {
  readonly distanceAuHaut: number;
  readonly seuil: number;
  readonly curseurDisponible: boolean;
  readonly enCours: boolean;
}): boolean => etat.curseurDisponible && !etat.enCours && etat.distanceAuHaut <= etat.seuil;

/** La marge de déclenchement : on charge **avant** d'atteindre le bord. */
export const SEUIL_PREMIERES_LIGNES_PX = 240;
