/**
 * Ouvrir un dialogue **en modal** quand le navigateur sait le faire (C25).
 *
 * ⚠️ **Le défaut mesuré.** La feuille était un `<dialog open>` : elle
 * s'affichait par-dessus, mais le **fond restait interactif** — un clic dans la
 * marge atteignait la page derrière, et le parcours clavier ne tenait que par
 * notre piège de focus en JavaScript. `aria-modal="true"` **annonce** une
 * modale ; il ne la rend pas modale.
 *
 * `showModal()` place le dialogue dans la *top layer* et rend le reste du
 * document inerte — **pointeur ET clavier**, par le navigateur. C'est la seule
 * façon d'obtenir l'inertie réelle : un test ne peut pas la simuler.
 *
 * ⚠️ Repli explicite : un moteur sans `showModal` garde l'attribut `open` (et
 * donc notre piège de focus). On ne prétend pas que le fond est inerte dans ce
 * cas — c'est la limite du moteur, pas un mensonge du code.
 */

/** Le sous-ensemble du `<dialog>` dont ce module a besoin. */
export interface Dialogue {
  readonly open: boolean;
  showModal?: () => void;
  setAttribute: (nom: string, valeur: string) => void;
}

/** Comment le dialogue a été ouvert — dit tel quel, jamais supposé. */
export type ModeOuverture = "modale" | "simple";

/**
 * Ouvre le dialogue : modal si possible, sinon `open` simple.
 *
 * ⚠️ `showModal()` lève si le dialogue est **déjà** ouvert en modal : on ne
 * l'appelle donc pas sur un dialogue `open`. C'est la seule condition qui
 * produirait une exception au milieu d'un rendu.
 */
export const ouvreDialogue = (dialogue: Dialogue): ModeOuverture => {
  if (!dialogue.open && typeof dialogue.showModal === "function") {
    dialogue.showModal();
    return "modale";
  }
  dialogue.setAttribute("open", "");
  return "simple";
};
