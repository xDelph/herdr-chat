/**
 * Où l'on était dans une conversation — **retenu d'une visite à l'autre**.
 *
 * ⚠️ **Le défaut rapporté.** On lit une réponse sur l'ordinateur, on lance un
 * prompt depuis le Mac, on revient sur la PWA : le fil reste là où il était,
 * c'est-à-dire nulle part — en haut. La règle d'ancrage ne s'applique qu'aux
 * **changements d'état observés pendant qu'on regarde** ; elle ne dit rien d'un
 * retour dans une conversation qu'on avait quittée.
 *
 * ⚠️ **Pourquoi une position relative et pas un message.** Un identifiant de
 * message serait plus précis, mais il exige que le message existe encore : une
 * session qui a tourné, un reset, une purge, et la position ne désigne plus
 * rien. Le **ratio** de défilement survit à un contenu qui grandit, et il n'a
 * besoin d'aucun identifiant côté rendu.
 *
 * ⚠️ **Deux informations, pas une.** « J'étais en bas » n'est pas « j'étais à
 * 100 % » : quand du contenu arrive, celui qui suivait le direct veut le
 * nouveau bas, pas l'ancien.
 */

/** Ce qu'on retient d'une conversation. */
export interface PositionMemorisee {
  /** L'utilisateur suivait-il le bas du fil ? */
  readonly bas: boolean;
  /** Le ratio de défilement (0 = haut, 1 = bas), quand `bas` est faux. */
  readonly ratio: number;
}

/** La clé de stockage — une par pane, préfixée pour ne pas heurter le reste. */
export const cleDePosition = (paneId: string): string => `herdr:defilement:${paneId}`;

/**
 * Ce qu'il faut retenir d'un état de défilement.
 *
 * ⚠️ **`clientHeight` peut dépasser `scrollHeight`** quand la conversation est
 * plus courte que l'écran : le ratio vaudrait alors une valeur négative, qu'on
 * borne à 0. Sans cette borne, un retour sur un fil court scrollait « au-dessus
 * du début ».
 */
export const positionAffichee = (metriques: {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly seuilBas: number;
}): PositionMemorisee => {
  const { scrollTop, scrollHeight, clientHeight, seuilBas } = metriques;
  const bas = scrollHeight - scrollTop - clientHeight < seuilBas;
  if (bas) return { bas: true, ratio: 1 };
  const course = scrollHeight - clientHeight;
  if (course <= 0) return { bas: false, ratio: 0 };
  return { bas: false, ratio: Math.min(1, Math.max(0, scrollTop / course)) };
};

/** Le `scrollTop` à appliquer pour reprendre une position mémorisée. */
export const hauteurDeReprise = (
  position: PositionMemorisee,
  metriques: { readonly scrollHeight: number; readonly clientHeight: number },
): number => {
  const course = Math.max(0, metriques.scrollHeight - metriques.clientHeight);
  // Suivre le bas reste suivre le bas, même quand du contenu est arrivé depuis.
  if (position.bas) return course;
  return Math.round(position.ratio * course);
};

/** Le stockage injecté — les tests n'ont pas de `localStorage`. */
export interface Stockage {
  readonly lit: (cle: string) => string | null;
  readonly ecrit: (cle: string, valeur: string) => void;
}

/** `localStorage` de la plateforme, ou un stockage muet s'il est indisponible. */
export const stockageNavigateur = (): Stockage => {
  try {
    const local = globalThis.localStorage;
    // Safari privé lève à l'écriture : on préfère un stockage muet à une
    // exception qui casserait le rendu du fil.
    return {
      ecrit: (cle, valeur) => {
        local.setItem(cle, valeur);
      },
      lit: (cle) => local.getItem(cle),
    };
  } catch {
    return { ecrit: () => undefined, lit: () => null };
  }
};

/** Lit la position d'une conversation ; une valeur illisible vaut « inconnue ». */
export const litPosition = (stockage: Stockage, paneId: string): PositionMemorisee | null => {
  const brut = stockage.lit(cleDePosition(paneId));
  if (brut === null) return null;
  try {
    const valeur: unknown = JSON.parse(brut);
    if (typeof valeur !== "object" || valeur === null) return null;
    const { bas, ratio } = valeur as { bas?: unknown; ratio?: unknown };
    if (typeof bas !== "boolean" || typeof ratio !== "number" || !Number.isFinite(ratio)) {
      return null;
    }
    return { bas, ratio: Math.min(1, Math.max(0, ratio)) };
  } catch {
    return null;
  }
};

/** Retient la position d'une conversation. */
export const ecritPosition = (
  stockage: Stockage,
  paneId: string,
  position: PositionMemorisee,
): void => {
  try {
    stockage.ecrit(cleDePosition(paneId), JSON.stringify(position));
  } catch {
    // Un stockage plein ne doit jamais empêcher de lire une conversation.
  }
};
