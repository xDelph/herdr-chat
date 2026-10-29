/**
 * Le suivi d'une conversation, branché sur React et sur le flux global.
 *
 * ⚠️ Le contrôleur est créé **dans l'effet**, pas pendant le rendu : en mode
 * strict, React monte, démonte et remonte — un contrôleur créé au rendu serait
 * fermé par le premier démontage puis réutilisé mort.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchSession, sondeFluxSession } from "../api.ts";
import { creeSuiviSession, type SuiviSession, type VueSession } from "../flux-session.ts";
import { contientDemande } from "../transcript.ts";
import {
  journal,
  magasin,
  noteFluxIndisponible,
  ouvreurDeFlux,
  planifie,
} from "../app/services.ts";

const VUE_VIDE: VueSession = {
  ajoutsEnHaut: 0,
  avertissement: null,
  causeRepli: null,
  chargementAncien: false,
  entries: [],
  erreur: null,
  erreurAncien: null,
  fin: null,
  phase: "chargement",
  precedent: null,
  transport: "aucun",
};

const GENRES_CONCERNES = new Set(["session_changed", "agent_status", "prompt", "resync"]);

const paneDe = (donnees: unknown): string | undefined => {
  if (typeof donnees !== "object" || donnees === null) return undefined;
  const valeur: unknown = Reflect.get(donnees, "paneId");
  return typeof valeur === "string" ? valeur : undefined;
};

const sansAbonnement = () => () => undefined;
const vueVide = () => VUE_VIDE;

export const useSuiviSession = (
  paneId: string,
  aUneSession: boolean,
): { readonly vue: VueSession; readonly suivi: SuiviSession | null } => {
  const [suivi, setSuivi] = useState<SuiviSession | null>(null);

  useEffect(() => {
    const controleur = creeSuiviSession({
      aUneSession,
      contientDemande,
      fluxIndisponible: noteFluxIndisponible,
      lit: fetchSession,
      ouvreFlux: ouvreurDeFlux(),
      paneId,
      planifie,
      signale: journal,
      sonde: sondeFluxSession,
      visible: () => document.visibilityState === "visible",
    });
    setSuivi(controleur);
    controleur.demarre();
    const arreteEcoute = magasin.ecoute((evenement) => {
      if (!GENRES_CONCERNES.has(evenement.genre)) return;
      const cible = paneDe(evenement.donnees);
      // Sans pane dans la charge, on relit quand même : rater le bon coûte plus
      // cher qu'une relecture incrémentale (~1 ms côté démon).
      if (cible === undefined || cible === paneId) controleur.signale();
    });
    const reveil = () => {
      if (document.visibilityState === "visible") controleur.reveille();
    };
    document.addEventListener("visibilitychange", reveil);
    window.addEventListener("focus", reveil);
    // Le réseau revient : le flux a pu mourir sans le dire.
    window.addEventListener("online", reveil);
    return () => {
      arreteEcoute();
      document.removeEventListener("visibilitychange", reveil);
      window.removeEventListener("focus", reveil);
      window.removeEventListener("online", reveil);
      controleur.ferme();
    };
  }, [paneId, aUneSession]);

  const lit = suivi?.vue ?? vueVide;
  const vue = useSyncExternalStore(suivi?.souscrire ?? sansAbonnement, lit, lit);
  return { suivi, vue };
};
