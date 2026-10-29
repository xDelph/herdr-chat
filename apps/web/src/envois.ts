/**
 * Les envois en attente, **par pane** (C19, C20, T058).
 *
 * ⚠️ **Trois défauts mesurés, un seul magasin pour les fermer.**
 *
 * 1. **La cible était celle du rendu.** Les envois vivaient dans l'état du
 *    composant, et `transmettre` lisait `agent.paneId` **au moment de l'appel**.
 *    Un échec sur A, puis l'ouverture de B, puis « réessayer » envoyait le
 *    texte à **B**. Ici la cible est **capturée** à la création de l'envoi :
 *    réessayer vise A, toujours.
 * 2. **La minuterie de 900 ms mourait avec l'écran.** Elle était un
 *    `setTimeout` du composant, annulé au démontage : changer de conversation
 *    dans les 900 ms **annulait l'envoi** sans le dire. Ici la minuterie
 *    appartient au magasin, donc elle survit à la navigation.
 * 3. **Une réponse tardive écrivait dans la mauvaise conversation.** L'état
 *    était global au composant affiché ; une réponse d'envoi arrivée après un
 *    changement de conversation pouvait se poser sur la nouvelle. Ici chaque
 *    envoi est rangé **sous son pane** : une réponse ne peut pas traverser.
 *
 * ⚠️ **Aucune persistance.** Un envoi que le serveur n'a pas confirmé meurt
 * avec l'onglet — le produit n'écrit pas de texte non envoyé sur le disque.
 */

/** Où en est un envoi — les états du composeur, pas ceux du serveur. */
export type EtatEnvoi = "queued" | "sending" | "delivered" | "uncertain" | "failed";

/** Un envoi — sa cible est **capturée**, jamais relue depuis l'écran. */
export interface Envoi {
  readonly id: string;
  /** ⚠️ La cible de CET envoi : elle ne change plus, quoi qu'affiche l'écran. */
  readonly pane: string;
  readonly text: string;
  /**
   * Combien de messages identiques étaient déjà dans l'historique à l'envoi.
   * Sert à reconnaître l'apparition du message dans la session (il ne faut pas
   * le compter deux fois).
   */
  readonly baseline: number;
  readonly state: EtatEnvoi;
  readonly detail: string | null;
  readonly failureState: EtatEchec | null;
}

/** L'état d'un échec d'envoi — les trois valeurs du contrat (B05). */
export type EtatEchec = "attente" | "erreur" | "inconnu";

/** Ce que le magasin demande au serveur — injecté, donc testable sans réseau. */
export type Lanceur = (
  pane: string,
  text: string,
) => Promise<
  | { readonly kind: "sent"; readonly confirmation: "confirmed" | "unknown" }
  | { readonly kind: "suppressed"; readonly reason: string }
  | {
      readonly kind: "failed";
      readonly message: string;
      readonly state: EtatEchec;
    }
>;

/** Le planificateur de la minuterie — injecté pour que les tests n'attendent pas. */
export type Planificateur = (action: () => void, delai: number) => () => void;

/** Le délai avant l'envoi : le message est visible et **annulable**. */
export const DELAI_ENVOI_MS = 900;

export interface MagasinEnvois {
  /** Ajoute un envoi et programme son départ (900 ms). Rend son identifiant. */
  readonly ajoute: (envoi: {
    readonly pane: string;
    readonly text: string;
    readonly baseline: number;
  }) => string;
  /** Réessaie un envoi **échoué ou incertain** — sur SA cible capturée. */
  readonly reessaye: (id: string) => boolean;
  /** Annule un envoi encore en file (avant tout appel réseau). */
  readonly annule: (id: string) => string | null;
  /**
   * Résout les envois **incertains** d'un pane à partir d'un **événement**.
   *
   * ⚠️ **Le SSE est une meilleure preuve qu'un délai.** Un envoi resté
   * `sending` ou `uncertain` (réponse perdue, délai dépassé) est **confirmé**
   * quand le serveur publie `prompt` pour ce pane : la preuve est observée, pas
   * déduite d'une absence de réponse. On ne touche jamais à un envoi
   * réellement `failed` (un refus nommé reste un refus).
   */
  readonly resoutParEvenement: (pane: string) => number;
  /**
   * Oublie un envoi dont la **session porte le texte** : sa bulle optimiste n'a
   * plus lieu d'être.
   *
   * ⚠️ **L'apparition dans la session vaut PREUVE, quel que soit l'état.** La
   * fonction n'acceptait que `delivered` : un envoi resté `uncertain` (réponse
   * muette) dont le texte était **visible dans le fil** gardait donc sa bulle
   * indéfiniment — le message apparaissait deux fois, et la bulle disait encore
   * « non confirmé » alors que la preuve était sous les yeux. Un `failed` aussi
   * est démenti par la preuve : le texte est là.
   */
  readonly oublie: (id: string) => void;
  /** Les envois d'un pane, dans l'ordre de création. */
  readonly liste: (pane: string) => ReadonlyArray<Envoi>;
  /** S'abonner aux changements — rend le désabonnement. */
  readonly souscrire: (abonne: () => void) => () => void;
  /** Le nombre d'appels réseau réellement partis (la mesure des tests). */
  readonly lancements: () => number;
}

