/**
 * L'état de la connexion au démon, en **un** mot — pour la liste comme pour la
 * conversation.
 *
 * ⚠️ **« Reconnexion » n'est pas « Connexion ».** L'écran disait « Connexion… »
 * au premier démarrage comme après une coupure : on ne savait pas si l'app
 * venait de s'ouvrir ou si elle avait perdu le direct. Le flux global dit
 * `inconnu` tant qu'il ne s'est jamais ouvert, `down` quand il est tombé : la
 * distinction est mesurée, pas devinée.
 *
 * ⚠️ **Hors ligne se dit avec sa cause.** Une lecture ratée porte sa raison ; un
 * appareil sans réseau le dit lui-même (`navigator.onLine`).
 */
import type { Direct } from "./donnees.ts";
import { FENETRE_DEMARRAGE_MS } from "./etats.ts";

export type EtatConnexion =
  | { readonly phase: "direct" }
  | { readonly phase: "connexion" }
  | { readonly phase: "reconnexion" }
  | {
      readonly phase: "hors-ligne";
      readonly cause: string;
      readonly dernierSucces: number | null;
    };

export const etatConnexion = (etat: {
  readonly direct: Direct;
  /** Cause de la dernière lecture de la liste ratée, ou `null`. */
  readonly erreur: string | null;
  readonly dernierSucces: number | null;
  readonly depuisOuverture: number;
  /** `navigator.onLine` — `false` quand l'appareil sait qu'il n'a pas de réseau. */
  readonly enLigne: boolean;
}): EtatConnexion => {
  if (!etat.enLigne) {
    return {
      cause: "l'appareil n'a pas de réseau",
      dernierSucces: etat.dernierSucces,
      phase: "hors-ligne",
    };
  }
  // Au démarrage, un premier échec est une connexion en cours (`etats.ts`).
  const demarrage = etat.depuisOuverture < FENETRE_DEMARRAGE_MS && etat.dernierSucces === null;
  if (etat.erreur !== null && !demarrage) {
    return { cause: etat.erreur, dernierSucces: etat.dernierSucces, phase: "hors-ligne" };
  }
  if (etat.direct === "live" && etat.erreur === null) return { phase: "direct" };
  return etat.direct === "down" ? { phase: "reconnexion" } : { phase: "connexion" };
};

/** Le mot de l'indicateur. */
export const LIBELLE_CONNEXION: Record<EtatConnexion["phase"], string> = {
  connexion: "Connexion…",
  direct: "En direct",
  "hors-ligne": "Hors ligne",
  reconnexion: "Reconnexion…",
};
