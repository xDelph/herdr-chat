/**
 * Les notifications d'écran — l'issue d'un geste annoncée **en haut de
 * l'écran**, comme le fait une application mobile, et non sous le composeur.
 *
 * ⚠️ **Une erreur reste jusqu'à ce qu'on la ferme** : sa cause doit pouvoir
 * être lue. Un succès ou une issue « à surveiller » part seul après quelques
 * secondes. Une même annonce répétée (double appui) ne s'empile pas.
 *
 * Pur : la minuterie est injectée, donc vérifiable sans attendre.
 */

export type Ton = "ok" | "attention" | "erreur";

export interface NotificationEcran {
  readonly id: number;
  readonly ton: Ton;
  readonly texte: string;
}

export type Planificateur = (action: () => void, delai: number) => () => void;

/** La durée d'affichage d'une issue qui n'est pas une erreur. */
export const DUREE_MS = 5000;
/** Au-delà, la plus ancienne part : l'écran ne se couvre pas de bandeaux. */
export const MAX_VISIBLES = 3;

export interface MagasinNotifications {
  readonly annonce: (ton: Ton, texte: string) => number;
  readonly ferme: (id: number) => void;
  readonly liste: () => ReadonlyArray<NotificationEcran>;
  readonly souscrire: (abonne: () => void) => () => void;
}

export const creeMagasinNotifications = (planifie: Planificateur): MagasinNotifications => {
  let visibles: ReadonlyArray<NotificationEcran> = [];
  const minuteries = new Map<number, () => void>();
  const abonnes = new Set<() => void>();
  let compteur = 0;
  const previent = (): void => {
    for (const abonne of abonnes) abonne();
  };
  const ferme = (id: number): void => {
    minuteries.get(id)?.();
    minuteries.delete(id);
    const restantes = visibles.filter((notification) => notification.id !== id);
    if (restantes.length === visibles.length) return;
    visibles = restantes;
    previent();
  };
  return {
    annonce: (ton, texte) => {
      const deja = visibles.find(
        (notification) => notification.ton === ton && notification.texte === texte,
      );
      if (deja !== undefined) return deja.id;
      compteur += 1;
      const id = compteur;
      visibles = [...visibles, { id, texte, ton }];
      while (visibles.length > MAX_VISIBLES) {
        const premiere = visibles[0];
        if (premiere === undefined) break;
        minuteries.get(premiere.id)?.();
        minuteries.delete(premiere.id);
        visibles = visibles.slice(1);
      }
      if (ton !== "erreur")
        minuteries.set(
          id,
          planifie(() => ferme(id), DUREE_MS),
        );
      previent();
      return id;
    },
    ferme,
    liste: () => visibles,
    souscrire: (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
  };
};
