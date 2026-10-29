/**
 * Les ponts entre les magasins et React — `useSyncExternalStore`, rien d'autre.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { EtatAction } from "../actions-locales.ts";
import type { EtatDonnees } from "../donnees.ts";
import type { Envoi } from "../envois.ts";
import { parseRoute, routeToHash, type Route } from "../routing.ts";
import { actions, envois, magasin } from "./services.ts";
import { creeSuiviViewport } from "../viewport.ts";

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

const souscrireReseau = (abonne: () => void): (() => void) => {
  window.addEventListener("online", abonne);
  window.addEventListener("offline", abonne);
  return () => {
    window.removeEventListener("online", abonne);
    window.removeEventListener("offline", abonne);
  };
};
const enLigne = (): boolean => navigator.onLine;
const toujoursEnLigne = (): boolean => true;

/** L'appareil se dit-il en ligne ? (`navigator.onLine`, suivi en direct.) */
export const useEnLigne = (): boolean =>
  useSyncExternalStore(souscrireReseau, enLigne, toujoursEnLigne);

/** La largeur sous laquelle un seul écran est visible (`base.css`). */
const ETROIT = "(max-width: 899px)";
const souscrireEtroit = (abonne: () => void): (() => void) => {
  const requete = window.matchMedia(ETROIT);
  requete.addEventListener("change", abonne);
  return () => requete.removeEventListener("change", abonne);
};
const etroit = (): boolean => window.matchMedia(ETROIT).matches;
const jamaisEtroit = (): boolean => false;

/** Un seul écran à la fois (téléphone) ? */
export const useEtroit = (): boolean => useSyncExternalStore(souscrireEtroit, etroit, jamaisEtroit);

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
    const suivi = creeSuiviViewport();
    let derniere = "";
    const applique = () => {
      const mesure = suivi({
        haut: Math.round(vue?.offsetTop ?? 0),
        hauteur: Math.round(vue?.height ?? window.innerHeight),
        largeur: Math.round(vue?.width ?? window.innerWidth),
      });
      const cle = `${String(mesure.hauteur)}:${String(mesure.haut)}:${String(mesure.clavier)}`;
      if (cle === derniere) return;
      derniere = cle;
      const racine = document.documentElement;
      racine.style.setProperty("--hauteur-app", `${String(mesure.hauteur)}px`);
      racine.style.setProperty("--haut-visible", `${String(mesure.haut)}px`);
      racine.classList.toggle("clavier-ouvert", mesure.clavier);
    };
    /*
      ⚠️ **La rotation (retour du 2026-10-29, iPad paysage → portrait).** iOS
      émet `resize` PENDANT la rotation, avec les valeurs de l'orientation
      d'avant, et pas toujours un dernier événement une fois stabilisé : la
      hauteur restait celle du paysage, l'app ne prenait plus tout l'écran.
      On remesure donc aussi quand la page a réellement changé de taille
      (`ResizeObserver`, après la mise en page), sur `orientationchange`, et
      un peu après chaque événement. Une mesure identique ne republie rien.
    */
    const minuteries = new Set<number>();
    const appliqueEtRelit = () => {
      applique();
      for (const delai of [150, 500, 1_000]) {
        const minuterie = window.setTimeout(() => {
          minuteries.delete(minuterie);
          applique();
        }, delai);
        minuteries.add(minuterie);
      }
    };
    const observateur =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(appliqueEtRelit);
    observateur?.observe(document.documentElement);
    applique();
    vue?.addEventListener("resize", applique);
    vue?.addEventListener("scroll", applique);
    window.addEventListener("resize", appliqueEtRelit);
    window.addEventListener("orientationchange", appliqueEtRelit);
    return () => {
      observateur?.disconnect();
      for (const minuterie of minuteries) window.clearTimeout(minuterie);
      vue?.removeEventListener("resize", applique);
      vue?.removeEventListener("scroll", applique);
      window.removeEventListener("resize", appliqueEtRelit);
      window.removeEventListener("orientationchange", appliqueEtRelit);
    };
  }, []);
};
