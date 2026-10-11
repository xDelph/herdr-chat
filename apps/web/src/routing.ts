/**
 * Routage par fragment d'URL.
 *
 * **Ce module existe à cause d'un retour utilisateur précis** : rafraîchir la
 * page en étant sur un agent **ramenait à l'accueil**. L'état vivait uniquement
 * dans React, donc un rechargement le perdait.
 *
 * Le routage est ici, hors du composant, donc **testable**. Un routeur encastré
 * dans un composant ne peut être vérifié qu'en ouvrant l'application.
 */
import { Option, Schema } from "effect";

/**
 * Les trois destinations de la release.
 *
 * `Agents` a disparu au profit de `Conversations` : une liste d'agents et une
 * liste de conversations sont la même chose vue de deux angles, et l'ancienne
 * navigation obligeait à choisir entre « qui existe » et « de quoi s'occuper »
 * (U04).
 */
export const TabSchema = Schema.Literals(["conversations", "projets", "reglages"]);
export type Tab = typeof TabSchema.Type;

/** Les destinations, dans l'ordre d'affichage — la navigation s'en sert. */
export const TABS = ["conversations", "projets", "reglages"] as const satisfies ReadonlyArray<Tab>;

/** Libellés exacts, dans l'ordre d'affichage. */
export const TAB_LABEL: Record<Tab, string> = {
  conversations: "Conversations",
  projets: "Projets",
  reglages: "Réglages",
};

/**
 * Onglet par défaut : **ce qui demande une action**.
 *
 * Ouvrir sur une liste de projets oblige à chercher ce qui attend. La question
 * utile en mobilité est « qu'est-ce qui m'attend ? » — et `À traiter` est la
 * première section de Conversations, pas un onglet séparé.
 */
export const DEFAULT_TAB: Tab = "conversations";

export type Route =
  | { readonly kind: "tab"; readonly tab: Tab }
  | { readonly kind: "agent"; readonly paneId: string };

/**
 * Analyse un fragment d'URL.
 *
 * **Tout fragment inconnu retombe sur l'onglet par défaut** plutôt que de
 * produire un écran vide : une URL erronée ne doit pas casser l'application.
 */
export const parseRoute = (hash: string): Route => {
  const clean = hash.replace(/^#\/?/, "");
  if (clean.startsWith("agent/")) {
    const paneId = safeDecode(clean.slice("agent/".length));
    if (paneId !== undefined && paneId.length > 0) {
      return { kind: "agent", paneId };
    }
  }
  const tab = Option.getOrUndefined(Schema.decodeUnknownOption(TabSchema)(clean));
  return { kind: "tab", tab: tab ?? DEFAULT_TAB };
};

/** Sérialise une route en fragment. */
export const routeToHash = (route: Route): string =>
  route.kind === "agent" ? `#/agent/${encodeURIComponent(route.paneId)}` : `#/${route.tab}`;

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
