/**
 * L'image affichée en plein écran — une à la fois, pour toute l'application.
 * Toute image du fil (capture collée, rendu d'outil, image citée) s'y ouvre.
 */

export interface ImagePleinEcran {
  readonly source: string;
  readonly legende: string;
}

export interface MagasinPleinEcran {
  readonly ouvre: (image: ImagePleinEcran) => void;
  readonly ferme: () => void;
  readonly lit: () => ImagePleinEcran | null;
  readonly souscrire: (abonne: () => void) => () => void;
}

export const creeMagasinPleinEcran = (): MagasinPleinEcran => {
  let courante: ImagePleinEcran | null = null;
  const abonnes = new Set<() => void>();
  const previent = (): void => {
    for (const abonne of abonnes) abonne();
  };
  return {
    ferme: () => {
      if (courante === null) return;
      courante = null;
      previent();
    },
    lit: () => courante,
    ouvre: (image) => {
      courante = image;
      previent();
    },
    souscrire: (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
  };
};
