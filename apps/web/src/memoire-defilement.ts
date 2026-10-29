/**
 * Où l'on était dans une conversation — **pour la durée de l'onglet**.
 *
 * ⚠️ **Le premier défaut.** On lit une réponse sur l'ordinateur, on revient sur
 * la PWA : le fil repartait en haut. Il fallait retenir la position.
 *
 * ⚠️ **Le second défaut (P1), introduit par le correctif du premier.** La
 * position était un **ratio** de défilement, gardé dans `localStorage` **pour
 * toujours**. Le contenu grandit, l'historique se charge par pages : 0,4 d'un
 * fil de trois pages n'est pas 0,4 d'un fil de dix. On rouvrait la
 * conversation au milieu de nulle part, des jours après.
 *
 * ⚠️ **La règle désormais :**
 *
 * - on retient le **message** en haut de l'écran et son décalage, pas un
 *   ratio ; un message se retrouve quelle que soit la taille du fil ;
 * - dans `sessionStorage` : la mémoire vit avec l'onglet, pas au-delà ;
 * - si du neuf est arrivé depuis (le dernier message n'est plus le même), la
 *   mémoire est **oubliée** : la règle par défaut s'applique (le bas, ou la
 *   dernière demande d'une réponse terminée) ;
 * - « je suivais le bas » reste « je suis en bas ».
 */

/** Ce qu'on retient d'une conversation. */
export interface PositionMemorisee {
  /** L'utilisateur suivait-il le bas du fil ? */
  readonly bas: boolean;
  /** La clé de l'élément en haut de l'écran, quand `bas` est faux. */
  readonly ancre: string | null;
  /** L'écart, en px, entre le haut de cet élément et le haut du fil visible. */
  readonly decalage: number;
  /** La clé du dernier élément du fil au moment où la position a été retenue. */
  readonly dernier: string | null;
}

/** La clé de stockage — une par pane, préfixée pour ne pas heurter le reste. */
export const cleDePosition = (paneId: string): string => `herdr:defilement:${paneId}`;

/** Ce qu'il faut faire à l'ouverture. */
export type Reprise =
  | { readonly genre: "defaut" }
  | { readonly genre: "bas" }
  | { readonly genre: "ancre"; readonly ancre: string; readonly decalage: number };

/**
 * La reprise d'une position retenue, ou le défaut.
 *
 * ⚠️ Du neuf depuis (`dernier` a changé) : la position retenue décrit un fil qui
 * n'est plus celui-ci, et rouvrir au milieu cacherait le neuf. On l'oublie.
 */
export const repriseDe = (
  memoire: PositionMemorisee | null,
  dernierActuel: string | null,
): Reprise => {
  if (memoire === null || memoire.dernier !== dernierActuel) return { genre: "defaut" };
  if (memoire.bas || memoire.ancre === null) return { genre: "bas" };
  return { ancre: memoire.ancre, decalage: memoire.decalage, genre: "ancre" };
};

/** Le stockage injecté — les tests n'ont pas de `localStorage`. */
export interface Stockage {
  readonly lit: (cle: string) => string | null;
  readonly ecrit: (cle: string, valeur: string) => void;
}

const MUET: Stockage = { ecrit: () => undefined, lit: () => null };

const stockageDe = (lire: () => globalThis.Storage | undefined): Stockage => {
  try {
    const stockage = lire();
    if (stockage === undefined) return MUET;
    // Safari privé lève à l'écriture : on préfère un stockage muet à une
    // exception qui casserait le rendu du fil.
    return {
      ecrit: (cle, valeur) => {
        try {
          stockage.setItem(cle, valeur);
        } catch {
          // Plein ou interdit : la position ne sera pas retenue, c'est tout.
        }
      },
      lit: (cle) => {
        try {
          return stockage.getItem(cle);
        } catch {
          return null;
        }
      },
    };
  } catch {
    return MUET;
  }
};

/** `localStorage` de la plateforme, ou un stockage muet s'il est indisponible. */
export const stockageNavigateur = (): Stockage => stockageDe(() => globalThis.localStorage);

/** `sessionStorage` : la mémoire du défilement vit avec l'onglet. */
export const stockageSession = (): Stockage => stockageDe(() => globalThis.sessionStorage);

/**
 * Efface les positions par ratio que l'ancienne version laissait pour toujours
 * dans `localStorage`.
 */
export const purgeAnciennesPositions = (
  stockage:
    | {
        readonly length: number;
        readonly key: (index: number) => string | null;
        readonly removeItem: (cle: string) => void;
      }
    | undefined,
): void => {
  if (stockage === undefined) return;
  try {
    const anciennes: string[] = [];
    for (let index = 0; index < stockage.length; index += 1) {
      const cle = stockage.key(index);
      if (cle !== null && cle.startsWith("herdr:defilement:")) anciennes.push(cle);
    }
    for (const cle of anciennes) stockage.removeItem(cle);
  } catch {
    // Un stockage illisible n'empêche jamais d'ouvrir l'app.
  }
};

const chaineOuNull = (valeur: unknown): string | null | undefined =>
  valeur === null ? null : typeof valeur === "string" ? valeur : undefined;

/** Lit la position d'une conversation ; une valeur illisible vaut « inconnue ». */
export const litPosition = (stockage: Stockage, paneId: string): PositionMemorisee | null => {
  const brut = stockage.lit(cleDePosition(paneId));
  if (brut === null) return null;
  try {
    const valeur: unknown = JSON.parse(brut);
    if (typeof valeur !== "object" || valeur === null) return null;
    const bas: unknown = Reflect.get(valeur, "bas");
    const decalage: unknown = Reflect.get(valeur, "decalage");
    const ancre = chaineOuNull(Reflect.get(valeur, "ancre"));
    const dernier = chaineOuNull(Reflect.get(valeur, "dernier"));
    if (
      typeof bas !== "boolean" ||
      typeof decalage !== "number" ||
      !Number.isFinite(decalage) ||
      ancre === undefined ||
      dernier === undefined
    ) {
      return null;
    }
    return { ancre, bas, decalage, dernier };
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

/**
 * Le premier élément visible : celui dont le bas dépasse le haut du fil.
 * `elements` est dans l'ordre du fil ; `haut` est le haut visible du fil.
 */
export const premierVisible = (
  elements: ReadonlyArray<{ readonly cle: string; readonly haut: number; readonly bas: number }>,
  haut: number,
): { readonly cle: string; readonly decalage: number } | null => {
  for (const element of elements) {
    if (element.bas > haut) return { cle: element.cle, decalage: element.haut - haut };
  }
  return null;
};
