/**
 * Le worker demande une navigation — après un appui sur une notification,
 * quand il n'a pas pu naviguer la fenêtre lui-même (`sw.js` poste alors
 * `{ type: "herdr:navigate", hash: "#/agent/<pane>" }`).
 *
 * ⚠️ Seul un fragment de l'app (`#/…`) est accepté : un message n'ouvre
 * jamais une autre adresse, ni ne change de page.
 */
export const hashDeNavigation = (donnees: unknown): string | null => {
  if (typeof donnees !== "object" || donnees === null) return null;
  if (Reflect.get(donnees, "type") !== "herdr:navigate") return null;
  const hash: unknown = Reflect.get(donnees, "hash");
  return typeof hash === "string" && hash.startsWith("#/") ? hash : null;
};

/** Ce qu'il faut du conteneur de workers — `navigator.serviceWorker`. */
export interface ConteneurWorker {
  addEventListener(type: "message", ecouteur: (evenement: MessageEvent) => void): void;
  removeEventListener(type: "message", ecouteur: (evenement: MessageEvent) => void): void;
}

/** Écoute les demandes de navigation du worker ; rend le désabonnement. */
export const ecouteNavigationWorker = (
  conteneur: ConteneurWorker | undefined,
  navigue: (hash: string) => void,
): (() => void) => {
  if (conteneur === undefined) return () => undefined;
  const ecouteur = (evenement: MessageEvent) => {
    const hash = hashDeNavigation(evenement.data);
    if (hash !== null) navigue(hash);
  };
  conteneur.addEventListener("message", ecouteur);
  return () => conteneur.removeEventListener("message", ecouteur);
};

/** Le cache et la clé que le worker partage avec la page (`sw.js`). */
export const CACHE_NAVIGATION = "herdr-navigation";
export const CLE_NAVIGATION = "/__herdr/navigation-en-attente";
/** Au-delà, une cible retenue est trop vieille pour être l'appui qu'on vient de faire. */
export const FRAICHEUR_NAVIGATION_MS = 60_000;

/** Ce qu'il faut de l'API Cache — `caches`, injectable. */
export interface ReserveNavigation {
  open(nom: string): Promise<{
    match(cle: string): Promise<{ json(): Promise<unknown> } | undefined>;
    delete(cle: string): Promise<boolean>;
  }>;
}

/**
 * Reprend la conversation qu'un appui sur une notification devait ouvrir.
 *
 * ⚠️ **Retour du 2026-10-29** : l'appui ouvrait l'app sans ouvrir l'agent. Sur
 * iOS, l'app suspendue revient au premier plan et `navigate()` ou le message
 * du worker peuvent se perdre. Le worker retient la cible ; la page la reprend
 * ici, une seule fois (l'entrée est effacée), et seulement si elle est fraîche.
 * Rend le fragment repris, ou `null`.
 */
export const reprendNavigation = async (
  reserve: ReserveNavigation | undefined,
  maintenant: number,
  navigue: (hash: string) => void,
): Promise<string | null> => {
  if (reserve === undefined) return null;
  const cache = await reserve.open(CACHE_NAVIGATION);
  const entree = await cache.match(CLE_NAVIGATION);
  if (entree === undefined) return null;
  await cache.delete(CLE_NAVIGATION);
  const valeur: unknown = await entree.json();
  if (typeof valeur !== "object" || valeur === null) return null;
  const hash: unknown = Reflect.get(valeur, "hash");
  const instant: unknown = Reflect.get(valeur, "at");
  if (typeof hash !== "string" || !hash.startsWith("#/")) return null;
  if (typeof instant !== "number" || maintenant - instant > FRAICHEUR_NAVIGATION_MS) return null;
  navigue(hash);
  return hash;
};
