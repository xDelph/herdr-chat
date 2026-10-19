/**
 * La mise à jour de la PWA, **différée et explicite** (C21, T060).
 *
 * ⚠️ **Le défaut mesuré.** Un nouveau service worker prenait le contrôle et
 * `controllerchange` rechargeait la page **tout seul** : un brouillon en cours
 * de frappe disparaissait, un envoi encore incertain (« attente ») cessait
 * d'être affiché, et l'utilisateur n'avait rien demandé. Recharger est une
 * action destructrice : elle ne peut pas être une surprise.
 *
 * ⚠️ **La règle est ici, pure et testable** : on n'applique la mise à jour que
 * s'il n'y a **ni brouillon ni envoi non résolu**. Ce n'est pas une politesse —
 * ces deux états ne survivent pas à un rechargement (le brouillon vit en
 * mémoire, l'envoi incertain n'est pas rejouable), et le contrat interdit de
 * les perdre en silence.
 *
 * ⚠️ **Rien n'est persisté pour autant** : on ne « sauvegarde » pas le
 * brouillon dans `localStorage` pour pouvoir recharger. Le produit n'écrit pas
 * de texte non envoyé sur le disque ; la bonne réponse est d'attendre.
 */

/** Ce qui empêche d'appliquer la mise à jour maintenant. */
export type Blocage = "aucune" | "brouillon" | "envoi";

/** L'état de saisie au moment de la décision. */
export interface EtatSaisie {
  /** Un brouillon non vide existe (n'importe quel agent). */
  readonly brouillon: boolean;
  /** Un envoi n'est ni confirmé ni échoué (`queued`, `sending`, `uncertain`). */
  readonly envoi: boolean;
}

/**
 * Peut-on appliquer la mise à jour maintenant ? Rend le **blocage**, pas un
 * booléen : l'interface doit pouvoir dire *pourquoi* elle attend.
 *
 * L'ordre est celui de la gravité : un envoi incertain est plus grave qu'un
 * brouillon (le premier peut être parti, le second n'est pas parti du tout).
 */
export const blocageDeMiseAJour = (etat: EtatSaisie): Blocage => {
  if (etat.envoi) return "envoi";
  if (etat.brouillon) return "brouillon";
  return "aucune";
};

/** `true` si la mise à jour peut être appliquée sans rien perdre. */
export const peutAppliquer = (etat: EtatSaisie): boolean => blocageDeMiseAJour(etat) === "aucune";

/** Le texte affiché avec le bouton — la cause, jamais un « plus tard » muet. */
export const texteDeMiseAJour = (blocage: Blocage): string => {
  switch (blocage) {
    case "envoi":
      return "A new version is ready. Finish or resolve the message being sent first.";
    case "brouillon":
      return "A new version is ready. Send or clear your draft to update.";
    case "aucune":
      return "A new version is ready.";
    default:
      return "A new version is ready.";
  }
};

/**
 * Le service worker en attente — un seul à la fois.
 *
 * ⚠️ On garde le **worker** en attente, pas un booléen : appliquer la mise à
 * jour, c'est envoyer `SKIP_WAITING` **à ce worker-là**. Un booléen obligerait
 * à retrouver l'objet au moment du clic, c'est-à-dire à deviner.
 */
let enAttente: WorkerEnAttente | null = null;
/** `true` quand le rechargement vient de NOTRE action (pas d'une surprise). */
let rechargementDemande = false;
const abonnes = new Set<() => void>();

const previent = (): void => {
  for (const abonne of abonnes) abonne();
};

/**
 * Un nouveau worker attend : on le signale, sans rien appliquer.
 *
 * ⚠️ On veut le **worker en attente** lui-même (`registration.waiting`), pas la
 * registration : c'est à lui qu'on enverra `SKIP_WAITING`. Un `waiting` absent
 * n'est pas une mise à jour — il n'y a rien à annoncer.
 */
/** Le seul geste du worker dont on a besoin. */
export interface WorkerEnAttente {
  postMessage: (message: unknown) => void;
}

/**
 * Ce qu'on lit d'une registration — deux champs, pas l'interface DOM entière.
 *
 * ⚠️ **Type structurel volontaire** : le store n'a besoin que du worker en
 * attente, et une fausse registration complète obligerait à affirmer le type
 * (`as`), c'est-à-dire à mentir sur ce qu'on utilise.
 */
export interface RegistrationAvecWorker {
  readonly waiting: WorkerEnAttente | null;
  readonly installing: WorkerEnAttente | null;
}

export const signaleMiseAJour = (registration: RegistrationAvecWorker): void => {
  // `waiting` ET `installing` peuvent être `null` **ou** `undefined` selon le
  // moteur : un test de véracité, pas un test contre `null` seul.
  const worker = registration.waiting ?? registration.installing ?? null;
  if (worker === null) return;
  enAttente = worker;
  previent();
};

/** Y a-t-il un worker en attente ? */
export const miseAJourEnAttente = (): boolean => enAttente !== null;

/** S'abonner aux changements du store. Rend la fonction de désabonnement. */
export const souscrireMiseAJour = (abonne: () => void): (() => void) => {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
};

/**
 * Applique la mise à jour — **seulement** si la règle l'autorise.
 *
 * Rend `true` quand `SKIP_WAITING` est parti : c'est le `controllerchange` qui
 * suivra qui rechargera, et lui seul, parce que `rechargementDemande` est posé
 * ici.
 */
export const appliquerMiseAJour = (etat: EtatSaisie): boolean => {
  if (!peutAppliquer(etat) || enAttente === null) return false;
  const worker = enAttente;
  rechargementDemande = true;
  enAttente = null;
  /*
    `ServiceWorker.postMessage` n'a pas de `targetOrigin` : la destination est
    le worker lui-même, pas une fenêtre. Le lint applique la règle de
    `window.postMessage` et signale une absence qui n'a pas lieu d'être — la
    désactivation est locale à cette ligne et dit pourquoi.
  */
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage({ type: "SKIP_WAITING" });
  previent();
  return true;
};

/**
 * Le `controllerchange` doit-il recharger ?
 *
 * ⚠️ **Seulement si nous l'avons demandé.** Un `controllerchange` subi (un
 * worker qui prend la main sans notre action) ne recharge pas : c'est
 * exactement le rechargement destructeur que C21 corrige.
 */
export const doitRecharger = (): boolean => rechargementDemande;

/** Remise à zéro — pour les tests uniquement. */
export const oublieMiseAJour = (): void => {
  enAttente = null;
  rechargementDemande = false;
  abonnes.clear();
};
