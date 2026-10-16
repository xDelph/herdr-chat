/**
 * Forme pi — le **contrat d'entrée** de tout le reste du produit.
 *
 * ⚠️ **Pourquoi un module, et pas une définition dans `codex.ts`.** Blocs,
 * aperçu, titre, horodatage, curseur, regroupement : tout lit cette forme. Tant
 * qu'elle vivait dans l'adaptateur codex, ajouter un second adaptateur
 * (opencode) obligeait à importer codex pour parler de pi — c'est-à-dire à
 * faire dépendre un format de ses producteurs. Le format commun vit donc ici,
 * et les adaptateurs en dépendent, jamais l'inverse.
 *
 * Aucune logique métier : ce module ne contient qu'une forme et deux ou trois
 * lectures sûres sur du JSON non validé.
 */

/**
 * Forme pi produite par un adaptateur.
 *
 * `message` est typé assez précisément pour être **lu sans assertion** — un test
 * qui doit caster pour vérifier ne vérifie plus grand-chose.
 */
export interface LignePi {
  readonly type: string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly message: {
    readonly content: unknown;
    readonly role?: string;
    readonly toolName?: string;
    readonly phase?: string;
    readonly command?: string;
    readonly output?: string;
    readonly exitCode?: number | null;
    readonly cancelled?: boolean;
    readonly truncated?: boolean;
    /**
     * Un resultat d'outil en echec.
     *
     * ⚠️ Fait partie de la forme pi : `MessageEntry` le declare dans
     * `session.ts`, et l'adaptateur claude s'en sert (`is_error` de l'API).
     */
    readonly isError?: boolean;
  };
}

/** Objet JSON, au sens strict : ni tableau, ni `null`. */
export const estObjet = (valeur: unknown): valeur is Record<string, unknown> =>
  typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);

/** Tableau, ou un tableau vide — jamais `undefined` à dérouler. */
export const tableauDe = (valeur: unknown): ReadonlyArray<unknown> =>
  Array.isArray(valeur) ? valeur : [];

/** Chaîne non vide, ou `undefined`. */
export const texteDe = (valeur: unknown): string | undefined =>
  typeof valeur === "string" && valeur.trim().length > 0 ? valeur : undefined;

/**
 * Horodatage pi : une chaîne ISO 8601.
 *
 * ⚠️ Les sources n'ont pas toutes des dates ISO. opencode donne des entiers
 * Unix en millisecondes ; pi donne une chaîne. On normalise **ici**, à
 * l'entrée, pour que rien en aval n'ait à connaître les deux formes — c'est
 * exactement ce que `session.ts` documente comme piège n°2.
 */
export const horodatageIso = (millisecondes: unknown): string | undefined => {
  if (typeof millisecondes !== "number" || !Number.isFinite(millisecondes)) return undefined;
  // Une date absurde (0, ou très au-delà) ne doit pas fabriquer un horodatage
  // faux : mieux vaut aucun horodatage qu'un « 1970 ».
  if (millisecondes <= 0 || millisecondes > 4_102_444_800_000) return undefined;
  return new Date(millisecondes).toISOString();
};
