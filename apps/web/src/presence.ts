/**
 * La présence de CET appareil (H23) : l'app au premier plan le dit au démon,
 * qui ne lui envoie pas de notification — les autres appareils, si.
 *
 * ⚠️ **Retour du 2026-10-29 : « je suis dans l'app, et je reçois quand même
 * la notif ».** Le worker ne peut pas se taire (iOS révoque un abonnement qui
 * reçoit des push sans notification) : le tri se fait côté démon, avant
 * l'envoi.
 *
 * - visible : un battement tout de suite, puis toutes les 10 s (le démon
 *   oublie une présence au bout de 25 s : un appareil gelé sans avoir dit
 *   qu'il partait redevient notifiable de lui-même) ;
 * - caché : le départ part tout de suite (`keepalive`, la page peut geler
 *   juste après).
 *
 * Sans abonnement push sur cet appareil, rien n'est envoyé : il n'y a
 * personne à épargner.
 */

export const BATTEMENT_PRESENCE_MS = 10_000;

export interface DependancesPresence {
  /** L'endpoint push de cet appareil, ou `null` s'il n'est pas abonné. */
  readonly endpoint: () => Promise<string | null>;
  readonly envoie: (endpoint: string, visible: boolean) => Promise<void>;
  readonly visible: () => boolean;
  /** Répète une action ; rend l'arrêt. */
  readonly repete: (action: () => void, intervalle: number) => () => void;
  /** Une panne d'envoi, avec sa cause — jamais avalée. */
  readonly signale: (cause: string) => void;
}

export interface Presence {
  /** À appeler à chaque changement de visibilité (et au démarrage). */
  readonly surVisibilite: () => Promise<void>;
  readonly arrete: () => void;
}

export const creePresence = (deps: DependancesPresence): Presence => {
  let arreteBattement: (() => void) | null = null;
  let dernier: string | null = null;

  const envoie = async (endpoint: string, visible: boolean): Promise<void> => {
    try {
      await deps.envoie(endpoint, visible);
    } catch (cause) {
      deps.signale(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const bat = async (): Promise<void> => {
    const endpoint = await deps.endpoint();
    dernier = endpoint;
    if (endpoint !== null) await envoie(endpoint, true);
  };

  return {
    arrete: () => {
      arreteBattement?.();
      arreteBattement = null;
    },
    surVisibilite: async () => {
      if (deps.visible()) {
        if (arreteBattement === null) {
          arreteBattement = deps.repete(() => void bat(), BATTEMENT_PRESENCE_MS);
        }
        await bat();
        return;
      }
      arreteBattement?.();
      arreteBattement = null;
      // Le départ part vers l'endpoint déjà connu : relire l'abonnement ici
      // retarderait l'envoi au-delà du gel de la page.
      if (dernier !== null) await envoie(dernier, false);
    },
  };
};
