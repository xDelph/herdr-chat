/**
 * L'état des actions ponctuelles — répondre, faire confiance, arrêter, montrer
 * sur le Mac — **par pane et par sujet**.
 *
 * ⚠️ **Le défaut qu'il ferme (revue du 2026-10-17, P0).** L'état d'une réponse
 * vivait dans le composant affiché : une réponse arrivée après un changement de
 * conversation se posait sur la **nouvelle**, et une carte de la liste et le
 * panneau du chat ne savaient rien l'un de l'autre. Ici :
 *
 * - la clé porte la **cible** (`paneId`) et le **sujet** (le texte de la
 *   question, le dossier de confiance) : deux questions successives du même
 *   agent sont deux actions distinctes, et le résultat de la première ne
 *   s'affiche pas sous la seconde ;
 * - chaque action reçoit un **jeton** ; un résultat qui revient avec un jeton
 *   périmé (l'action a été relancée, ou oubliée) est **rejeté**.
 */

export type EtatAction =
  | { readonly phase: "en-cours" }
  | {
      readonly phase: "fini";
      /** `ok` : appliqué ; `attention` : parti sans preuve ; `erreur` : refusé. */
      readonly ton: "ok" | "attention" | "erreur";
      readonly texte: string;
    };

export type GenreAction = "reponse" | "confiance" | "arret" | "focus" | "modele";

/** La clé d'une action : sa cible, son genre, son sujet. */
export const cleAction = (paneId: string, genre: GenreAction, sujet = ""): string =>
  `${paneId}\u0000${genre}\u0000${sujet}`;

export interface ActionsLocales {
  /** Commence une action. `null` si la même est déjà en cours (double appui). */
  readonly debute: (cle: string) => number | null;
  /** Pose le résultat — `false` s'il est périmé et donc ignoré. */
  readonly termine: (cle: string, jeton: number, resultat: EtatAction) => boolean;
  readonly lit: (cle: string) => EtatAction | undefined;
  readonly oublie: (cle: string) => void;
  readonly souscrire: (abonne: () => void) => () => void;
}

export const creeActionsLocales = (): ActionsLocales => {
  const etats = new Map<string, { readonly jeton: number; readonly etat: EtatAction }>();
  const abonnes = new Set<() => void>();
  let compteur = 0;
  const previent = (): void => {
    for (const abonne of abonnes) abonne();
  };
  return {
    debute: (cle) => {
      if (etats.get(cle)?.etat.phase === "en-cours") return null;
      compteur += 1;
      etats.set(cle, { etat: { phase: "en-cours" }, jeton: compteur });
      previent();
      return compteur;
    },
    lit: (cle) => etats.get(cle)?.etat,
    oublie: (cle) => {
      if (etats.delete(cle)) previent();
    },
    souscrire: (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
    termine: (cle, jeton, resultat) => {
      const courant = etats.get(cle);
      if (courant === undefined || courant.jeton !== jeton) return false;
      etats.set(cle, { etat: resultat, jeton });
      previent();
      return true;
    },
  };
};
