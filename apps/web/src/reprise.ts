/**
 * La reprise d'un `EventSource` tombé — **recréé par nous**, avec un délai
 * croissant.
 *
 * ⚠️ **Mesuré (banc à démon factice + Chrome sans tête).** Après une coupure
 * réseau de 4 s, ni `/api/events` ni le flux de session ne se rouvraient en
 * 60 s : seul le filet de relecture reprenait. L'auto-reconnexion du
 * navigateur ne vaut que tant que le MÊME objet réessaie ; elle peut s'arrêter
 * (CLOSED) ou traîner. Toute erreur programme donc une recréation : 1 s, 2 s,
 * 5 s, puis 10 s au plus ; un signe de vie l'annule et remet le compteur à zéro.
 *
 * ⚠️ **Un flux recréé n'a pas le `Last-Event-ID` de l'ancien** : il doit se
 * resynchroniser lui-même — la liste est relue (flux global), la session
 * rouverte depuis le dernier curseur appliqué (`?cursor=`).
 */
export const DELAIS_REPRISE_MS = [1_000, 2_000, 5_000, 10_000] as const;

/** Le délai de la n-ième reprise (0 = la première), plafonné. */
export const delaiDeReprise = (essai: number): number =>
  DELAIS_REPRISE_MS[Math.min(Math.max(0, essai), DELAIS_REPRISE_MS.length - 1)] ?? 10_000;

/** `EventSource.OPEN`, sans dépendre de la classe (absente d'un double). */
export const SOURCE_OUVERTE = 1;
