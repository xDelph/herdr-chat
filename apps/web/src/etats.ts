/**
 * Les six états de lecture, dans un ordre unique (U10).
 *
 * ⚠️ Avant, ils se mélangeaient en deux drapeaux : `error` et `live`. Leur
 * combinaison donnait **huit** affichages possibles pour six états réels, et
 * trois d'entre eux étaient faux — une coupure alors que des données sont
 * affichées se lisait comme « rien à afficher », et un chargement en cours sur
 * un écran déjà rempli ne se distinguait pas de l'immobilité.
 *
 * Une **union fermée** rend l'ordre explicite et le rend testable : le contrat
 * dit « coupure conserve messages et brouillon », donc tant qu'il reste des
 * données à l'écran, une coupure ne peut pas produire un écran vide.
 */
export type EtatLecture =
  /** Première lecture, rien à afficher encore. */
  | { readonly phase: "chargement" }
  /** Lecture réussie, aucun agent à montrer. */
  | { readonly phase: "vide" }
  /** Des données sont affichées, mais la dernière lecture a échoué. */
  | { readonly phase: "hors-ligne"; readonly dernierSucces: number | null }
  /** Les données sont fraiches, mais le flux temps réel est coupé. */
  | { readonly phase: "reconnexion" }
  /** Jamais rien affiché, et la cause est connue. */
  | { readonly phase: "erreur"; readonly cause: string }
  /** Tout va bien. */
  | { readonly phase: "pret" };

/**
 * Un seul état, jamais deux.
 *
 * L'ordre est la règle : ce qui empêche d'afficher l'emporte sur ce qui gêne.
 * Un rafraîchissement en cours sur un écran déjà rempli n'est donc **pas** un
 * chargement — afficher « chargement » ferait clignoter tout l'écran toutes les
 * 4 secondes.
 *
 * @param dernierSucces Horodatage de la dernière lecture réussie, ou `null`.
 */
export const etatLecture = ({
  chargement,
  erreur,
  live,
  total,
  dernierSucces,
}: {
  readonly chargement: boolean;
  /** Cause de la dernière lecture échouée, `null` si elle a réussi. */
  readonly erreur: string | null;
  /** Le flux temps réel alimente-t-il encore l'écran ? */
  readonly live: boolean;
  /** Nombre d'éléments déjà affichés. */
  readonly total: number;
  readonly dernierSucces: number | null;
}): EtatLecture => {
  if (total === 0) {
    // Rien à afficher : la lecture en cours et l'échec sont les deux seules
    // choses à dire. Dans cet ordre, parce qu'un échec puis un succès rapide
    // ne doivent pas laisser un bandeau d'erreur pendant le chargement suivant.
    if (erreur !== null) return { phase: "erreur", cause: erreur };
    if (chargement) return { phase: "chargement" };
    // ⚠️ `erreur` est `null` ici : une absence de données n'est pas une panne,
    // c'est un parc vide. Le dire autrement ferait croire à une erreur.
    return { phase: "vide" };
  }

  // Des données sont affichées : plus rien ne peut les remplacer. La coupure
  // se dit, elle ne remplace pas l'écran — c'est ce qui conserve le fil et le
  // brouillon pendant une reconnexion.
  if (erreur !== null) return { phase: "hors-ligne", dernierSucces };
  if (!live) return { phase: "reconnexion" };
  return { phase: "pret" };
};

/**
 * Heure de la dernière lecture réussie — ou `null` si on ne sait pas.
 *
 * ⚠️ **Pourquoi une heure fixe et pas « il y a 2 min ».** Cet avis est une
 * région vivante : son contenu ne doit changer que lorsqu'il apparaît, sinon le
 * lecteur d'écran répète l'annonce à chaque relecture. Un âge relatif change
 * toutes les 4 secondes ; l'heure d'clock ne change pas.
 *
 * ⚠️ Et jamais d'heure inventée : sans horodatage, on ne dit rien du tout.
 * « à l'instant » sans source serait mentir sur la fraîcheur, qui est
 * exactement ce que l'utilisateur cherche à savoir.
 *
 * Formatage manuel plutôt que `toLocaleTimeString` : la sortie ne dépend alors
 * ni de la locale du téléphone, ni du format 12 h qu'iPhone applique par
 * défaut — et c'est testable.
 */
export const heureLue = (dernierSucces: number | null): string | null => {
  if (dernierSucces === null) return null;
  const date = new Date(dernierSucces);
  if (Number.isNaN(date.getTime())) return null;
  const heures = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${heures}:${minutes}`;
};
