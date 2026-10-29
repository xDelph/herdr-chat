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
