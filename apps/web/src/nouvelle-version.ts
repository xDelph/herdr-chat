/**
 * Une nouvelle version de l'app est-elle servie ?
 *
 * ⚠️ **Le défaut (parité).** `index.html` est servi en `no-cache` : un
 * rechargement prend la dernière version. Mais une PWA installée n'est presque
 * jamais rechargée — iOS la garde en mémoire des jours. L'ancienne app vérifiait
 * au retour au premier plan ; la réécriture ne le faisait plus.
 *
 * ⚠️ **Sans revenir aux anciens bricolages** (désinscription des workers,
 * identifiants de build injectés, cache vidé de force) : on relit `/` sans
 * cache et on compare le script d'entrée haché à celui de la page. Le worker
 * (`sw.js`, push seulement) est simplement invité à se mettre à jour.
 *
 * ⚠️ **Jamais bloquant, jamais pendant une saisie.** L'offre « recharger »
 * n'apparaît que sans brouillon ni envoi en attente : recharger les effacerait
 * (ils ne sont, volontairement, pas écrits sur le disque).
 */

/** Le script d'entrée d'un document HTML de l'app (le nom haché de Vite). */
export const scriptDEntree = (html: string): string | null => {
  for (const balise of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype=["']module["']/i.test(balise)) continue;
    const source = /\bsrc=["']([^"']+)["']/i.exec(balise)?.[1];
    if (source !== undefined) return source;
  }
  return null;
};

/** Une version différente est servie — et seulement si les deux sont connues. */
export const versionChangee = (actuelle: string | null, servie: string | null): boolean =>
  actuelle !== null && servie !== null && actuelle !== servie;

/** Au plus une vérification par intervalle : le retour au premier plan est fréquent. */
export const INTERVALLE_VERIFICATION_MS = 60_000;

export interface MagasinVersion {
  readonly nouvelle: () => boolean;
  readonly souscrire: (abonne: () => void) => () => void;
  /** Vérifie si l'intervalle est écoulé ; ne lève jamais. */
  readonly verifie: () => Promise<void>;
}

export const creeMagasinVersion = (deps: {
  readonly actuelle: () => string | null;
  readonly litServie: () => Promise<string>;
  readonly metAJourWorker: () => Promise<void>;
  readonly maintenant: () => number;
}): MagasinVersion => {
  let nouvelle = false;
  let derniere = Number.NEGATIVE_INFINITY;
  const abonnes = new Set<() => void>();
  return {
    nouvelle: () => nouvelle,
    souscrire: (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
    verifie: async () => {
      const instant = deps.maintenant();
      if (nouvelle || instant - derniere < INTERVALLE_VERIFICATION_MS) return;
      derniere = instant;
      try {
        await deps.metAJourWorker();
      } catch {
        // Le worker ne sert qu'au push : sa mise à jour ratée ne dit rien de l'app.
      }
      try {
        if (versionChangee(deps.actuelle(), scriptDEntree(await deps.litServie()))) {
          nouvelle = true;
          for (const abonne of abonnes) abonne();
        }
      } catch {
        // Hors ligne : on réessaiera au prochain retour.
      }
    },
  };
};
