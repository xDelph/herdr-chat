/**
 * Les envois **non résolus**, tous agents confondus (T060).
 *
 * ⚠️ **Pourquoi un store, et pas l'état d'un composant.** La mise à jour de la
 * PWA doit savoir s'il reste un message dont l'issue est inconnue — un
 * « sending » ou un « uncertain » peut être parti. Le composeur, lui, vit dans
 * `ChatScreen`. Plutôt que de faire remonter cet état jusqu'à `App`, on publie
 * ici le fait minimal : « il reste au moins un envoi non résolu ».
 *
 * ⚠️ Un seul booléen, jamais un compteur par agent : la mise à jour est
 * globale, et un compteur par pane donnerait l'illusion d'une précision que
 * personne n'utilise.
 */
let enCours = false;

/** Publie le fait — appelé par le composeur à chaque changement d'état. */
export const marqueEnvoisEnCours = (ilEnReste: boolean): void => {
  enCours = ilEnReste;
};

/** Reste-t-il un envoi non résolu ? */
export const envoiEnCours = (): boolean => enCours;

/** Remise à zéro — pour les tests uniquement. */
export const oublieEnvoisEnCours = (): void => {
  enCours = false;
};
