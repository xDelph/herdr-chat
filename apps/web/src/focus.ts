/**
 * Piège de focus et touche de fermeture des feuilles (U11).
 *
 * ⚠️ Ce sont des **fonctions pures**, sans React ni DOM, pour une raison
 * précise : « le parcours clavier est complet » ne se vérifie pas en lisant un
 * composant. Il se vérifie en faisant défiler une liste de cibles, en
 * revenant au début après la dernière, en ignorant ce qui est masqué.
 *
 * Une feuille sans piège de focus laisse `Tab` sortir par le bas et repartir sur
 * la page **derrière** elle — l'utilisateur croit avoir fermé l'écran.
 */
export interface Cible {
  /**
   * Masqué dans la feuille.
   *
   * ⚠️ Le type accepte une chaîne parce que les types DOM de React déclarent
   * `hidden` ainsi : forcer un booléen ici obligerait à retransformer au
   * passage, et ce serait le seul endroit du projet à le faire.
   */
  readonly focus: (options?: FocusOptions) => void;
  readonly hidden: boolean | string | undefined;
  readonly tabIndex: number;
}

/** Le modificateur n'appartient pas à la fermeture. */
export interface Touche {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * `true` pour la seule touche qui ferme une feuille.
 *
 * Les modificateurs sont exclus : `Échap` sur un clavier azerty ou une
 * combinaison système ne doit pas fermer l'écran par surprise.
 */
export const toucheDeFermeture = (evenement: Touche): boolean =>
  evenement.key === "Escape" &&
  !evenement.altKey &&
  !evenement.ctrlKey &&
  !evenement.metaKey &&
  !evenement.shiftKey;

/**
 * Cibles réellement atteignables au `Tab`.
 *
 * `tabIndex` négatif : atteignable au programme, **pas** au clavier. Les
 * conserver laisserait le parcours s'arrêter sur un élément que l'utilisateur
 * ne peut pas voir. `hidden` : dans la feuille mais invisible.
 */
const masquee = (cible: Cible): boolean => cible.hidden === true || cible.hidden === "hidden";

export const ciblesVisibles = (toutes: ReadonlyArray<Cible>): ReadonlyArray<Cible> =>
  toutes.filter((cible) => !masquee(cible) && cible.tabIndex >= 0);

/**
 * Cible suivante dans le cycle, avec **rebouclage** aux deux extrémités.
 *
 * `depart` absent : la première cible, ce qui est le point d'entrée quand la
 * feuille s'ouvre. Liste vide : `null`, parce qu'il n'y a rien à prendre —
 * jamais une exception au milieu d'un rendu.
 */
export const cibleSuivante = (
  cibles: ReadonlyArray<Cible>,
  depart: Cible | null,
  versLeSuivant: boolean,
): Cible | null => {
  if (cibles.length === 0) return null;
  const index = depart === null ? -1 : cibles.indexOf(depart);
  if (index < 0) return cibles[0] ?? null;
  const pas = versLeSuivant ? 1 : -1;
  const suivant = (index + pas + cibles.length) % cibles.length;
  return cibles[suivant] ?? null;
};