/**
 * Crée le magasin.
 *
 * `planifie` est injecté : en production `(action, delai) => setTimeout(...)`,
 * en test un planificateur manuel qui rend `avance(delai)` synchrone.
 */
export const creeMagasinEnvois = (lance: Lanceur, planifie: Planificateur): MagasinEnvois => {
  const envois = new Map<string, Envoi>();
  const minuteries = new Map<string, () => void>();
  const abonnes = new Set<() => void>();
  let compteur = 0;
  let appels = 0;

  const previent = (): void => {
    for (const abonne of abonnes) abonne();
  };

  const remplace = (id: string, changement: Partial<Envoi>): void => {
    const actuel = envois.get(id);
    if (actuel === undefined) return;
    envois.set(id, { ...actuel, ...changement });
    previent();
  };

  const envoie = async (id: string): Promise<void> => {
    const envoiInitial = envois.get(id);
    if (envoiInitial === undefined) return;
    // ⚠️ La cible vient de l'envoi, pas de l'écran : c'est TOUT le correctif.
    const { pane, text } = envoiInitial;
    remplace(id, { detail: null, failureState: null, state: "sending" });
    appels += 1;
    try {
      const resultat = await lance(pane, text);
      if (resultat.kind === "suppressed") {
        remplace(id, {
          detail: `Herdr avait déjà confirmé un envoi identique : ${resultat.reason}`,
          state: "delivered",
        });
        return;
      }
      if (resultat.kind === "sent") {
        remplace(id, {
          detail:
            resultat.confirmation === "confirmed"
              ? "Herdr a confirmé la réception du message."
              : "Herdr n'a pas confirmé la réception du message.",
          state: resultat.confirmation === "confirmed" ? "delivered" : "uncertain",
        });
        return;
      }
      /*
        ⚠️ **« Peut-être parti » n'est pas « échoué ».** Le serveur distingue
        trois natures de panne (B05) : `attente` (délai dépassé — le message est
        peut-être arrivé), `inconnu` (transport muet — idem), `erreur` (refus
        amont — perdu). Les deux premières s'affichaient en **rouge**, comme un
        échec certain, alors qu'elles ne prouvent rien : c'est exactement la
        bulle rouge observée sur un message pourtant parti. Seul `erreur` est un
        échec ; les deux autres restent `uncertain` (orange), avec le détail et
        un renvoi possible.
      */
      remplace(id, {
        detail: resultat.message,
        failureState: resultat.state,
        state: resultat.state === "erreur" ? "failed" : "uncertain",
      });
    } catch (cause) {
      // Même règle : une exception réseau ne prouve pas que la requête n'est
      // pas partie.
      remplace(id, {
        detail: cause instanceof Error ? cause.message : String(cause),
        failureState: "inconnu",
        state: "uncertain",
      });
    }
  };

  const resoutParEvenement: MagasinEnvois["resoutParEvenement"] = (pane) => {
    let resolus = 0;
    for (const [id, envoi] of envois) {
      if (envoi.pane !== pane) continue;
      // ⚠️ `sending` et `uncertain` seulement : un `failed` nommé par le serveur
      // ne devient pas un succès parce qu'un autre prompt est passé.
      if (envoi.state !== "sending" && envoi.state !== "uncertain") continue;
      remplace(id, {
        detail: "Herdr a publié la remise du message pour ce pane.",
        state: "delivered",
      });
      resolus += 1;
    }
    return resolus;
  };

  const ajoute: MagasinEnvois["ajoute"] = ({ pane, text, baseline }) => {
    compteur += 1;
    const id = `local-${String(Date.now())}-${String(compteur)}`;
    envois.set(id, {
      baseline,
      detail: null,
      failureState: null,
      id,
      pane,
      state: "queued",
      text,
    });
    // ⚠️ La minuterie appartient au magasin : elle survit au démontage de
    // l'écran (le défaut d'origine annulait l'envoi en changeant de
    // conversation).
    minuteries.set(
      id,
      planifie(() => {
        minuteries.delete(id);
        void envoie(id);
      }, DELAI_ENVOI_MS),
    );
    previent();
    return id;
  };

  return {
    ajoute,
    resoutParEvenement,
    annule: (id) => {
      const envoi = envois.get(id);
      if (envoi === undefined || envoi.state !== "queued") return null;
      minuteries.get(id)?.();
      minuteries.delete(id);
      envois.delete(id);
      previent();
      return envoi.text;
    },
    lancements: () => appels,
    oublie: (id) => {
      const envoi = envois.get(id);
      if (envoi === undefined) return;
      envois.delete(id);
      previent();
    },
    liste: (pane) => [...envois.values()].filter((envoi) => envoi.pane === pane),
    reessaye: (id) => {
      const envoi = envois.get(id);
      // ⚠️ Seuls les états NON RÉSOLUS se réessayent : réessayer un message
      // déjà délivré l'enverrait deux fois.
      if (envoi === undefined || (envoi.state !== "failed" && envoi.state !== "uncertain")) {
        return false;
      }
      void envoie(id);
      return true;
    },
    souscrire: (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
  };
};

/** Le planificateur de production. */
export const planificateurReel: Planificateur = (action, delai) => {
  const timer = setTimeout(action, delai);
  return () => clearTimeout(timer);
};
