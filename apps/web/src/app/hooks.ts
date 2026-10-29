/**
 * Les ponts entre les magasins et React — `useSyncExternalStore`, rien d'autre.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { EtatAction } from "../actions-locales.ts";
import type { EtatDonnees } from "../donnees.ts";
import type { Envoi } from "../envois.ts";
import { parseRoute, routeToHash, type Route } from "../routing.ts";
import { actions, envois, magasin } from "./services.ts";

export const useDonnees = (): EtatDonnees =>
  useSyncExternalStore(magasin.souscrire, magasin.etat, magasin.etat);

/**
 * Les envois d'un pane.
 *
 * ⚠️ `liste()` rend un nouveau tableau à chaque appel : le passer tel quel à
 * `useSyncExternalStore` ferait boucler le rendu. On s'abonne à une **version**,
 * et la liste n'est relue que quand elle change.
 */
const versionEnvois = (() => {
  let version = 0;
  envois.souscrire(() => {
    version += 1;
  });
  return () => version;
})();

export const useEnvois = (paneId: string): ReadonlyArray<Envoi> => {
  const version = useSyncExternalStore(envois.souscrire, versionEnvois, versionEnvois);
  const [cache, setCache] = useState<{
    readonly cle: string;
    readonly liste: ReadonlyArray<Envoi>;
  }>(() => ({ cle: `${paneId}:${String(version)}`, liste: envois.liste(paneId) }));
  const cle = `${paneId}:${String(version)}`;
  if (cache.cle !== cle) {
    const suivant = { cle, liste: envois.liste(paneId) };
    setCache(suivant);
    return suivant.liste;
  }
  return cache.liste;
};

export const useAction = (cle: string): EtatAction | undefined => {
  const lit = useCallback(() => actions.lit(cle), [cle]);
  return useSyncExternalStore(actions.souscrire, lit, lit);
};

/** Le routage par fragment : un rechargement garde l'écran. */
export const useRoute = (): readonly [Route, (suivante: Route) => void] => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const surChangement = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", surChangement);
    return () => window.removeEventListener("hashchange", surChangement);
  }, []);
  const navigue = useCallback((suivante: Route) => {
    const hash = routeToHash(suivante);
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute(suivante);
  }, []);
  return [route, navigue] as const;
};

/** Une horloge qui ne bat que si on la demande — et pour le seul composant qui l'utilise. */
export const useMaintenant = (intervalle: number | null): number => {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (intervalle === null) return undefined;
    setMaintenant(Date.now());
    const minuterie = window.setInterval(() => setMaintenant(Date.now()), intervalle);
    return () => window.clearInterval(minuterie);
  }, [intervalle]);
  return maintenant;
};

/**
 * La hauteur réellement visible, clavier iOS compris.
 *
 * ⚠️ Safari iOS ignore `interactive-widget=resizes-content` : quand le clavier
 * monte, la mise en page garde sa hauteur et le composeur passe sous le
 * clavier. `visualViewport` dit la vérité ; on la pose en variable CSS.
 */
export const useHauteurVisible = (): void => {
  useEffect(() => {
    const vue = window.visualViewport;
    let derniere = -1;
    const applique = () => {
      const hauteur = Math.round(vue?.height ?? window.innerHeight);
      if (hauteur === derniere) return;
      derniere = hauteur;
      document.documentElement.style.setProperty("--hauteur-app", `${String(hauteur)}px`);
    };
    applique();
    vue?.addEventListener("resize", applique);
    window.addEventListener("resize", applique);
    return () => {
      vue?.removeEventListener("resize", applique);
      window.removeEventListener("resize", applique);
    };
  }, []);
};
