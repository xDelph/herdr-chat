/**
 * L'acquittement d'une réponse, **par l'usage** et non par un bouton.
 *
 * ⚠️ **La règle, telle qu'elle est demandée.** Un agent `done` a fini et
 * personne n'a lu. Dès que l'utilisateur **fait quelque chose dans cette
 * conversation** — défiler pour lire, ou écrire — la réponse est lue : on
 * l'acquitte, et l'agent quitte « Needs attention » sans qu'on ait à cliquer.
 *
 * ⚠️ **Ce que ça change par rapport à C24.** C24 interdisait l'acquittement
 * *implicite à l'ouverture* : ouvrir pour regarder ne devait ni voler le focus
 * du Mac, ni marquer lu. Ici la décision est différente et explicite : c'est
 * l'**interaction** (défiler, écrire) qui vaut lecture — pas l'affichage.
 *
 * ⚠️ **Le seul canal d'acquittement connu est le focus du pane** (`focusAgent`) :
 * `agent.view.set` répond `{active: true}` sans changer le statut (mesuré deux
 * fois). Acquitter a donc un effet réel sur le Mac — le pane prend le focus.
 * C'est le prix, et il est assumé : on n'affiche jamais un état qu'on ne peut
 * pas produire.
 */

/** Ce qui décide d'acquitter, réduit au strict nécessaire. */
export interface EtatLectureAgent {
  /** Statut courant de l'agent, tel que Herdr le publie. */
  readonly statut: string;
  /** L'utilisateur a-t-il agi dans cette conversation (défilé, écrit) ? */
  readonly aInteragi: boolean;
  /** A-t-on déjà acquitté cet épisode `done` ? */
  readonly dejaAcquitte: boolean;
}

/**
 * Faut-il envoyer l'acquittement maintenant ?
 *
 * ⚠️ **`done` seulement.** `blocked` a besoin d'une **réponse**, pas d'un
 * acquittement : l'effacer de « Needs attention » serait une faute (une
 * question posée passerait pour lue).
 */
export const doitAcquitter = (etat: EtatLectureAgent): boolean =>
  etat.statut === "done" && etat.aInteragi && !etat.dejaAcquitte;

/**
 * Le délai avant d'acquitter, après la première interaction.
 *
 * ⚠️ **800 ms.** Un défilement produit des dizaines d'événements ; acquitter au
 * premier ferait focaliser le pane sur le Mac alors qu'on ne fait que frôler
 * l'écran. Ce délai laisse l'intention se confirmer, sans être perceptible.
 */
export const DELAI_ACQUITTEMENT_MS = 800;
