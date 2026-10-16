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
    /**
     * Modele, fournisseur et niveau de raisonnement **du message**.
     *
     * ⚠️ **C'est la forme de pi elle-meme** : chaque message assistant porte
     * `provider`, `model` et `thinkingLevel`. Les declarer ici plutot que dans
     * un module a part evite que chaque adaptateur invente son propre nom pour
     * la meme chose.
     *
     * ⚠️ **Pourquoi ces trois champs comptent plus qu'un `model_change`.** Le
     * modele est ecrit sur **chaque** message, alors qu'un changement n'est
     * ecrit qu'au moment ou il change : sur une session de 19 Mo, le dernier
     * `model_change` peut etre hors de la fenetre lue — ou n'avoir jamais eu
     * lieu. Mesure sur les cinq sources : pi et claude le portent sur le
     * message, opencode et devin aussi ; seul codex le met dans un evenement.
     */
    readonly model?: string;
    readonly provider?: string;
    readonly thinkingLevel?: string;
  };
}

/**
 * Ligne de **changement de reglage**, telle que pi l'ecrit.
 *
 * ⚠️ **Pourquoi un type a part, et pas une variante de `LignePi`.** La forme
 * partagee decrit un **message** ; une vingtaine de lectures de test en
 * dependent, et leur ajouter une variante ferait payer a tout le monde ce qui
 * ne concerne qu'un producteur. Ce qui compte, c'est que la ligne produite soit
 * **du pi** : `reglagesOf` la lit sans rien savoir de codex.
 */
export interface ChangePi {
  readonly type: "model_change" | "thinking_level_change";
  readonly modelId?: string;
  readonly provider?: string;
  readonly thinkingLevel?: string;
  readonly timestamp?: string;
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
 * Nom de modele utilisable, ou `undefined`.
 *
 * ⚠️ **Certaines sources ecrivent un substitut a la place du modele.** Claude
 * Code met `<synthetic>` sur les messages qu'il fabrique lui-meme (mesure sur
 * `9054562f-7ce…`). L'afficher tel quel remplacerait « inconnu » par une valeur
 * qui *a l'air* d'un modele — exactement ce que le produit refuse partout
 * ailleurs.
 *
 * La reconnaissance est volontairement etroite : tout ce qui est entre
 * chevrons est un substitut, rien d'autre. Une liste de noms interdits
 * deviendrait fausse au premier modele renomme.
 */
export const modeleUtilisable = (valeur: unknown): string | undefined => {
  const texte = texteDe(valeur);
  if (texte === undefined) return undefined;
  return texte.startsWith("<") && texte.endsWith(">") ? undefined : texte;
};

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
