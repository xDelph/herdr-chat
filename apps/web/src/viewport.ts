/**
 * Ce que l'écran laisse réellement voir, clavier iOS compris.
 *
 * ⚠️ **Le clavier se déduit de la hauteur PLEINE mémorisée**, pas de
 * `innerHeight` : selon les versions d'iOS, `innerHeight` rétrécit aussi
 * quand le clavier monte, et la comparaison des deux ne voyait plus rien. La
 * hauteur pleine est la plus grande hauteur visible vue pour cette largeur ;
 * une rotation (largeur différente) la remet à zéro.
 *
 * Clavier ouvert, la marge de la zone sûre du bas (la barre d'accueil, ~34 px)
 * n'a plus lieu d'être : le clavier la recouvre. La garder laissait un vide
 * sous le champ de saisie.
 */

/** Au-delà de cet écart, ce n'est pas une barre d'outils qui bouge : c'est le clavier. */
export const SEUIL_CLAVIER_PX = 150;

export interface Mesure {
  readonly hauteur: number;
  readonly haut: number;
  readonly largeur: number;
}

export interface Vue {
  readonly hauteur: number;
  readonly haut: number;
  readonly clavier: boolean;
}

export const creeSuiviViewport = (): ((mesure: Mesure) => Vue) => {
  let pleine = 0;
  let largeurConnue = -1;
  return ({ hauteur, haut, largeur }) => {
    if (largeur !== largeurConnue) {
      largeurConnue = largeur;
      pleine = 0;
    }
    pleine = Math.max(pleine, hauteur);
    return {
      clavier: pleine - hauteur > SEUIL_CLAVIER_PX,
      haut: Math.max(0, haut),
      hauteur,
    };
  };
};
