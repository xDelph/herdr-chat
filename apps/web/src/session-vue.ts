/**
 * Ce qu'on fait du fil quand la lecture d'une session **rate ou se vide**.
 *
 * ⚠️ **Le défaut mesuré, et il rendait l'écran inutilisable.** Un agent qui passe
 * en `blocked` (question posée) ou qui a un incident cesse parfois d'exposer sa
 * session : le serveur répond alors `200` avec `cause: "absente"` et
 * `entries: []` — ou une erreur `502` passagère. L'écran traitait cette lecture
 * comme une **nouvelle vérité** (`setEntries(session.entries)`) et **vidait le
 * fil**. Résultat : plus de messages, plus de repère de défilement, plus rien à
 * lire — alors que la conversation existait et allait revenir.
 *
 * ⚠️ **La règle est donc asymétrique, et c'est le cœur du correctif.** Une
 * lecture qui **apporte** des entrées remplace ou complète ; une lecture qui
 * n'apporte **rien** ne détruit jamais ce qui est affiché. Le silence n'est pas
 * une information : c'est l'absence de mesure.
 */

/** Ce que le serveur a répondu, réduit à ce qui décide de l'affichage. */
export interface PageLue<E> {
  readonly entries: readonly E[];
  readonly incremental: boolean;
  /** Le curseur n'était plus valable (rotation, troncature) : la page remplace. */
  readonly reset: boolean;
  /** Pourquoi la page est ce qu'elle est (`vide`, `absente`…), quand c'est dit. */
  readonly cause?: string;
}

/** L'état d'affichage à appliquer. */
export type Decision<E> =
  /** Remplacer le fil par ces entrées (première page, ou reset PROUVÉ). */
  | { readonly genre: "remplace"; readonly entries: readonly E[] }
  /** Ajouter ces entrées (incrémental, ou page non vide après un trou). */
  | { readonly genre: "ajoute"; readonly entries: readonly E[] }
  /** Ne rien changer : la lecture n'apporte rien de neuf. */
  | { readonly genre: "garde" }
  /** Le fil reste, mais l'écran doit dire que la lecture est incomplète. */
  | { readonly genre: "garde-et-previens"; readonly raison: string };

/**
 * Décide quoi faire d'une page lue.
 *
 * - **première lecture** (aucun message affiché) : on remplace, même par du vide —
 *   il n'y a rien à perdre.
 * - **`reset` prouvé AVEC des entrées** : on remplace (le fichier a changé sous
 *   nous, l'ancien contenu n'existe plus).
 * - **`reset` sans entrées** : ⚠️ on **garde**. Un reset vide est le symptôme
 *   d'une session momentanément illisible, pas la preuve qu'elle est vide ; vider
 *   ici reproduisait exactement le défaut.
 * - **incrémental avec des entrées** : on ajoute (fusion faite par l'appelant).
 * - **page vide** : on garde, et on prévient si le fil n'était pas vide.
 */
export const decideAffichage = <E>(etat: {
  readonly affiches: number;
  readonly page: PageLue<E>;
}): Decision<E> => {
  const { affiches, page } = etat;
  const entrantes = page.entries.length;

  // Rien n'est affiché : la page est la vérité, même vide.
  if (affiches === 0) return { entries: page.entries, genre: "remplace" };

  if (page.reset && entrantes > 0) {
    return { entries: page.entries, genre: "remplace" };
  }
  if (entrantes > 0) {
    return { entries: page.entries, genre: "ajoute" };
  }
  if (page.reset) {
    return {
      genre: "garde-et-previens",
      raison: page.cause ?? "the session was reset but nothing could be read from it",
    };
  }
  // Une lecture vide **sans** reset : rien de neuf, on ne touche à rien et on ne
  // prévient pas — c'est le cas normal d'un agent qui n'écrit plus.
  return { genre: "garde" };
};

/**
 * Le fil doit-il rester affiché malgré une **erreur** de lecture ?
 *
 * ⚠️ Oui, dès qu'il y a quelque chose à lire. Une erreur de transport (502, 503)
 * ne dit rien du contenu : elle dit qu'on n'a pas pu le lire **maintenant**. Le
 * remplacer par un écran vide transformait une panne passagère en perte de la
 * conversation — et c'est ce que l'utilisateur a vu.
 */
export const gardeLeFilMalgréErreur = (affiches: number): boolean => affiches > 0;

/** Le libellé de l'avertissement, quand la lecture est incomplète. */
export const mentionLecturePartielle = (raison: string): string =>
  `Last known messages — the session could not be read (${raison}).`;
