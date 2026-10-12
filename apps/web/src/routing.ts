/**
 * Routage par fragment d'URL.
 *
 * **Ce module existe à cause d'un retour utilisateur précis** : rafraîchir la
 * page en étant sur un agent **ramenait à l'accueil**. L'état vivait uniquement
 * dans React, donc un rechargement le perdait.
 *
 * Le routage est ici, hors du composant, donc **testable**. Un routeur encastré
 * dans un composant ne peut être vérifié qu'en ouvrant l'application.
 *
 * ⚠️ **La barre d'onglets a disparu (U17).** Trois onglets pour deux écrans
 * réels — une liste et des réglages — coûtaient un geste à chaque ouverture, et
 * l'onglet Projets n'était qu'un détour vers le détail d'un projet, atteignable
 * depuis la liste. Les réglages sont passés dans une feuille derrière un
 * engrenage ; les adresses d'onglet restent reconnues et retombent sur la liste,
 * pour qu'un lien enregistré ne casse pas.
 */
export const HOME = "#/liste";

export type Route =
  | { readonly kind: "liste" }
  | { readonly kind: "agent"; readonly paneId: string }
  | { readonly kind: "projet"; readonly workspaceId: string };

/**
 * Environnements d'URL encore acceptés, et où ils mènent.
 *
 * ⚠️ Ils ne sont pas supprimés : un raccourci enregistré sur l'écran d'accueil
 * d'un téléphone pointe une adresse précise, et une adresse morte donnerait un
 * écran blanc.
 */
const LEGACY: ReadonlySet<string> = new Set(["conversations", "projets", "agents", "reglages"]);

/**
 * Analyse un fragment d'URL.
 *
 * **Tout fragment inconnu retombe sur la liste** plutôt que de produire un écran
 * vide : une URL erronée ne doit pas casser l'application.
 */
export const parseRoute = (hash: string): Route => {
  const clean = hash.replace(/^#\/?/, "").trim();
  if (clean.startsWith("agent/")) {
    const paneId = safeDecode(clean.slice("agent/".length));
    if (paneId !== undefined && paneId.length > 0) {
      return { kind: "agent", paneId };
    }
  }
  if (clean.startsWith("projet/")) {
    const workspaceId = safeDecode(clean.slice("projet/".length));
    if (workspaceId !== undefined && workspaceId.length > 0) {
      return { kind: "projet", workspaceId };
    }
  }
  return { kind: "liste" };
};

/** `true` si le fragment est une adresse d'onglet d'avant U17. */
export const estAdresseDOnglet = (hash: string): boolean =>
  LEGACY.has(hash.replace(/^#\/?/, "").trim());

/** Sérialise une route en fragment. */
export const routeToHash = (route: Route): string => {
  if (route.kind === "agent") return `#/agent/${encodeURIComponent(route.paneId)}`;
  if (route.kind === "projet") return `#/projet/${encodeURIComponent(route.workspaceId)}`;
  return HOME;
};

/**
 * Décode un fragment d'URI, ou `undefined` s'il est malformé.
 *
 * `decodeURIComponent` **lève** sur un pourcentage invalide (`#/agent/%`), ce
 * qui casserait tout le rendu depuis une URL tapée à la main.
 */
const safeDecode = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};
