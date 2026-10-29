/**
 * Les services de l'application — **une instance chacun**, pour toute la vie de
 * la page.
 *
 * ⚠️ **Pourquoi des instances de module, et pas un état React.** Les envois en
 * attente doivent survivre à la navigation (la minuterie de 900 ms ne meurt pas
 * avec l'écran), le flux global ne doit exister qu'une fois, et l'état d'une
 * action doit être le même vu de la liste et vu du chat. Les composants s'y
 * abonnent ; aucun ne les possède.
 */
import {
  fetchAgentKinds,
  fetchConversations,
  fetchHealth,
  fetchOverview,
  openEventStream,
  reportError,
  sendPrompt,
} from "../api.ts";
import { creeActionsLocales } from "../actions-locales.ts";
import { creeMagasinDonnees } from "../donnees.ts";
import { creeMagasinEnvois, planificateurReel, type Lanceur } from "../envois.ts";
import { creeJournal } from "../journal.ts";
import { creeMagasinNotifications } from "../notifications-ecran.ts";
import { creeMagasinPleinEcran } from "../plein-ecran.ts";
import { creeMagasinVersion } from "../nouvelle-version.ts";
import type { SourceDEvenements } from "../flux-session.ts";

const planifie = (action: () => void, delai: number): (() => void) => {
  const minuterie = window.setTimeout(action, delai);
  return () => window.clearTimeout(minuterie);
};

/** Les pannes vues ici partent au journal du démon — une fois par fenêtre. */
export const journal = creeJournal(reportError);

export const magasin = creeMagasinDonnees({
  lectures: {
    conversations: fetchConversations,
    health: fetchHealth,
    kinds: fetchAgentKinds,
    overview: fetchOverview,
  },
  maintenant: () => Date.now(),
  ouvreEvenements: openEventStream,
  planifie,
  signale: journal,
  visible: () => document.visibilityState === "visible",
});

/** L'envoi réel — un échec part au journal (sans le texte : c'est du contenu). */
const lanceur: Lanceur = async (pane, text) => {
  try {
    const resultat = await sendPrompt(pane, text);
    if (resultat.kind === "failed") {
      journal("envoi en échec", { message: resultat.message, pane, state: resultat.state });
    }
    return resultat;
  } catch (cause) {
    journal("envoi en échec", {
      message: cause instanceof Error ? cause.message : String(cause),
      pane,
    });
    throw cause;
  }
};

export const envois = creeMagasinEnvois(lanceur, planificateurReel);

export const actions = creeActionsLocales();

/** Les notifications en haut de l'écran — l'issue des gestes ponctuels. */
/** L'image ouverte en plein écran. */
export const pleinEcran = creeMagasinPleinEcran();

export const notifications = creeMagasinNotifications((action, delai) => planifie(action, delai));

export { planifie };

/**
 * Le flux de session est-il connu indisponible ?
 *
 * ⚠️ Un démon qui ne le sert pas répond 404 : inutile de le redemander à chaque
 * ouverture de conversation. On le note cinq minutes, puis on réessaie — le
 * démon a pu être mis à jour entre-temps.
 *
 * ⚠️ **Noté seulement sur preuve de route absente** (`sondeFluxSession`) : un
 * pane inconnu ou sans source répond aussi 404, et coupait le direct de toutes
 * les conversations pendant cinq minutes.
 */
let fluxIndisponibleJusqua = 0;
let causeFluxIndisponible: string | null = null;
const PAUSE_FLUX_MS = 5 * 60_000;

export const noteFluxIndisponible = (cause: string): void => {
  fluxIndisponibleJusqua = Date.now() + PAUSE_FLUX_MS;
  causeFluxIndisponible = cause;
};

export const causeDuFluxIndisponible = (): string | null =>
  Date.now() < fluxIndisponibleJusqua ? causeFluxIndisponible : null;

export const ouvreurDeFlux = (): ((url: string) => SourceDEvenements) | null =>
  Date.now() < fluxIndisponibleJusqua ? null : (url) => new EventSource(url);

/** La version servie, comparée à celle de la page (`nouvelle-version.ts`). */
export const version = creeMagasinVersion({
  actuelle: () => document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? null,
  litServie: async () => {
    const reponse = await fetch("/", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!reponse.ok) throw new Error(`HTTP ${String(reponse.status)}`);
    return reponse.text();
  },
  maintenant: () => Date.now(),
  metAJourWorker: async () => {
    if (!("serviceWorker" in navigator)) return;
    const enregistrement = await navigator.serviceWorker.getRegistration();
    await enregistrement?.update();
  },
});
