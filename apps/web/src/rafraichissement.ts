/**
 * Le client de données partagé (C23, C26, T059).
 *
 * ⚠️ **Trois défauts mesurés, trois corrections.**
 *
 * 1. **Un `Promise.all` tout-ou-rien.** Le health échouait → l'overview et la
 *    liste, pourtant réussis, étaient jetés, et l'écran affichait une erreur
 *    *globale* alors qu'une panne partielle n'empêche pas de lire l'essentiel.
 *    Ici chaque lecture a **son** issue, et un échec ne détruit pas les autres.
 *
 * 2. **Aucun vol unique.** Le minuteur, le flux SSE, le retour au premier plan
 *    et la reprise après resync appelaient tous `refresh` : huit signaux
 *    simultanés lançaient huit lectures. Ici **un seul vol** sert tous les
 *    appelants — le second signal rejoint la requête en cours.
 *
 * 3. **Aucune génération.** Une réponse lente pouvait écraser une plus récente
 *    (l'utilisateur voyait la liste revenir en arrière). Chaque vol porte un
 *    **numéro de génération**, et le client ne rend que le plus récent.
 *
 * ⚠️ **Ce que ce module ne fait pas** : il ne connaît ni React, ni `fetch`. Les
 * trois lectures sont injectées — les tests n'ont donc besoin d'aucun réseau.
 */

/** L'issue d'une lecture : la valeur, ou la cause réelle. */
export type Issue<T> =
  | { readonly ok: true; readonly valeur: T }
  | { readonly ok: false; readonly cause: string };

/**
 * Le résultat d'un vol — les trois issues, **indépendantes**.
 *
 * ⚠️ Les trois types sont des paramètres : le consommateur reçoit ses vraies
 * données, pas des `unknown` à réaffirmer. Une assertion `as Overview` dans
 * l'écran serait exactement le genre de mensonge que ce fichier évite.
 */
export interface Resultat<O = unknown, H = unknown, C = unknown> {
  readonly overview: Issue<O>;
  readonly health: Issue<H>;
  readonly conversations: Issue<C>;
  /** Le numéro du vol : le consommateur n'applique que le plus récent. */
  readonly generation: number;
}

/** Les trois lectures du démon, injectées. */
export interface Lectures<O = unknown, H = unknown, C = unknown> {
  readonly overview: () => Promise<O>;
  readonly health: () => Promise<H>;
  readonly conversations: () => Promise<C>;
}

/** Le client : un vol à la fois, des issues séparées, une génération. */
export interface ClientDeDonnees<O = unknown, H = unknown, C = unknown> {
  /** Lit (ou rejoint le vol en cours) et rend le résultat du vol le plus récent. */
  readonly lit: () => Promise<Resultat<O, H, C>>;
  /** Y a-t-il un vol en cours ? */
  readonly enVol: () => boolean;
  /** Le nombre de vols réellement lancés (la mesure du vol unique). */
  readonly vols: () => number;
}

/**
 * Une lecture, avec son échec attrapé.
 *
 * La cause RÉELLE part telle quelle : c'est elle qui permet de distinguer
 * « Herdr muet » de « réponse hors contrat ».
 */
const uneLecture = async <T>(lecture: () => Promise<T>): Promise<Issue<T>> => {
  try {
    return { ok: true, valeur: await lecture() };
  } catch (cause) {
    return {
      ok: false,
      cause: cause instanceof Error ? cause.message : String(cause),
    };
  }
};

/** `true` si au moins une des trois lectures a réussi. */
export const auMoinsUneReussie = (resultat: Resultat): boolean =>
  resultat.overview.ok || resultat.health.ok || resultat.conversations.ok;

/**
 * Le client — `vols()` compte les vols RÉELS, pas les appels : c'est ce qui
 * rend « huit signaux = un vol » vérifiable.
 */
export const creeClient = <O, H, C>(lectures: Lectures<O, H, C>): ClientDeDonnees<O, H, C> => {
  let enCours: Promise<Resultat<O, H, C>> | null = null;
  let generation = 0;
  let lancements = 0;

  const lit = async (): Promise<Resultat<O, H, C>> => {
    // Le vol en cours sert tous les appelants : c'est le « un seul vol » de C23.
    if (enCours !== null) return enCours;
    lancements += 1;
    generation += 1;
    const mienne = generation;
    // ⚠️ Les trois lectures partent ENSEMBLE (elles sont indépendantes), mais
    // chacune attrape son échec : aucune n'annule les autres — c'est le
    // contraire du `Promise.all` tout-ou-rien d'origine.
    const vol = (async (): Promise<Resultat<O, H, C>> => {
      const [overview, health, conversations] = await Promise.all([
        uneLecture(lectures.overview),
        uneLecture(lectures.health),
        uneLecture(lectures.conversations),
      ]);
      return { conversations, generation: mienne, health, overview };
    })();
    enCours = vol;
    try {
      return await vol;
    } finally {
      // ⚠️ Le vol n'est « en cours » que tant qu'il l'est : le prochain signal
      // en relancera un, avec une génération PLUS GRANDE.
      enCours = null;
    }
  };

  return {
    enVol: () => enCours !== null,
    lit,
    vols: () => lancements,
  };
};

/**
 * La cadence de rafraîchissement, selon que l'onglet est visible ou non.
 *
 * ⚠️ **Deux cadences, pas une.** Un onglet en arrière-plan n'a personne devant
 * lui : rafraîchir toutes les 4 s y consomme batterie et réseau pour un écran
 * que personne ne regarde. Au retour, on relit **immédiatement** — c'est le
 * « retour foreground » du contrat, et il ne peut pas attendre la cadence.
 */
export const CADENCE_VISIBLE_MS = 4_000;
export const CADENCE_CACHEE_MS = 60_000;

/**
 * Les cadences de **secours**, quand le flux d'événements est vivant.
 *
 * ⚠️ **Le poll n'est plus la source de fraîcheur, il en est le filet.** Le banc
 * T065 a mesuré le serveur à p95 1,70 ms pour 14 141 requêtes en 3 s ; une vol
 * toutes les 4 s bridait donc l'interface à la cadence d'un minuteur, alors que
 * le démon publie déjà `agent_status`, `prompt`, `prompt-suppressed`,
 * `agent-launched` et `session_changed` sur `/api/events`.
 *
 * Le filet reste : un flux muet (proxy qui coupe, serveur redémarré sans que le
 * client le sache) ne doit pas laisser un écran figé. 30 s est le compromis
 * assumé entre « jamais figé » et « pas de trafic inutile ».
 */
export const CADENCE_SECOURS_VISIBLE_MS = 30_000;
export const CADENCE_SECOURS_CACHEE_MS = 120_000;

/**
 * La période à appliquer, selon la visibilité **et** l'état du direct.
 *
 * `direct` = le flux d'événements a parlé récemment. Il n'est pas deviné : il
 * vient de `openEventStream` (statut `live`/`down`).
 */
export const cadence = (visible: boolean, direct = false): number =>
  direct
    ? visible
      ? CADENCE_SECOURS_VISIBLE_MS
      : CADENCE_SECOURS_CACHEE_MS
    : visible
      ? CADENCE_VISIBLE_MS
      : CADENCE_CACHEE_MS;

/**
 * Les événements qui rendent une relecture nécessaire.
 *
 * ⚠️ La liste est **celle du serveur** (`EvenementSse`), à une exception près :
 * `resync` n'est pas ici, il a son propre chemin (`onResync`) parce qu'il
 * demande une relecture immédiate, jamais espacée par un lot.
 */
export const EVENEMENTS_RAFRAICHISSANTS = [
  "agent_status",
  "prompt",
  "prompt-suppressed",
  "agent-launched",
  "session_changed",
] as const;

/**
 * Faut-il appliquer un résultat arrivé maintenant ?
 *
 * ⚠️ Le consommateur garde la génération qu'il a déjà appliquée : un résultat
 * plus ANCIEN est ignoré. Sans cela, une réponse lente faisait revenir la liste
 * en arrière, et l'utilisateur voyait un agent disparaître puis réapparaître.
 */
export const doitAppliquer = (resultat: Resultat, dejaAppliquee: number): boolean =>
  resultat.generation > dejaAppliquee;

/**
 * Le **regroupement des rafales** : N événements rapprochés valent UNE lecture.
 *
 * ⚠️ **Pourquoi ce n'est pas dans `creeClient`.** Le client « un vol à la fois »
 * fond deux appels *simultanés*, pas deux appels *consécutifs* : une rafale de
 * trois événements lançait trois vols à la queue leu leu. Le regroupement est
 * donc en amont, et il est pur — l'horloge est injectée, donc vérifiable sans
 * attendre.
 */
export interface Regroupement {
  /** Signale un événement : la lecture partira au plus tard dans `delai`. */
  readonly signale: () => void;
  /** Annule ce qui est en attente (démontage du composant). */
  readonly annule: () => void;
  /** Le nombre de lectures réellement déclenchées — la mesure du regroupement. */
  readonly lectures: () => number;
}

export const DELAI_REGROUPEMENT_MS = 150;

export const creeRegroupement = (
  lire: () => void,
  delai: number = DELAI_REGROUPEMENT_MS,
  planifier: (action: () => void, attente: number) => number = (action, attente) =>
    window.setTimeout(action, attente),
  annuler: (jeton: number) => void = (jeton) => {
    window.clearTimeout(jeton);
  },
): Regroupement => {
  let jeton: number | undefined;
  let lancees = 0;
  return {
    annule: () => {
      if (jeton !== undefined) {
        annuler(jeton);
        jeton = undefined;
      }
    },
    lectures: () => lancees,
    signale: () => {
      // Déjà programmé : l'événement rejoint le lot, il n'en crée pas un autre.
      if (jeton !== undefined) return;
      jeton = planifier(() => {
        jeton = undefined;
        lancees += 1;
        lire();
      }, delai);
    },
  };
};
