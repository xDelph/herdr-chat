/**
 * Le suivi en direct d'**une** conversation (specs/rust-backend/STREAMING.md §4).
 *
 * ```text
 * GET /session?tail      → la page de queue, affichée
 * EventSource /stream    → `entries` (fusion par id) · `reset` (remplace) · `gone` (fin)
 * GET /session?before    → l'historique, à la demande
 * ```
 *
 * ⚠️ **Le flux n'existe pas partout.** Le démon TS répond `404` sur `/stream`
 * (mesuré : `{"error":"route inconnue"}`) ; le démon Rust le sert (H19). Un `EventSource`
 * qui reçoit une erreur HTTP passe en `CLOSED` et ne réessaie pas : on bascule
 * alors sur le **repli** — le mécanisme actuel, `session_changed` sur le flux
 * global puis `GET /session?cursor=` — et l'écran fonctionne contre les deux.
 *
 * ⚠️ **Un pane sans flux n'est pas un démon sans flux.** Un `EventSource` ne
 * dit pas pourquoi il a échoué : un pane inconnu (`404` JSON `no_source`) et
 * une route absente (`404 route inconnue`, ou le HTML de la PWA servi en `200`
 * par le démon TS) se ressemblaient, et un seul pane mort coupait le direct de
 * TOUTES les conversations pendant cinq minutes. Le repli est donc **local** au
 * pane ; seule une **sonde** qui prouve l'absence de la route le déclare au
 * reste de l'application (`fluxIndisponible`).
 *
 * ⚠️ **Un flux muet n'est pas un flux vivant.** Au retour au premier plan, au
 * retour du réseau, et après 45 s de silence, une lecture incrémentale vérifie
 * que rien n'a été manqué ; un flux qui n'est plus ouvert, ou qui a laissé
 * passer des lignes, est recréé depuis le curseur.
 *
 * ⚠️ **Un seul propriétaire par conversation, et il ne survit pas à sa
 * fermeture.** Chaque réponse arrivée après `ferme()` est ignorée, et chaque
 * lecture lancée avant un `reset` est rejetée à son retour (`epoque`) : une
 * page lue sur l'ancien curseur ne peut pas se poser sur la nouvelle vue.
 *
 * Le module ne connaît ni React, ni `fetch`, ni `EventSource` : tout est
 * injecté, donc vérifiable avec des doubles.
 */
import { Option, Schema } from "effect";
import type { SessionEntry } from "@herdr-remote/shared";
import { SessionResponse, SessionStreamEntries, SessionStreamGone } from "@herdr-remote/shared";
import { fusionnerEntrees } from "./messages.ts";
import { decideAffichage, mentionLecturePartielle } from "./session-vue.ts";

type Entree = typeof SessionEntry.Type;
type Page = typeof SessionResponse.Type;

/** Les charges du flux de session : celles du contrat généré (H19). */
const decodeEntries = Schema.decodeUnknownOption(SessionStreamEntries);
const decodeReset = Schema.decodeUnknownOption(SessionResponse);
const decodeGone = Schema.decodeUnknownOption(SessionStreamGone);

/** Ce que le module attend d'un `EventSource` — rien de plus. */
export interface SourceDEvenements {
  readonly readyState: number;
  addEventListener(type: string, ecouteur: (evenement: { readonly data?: unknown }) => void): void;
  close(): void;
}

/** `EventSource.CLOSED`, sans dépendre de la classe (absente d'un double). */
export const FERME = 2;
/** `EventSource.OPEN`. */
export const OUVERT = 1;

/**
 * Ce qu'une sonde HTTP apprend d'un flux qui n'a pas pu s'ouvrir.
 *
 * - `route-absente` : le démon ne sert pas `/stream` (404/405 sans erreur de
 *   domaine, ou une page HTML) — vrai pour tous les panes ;
 * - `pane` : la route existe, mais refuse CE pane (pane inconnu, sans source) ;
 * - `passager` : la route répond un flux, ou rien de concluant (réseau, 503).
 */
export type NatureEchecFlux = "route-absente" | "pane" | "passager";

export interface VerdictSonde {
  readonly nature: NatureEchecFlux;
  /** La cause telle que le démon l'a donnée, quand il en a donné une. */
  readonly detail: string | null;
}

export type LitSession = (
  paneId: string,
  options: { readonly before?: string; readonly cursor?: string; readonly tail?: number },
) => Promise<Page>;

/** D'où vient le contenu en ce moment. */
export type Transport = "flux" | "repli" | "aucun";

export interface VueSession {
  readonly entries: ReadonlyArray<Entree>;
  /** `chargement` tant que la première page n'est pas là. */
  readonly phase: "chargement" | "pret" | "erreur";
  /** Cause réelle de la dernière lecture ratée, ou `null`. */
  readonly erreur: string | null;
  /** Le fil est affiché mais incomplet (lecture vide, reset illisible…). */
  readonly avertissement: string | null;
  readonly transport: Transport;
  /** Pourquoi le flux s'est arrêté pour de bon (`gone`), ou `null`. */
  readonly fin: string | null;
  /** Curseur de l'historique plus ancien, `null` quand il n'y a plus rien. */
  readonly precedent: string | null;
  readonly chargementAncien: boolean;
  readonly erreurAncien: string | null;
  /** Augmente à chaque ajout **en haut** du fil : sert à ancrer le défilement. */
  readonly ajoutsEnHaut: number;
  /** Pourquoi ce pane est en repli, quand il l'est. */
  readonly causeRepli: string | null;
}

export interface SuiviSession {
  readonly vue: () => VueSession;
  readonly souscrire: (abonne: () => void) => () => void;
  readonly demarre: () => void;
  /** Un événement global concerne ce pane (`session_changed`, `prompt`…). */
  readonly signale: () => void;
  /**
   * Retour au premier plan, ou retour du réseau : relire tout de suite, et
   * recréer le flux s'il n'est plus ouvert.
   */
  readonly reveille: () => void;
  readonly chargePlusAncien: () => Promise<void>;
  readonly ferme: () => void;
}

export interface DependancesSuivi {
  readonly paneId: string;
  /** `false` quand Herdr n'expose aucune session : rien à lire, rien à demander. */
  readonly aUneSession: boolean;
  readonly lit: LitSession;
  /** `null` = le flux est connu indisponible : repli direct. */
  readonly ouvreFlux: ((url: string) => SourceDEvenements) | null;
  readonly planifie: (action: () => void, delai: number) => () => void;
  /** Une page contient-elle une demande de l'utilisateur ? */
  readonly contientDemande: (entries: ReadonlyArray<Entree>) => boolean;
  /**
   * Prévenu quand la **route** du flux est prouvée absente (pour ne pas
   * réessayer à chaque ouverture). ⚠️ Jamais pour un pane : un pane mort ne
   * coupe pas le direct des autres.
   */
  readonly fluxIndisponible?: (cause: string) => void;
  /**
   * Qualifie un échec d'ouverture par une requête HTTP sur la même URL. Sans
   * sonde, l'échec reste local au pane : on ne déclare jamais une route
   * absente sans preuve.
   */
  readonly sonde?: (url: string) => Promise<VerdictSonde>;
  /** L'horloge — injectée pour la veille. */
  readonly maintenant?: () => number;
  /** La page est-elle visible ? La veille ne travaille pas pour un écran caché. */
  readonly visible?: () => boolean;
  readonly fenetreInitiale?: number;
}

/** Première lecture : la fin du fichier, pas le fichier entier. */
export const FENETRE_INITIALE_OCTETS = 256 * 1024;
/** Erreurs avant ouverture au-delà desquelles le flux est déclaré indisponible. */
export const ECHECS_FLUX_MAX = 3;
/** Regroupement des signaux du flux global, en repli. */
export const DELAI_SIGNAL_MS = 120;
/** Le filet du repli : une relecture même quand rien n'est signalé. */
export const FILET_REPLI_MS = 15_000;
/** Délai avant de rouvrir un flux qui s'est fermé après avoir fonctionné. */
export const DELAI_REOUVERTURE_MS = 2_000;
/** Pages vides consécutives tolérées en remontant l'historique. */
export const PAGES_VIDES_MAX = 8;
/** Pages lues au plus par remontée — un fichier sans demande ne se lit pas en entier. */
export const PAGES_PAR_REMONTEE = 12;
/** Silence (ni événement, ni lecture réussie) au-delà duquel la veille vérifie le flux. */
export const SILENCE_MAX_MS = 45_000;
/** Période de la veille du flux. */
export const VEILLE_MS = 15_000;
/** Un échec passager du flux : on retente de l'ouvrir après ce délai. */
export const RETOUR_FLUX_MS = 30_000;

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const lireJson = (donnees: unknown): unknown => {
  if (typeof donnees !== "string") return donnees;
  try {
    return JSON.parse(donnees);
  } catch {
    return undefined;
  }
};

export const urlDuFlux = (paneId: string, curseur: string | undefined): string =>
  `/api/agents/${encodeURIComponent(paneId)}/stream${
    curseur === undefined ? "" : `?cursor=${encodeURIComponent(curseur)}`
  }`;

export const creeSuiviSession = (deps: DependancesSuivi): SuiviSession => {
  const fenetre = deps.fenetreInitiale ?? FENETRE_INITIALE_OCTETS;
  const maintenant = deps.maintenant ?? (() => Date.now());
  const visible = deps.visible ?? (() => true);
  let vue: VueSession = {
    ajoutsEnHaut: 0,
    avertissement: null,
    causeRepli: null,
    chargementAncien: false,
    entries: [],
    erreur: null,
    erreurAncien: null,
    fin: null,
    phase: deps.aUneSession ? "chargement" : "pret",
    precedent: null,
    transport: "aucun",
  };
  const abonnes = new Set<() => void>();
  let ferme = false;
  let curseur: string | undefined;
  /** Change à chaque remplacement de la vue : une lecture plus ancienne est périmée. */
  let epoque = 0;
  let source: SourceDEvenements | null = null;
  let echecsFlux = 0;
  let lectureEnCours = false;
  let relireEnsuite = false;
  let annuleSignal: (() => void) | null = null;
  let annuleFilet: (() => void) | null = null;
  let annuleReouverture: (() => void) | null = null;
  let annuleVeille: (() => void) | null = null;
  let annuleRetour: (() => void) | null = null;
  /** Dernier signe de vie du contenu : un événement du flux, ou une lecture réussie. */
  let dernierSigne = maintenant();

  const publie = (changement: Partial<VueSession>): void => {
    if (ferme) return;
    vue = { ...vue, ...changement };
    for (const abonne of abonnes) abonne();
  };

  /** Applique une page complète (lecture HTTP ou `reset` du flux). */
  const appliquePage = (page: Page): void => {
    const decision = decideAffichage({
      affiches: vue.entries.length,
      page: {
        cause: page.cause,
        entries: page.entries,
        incremental: page.incremental,
        reset: page.reset,
      },
    });
    if (page.cursor !== undefined) curseur = page.cursor;
    const precedent =
      !page.incremental || page.reset ? (page.previousCursor ?? null) : vue.precedent;
    switch (decision.genre) {
      case "remplace":
        epoque += 1;
        publie({
          avertissement: null,
          entries: decision.entries,
          erreur: null,
          phase: "pret",
          precedent,
        });
        return;
      case "ajoute":
        publie({
          avertissement: null,
          entries: fusionnerEntrees(vue.entries, decision.entries),
          erreur: null,
          phase: "pret",
          precedent,
        });
        return;
      case "garde-et-previens":
        publie({
          avertissement: mentionLecturePartielle(decision.raison),
          erreur: null,
          phase: "pret",
        });
        return;
      case "garde":
        publie({ erreur: null, phase: "pret" });
    }
  };

  const echecDeLecture = (cause: unknown): void => {
    const texte = message(cause);
    // Un fil déjà affiché reste affiché : l'erreur dit qu'on n'a pas pu lire
    // *maintenant*, pas que la conversation n'existe plus (session-vue.ts).
    publie(
      vue.entries.length > 0
        ? { avertissement: mentionLecturePartielle(texte), erreur: texte }
        : { erreur: texte, phase: "erreur" },
    );
  };

  /**
   * Lecture incrémentale (ou de queue sans curseur) — une à la fois. Rend
   * `true` quand la lecture a **apporté** des entrées.
   */
  const litIncrement = async (): Promise<boolean> => {
    if (ferme || !deps.aUneSession) return false;
    if (lectureEnCours) {
      relireEnsuite = true;
      return false;
    }
    lectureEnCours = true;
    const mienne = epoque;
    try {
      const page = await deps.lit(
        deps.paneId,
        curseur === undefined ? { tail: fenetre } : { cursor: curseur },
      );
      if (ferme) return false;
      // ⚠️ Une page lue avant un `reset` décrit l'ANCIENNE vue : on la jette.
      if (mienne !== epoque && !page.reset) return false;
      dernierSigne = maintenant();
      const avant = vue.entries;
      appliquePage(page);
      return vue.entries !== avant;
    } catch (cause) {
      if (!ferme) echecDeLecture(cause);
      return false;
    } finally {
      lectureEnCours = false;
      if (relireEnsuite && !ferme) {
        relireEnsuite = false;
        void litIncrement();
      }
    }
  };

  const armeFilet = (): void => {
    annuleFilet?.();
    if (ferme || vue.transport !== "repli") return;
    annuleFilet = deps.planifie(() => {
      annuleFilet = null;
      void litIncrement();
      armeFilet();
    }, FILET_REPLI_MS);
  };

  const passeEnRepli = (cause: string | null): void => {
    source?.close();
    source = null;
    annuleVeille?.();
    annuleVeille = null;
    // ⚠️ Local à CE pane : rien n'est déclaré au reste de l'application ici.
    publie({ causeRepli: cause, transport: "repli" });
    armeFilet();
    // Rattrape ce qui a pu s'écrire pendant la tentative de flux.
    void litIncrement();
  };

  /**
   * Qualifie un échec d'ouverture. Seule une route **prouvée** absente est
   * déclarée au reste de l'application ; un pane refusé reste en repli local,
   * un échec passager retente le flux plus tard.
   */
  const qualifieEchec = async (url: string): Promise<void> => {
    if (deps.sonde === undefined) return;
    let verdict: VerdictSonde;
    try {
      verdict = await deps.sonde(url);
    } catch {
      verdict = { detail: null, nature: "passager" };
    }
    if (ferme || vue.transport !== "repli") return;
    switch (verdict.nature) {
      case "route-absente": {
        const cause = "le démon ne sert pas le flux de session";
        deps.fluxIndisponible?.(cause);
        publie({ causeRepli: cause });
        return;
      }
      case "pane":
        publie({
          causeRepli: `le démon refuse le flux pour ce pane${
            verdict.detail === null ? "" : ` (${verdict.detail})`
          }`,
        });
        return;
      case "passager":
        annuleRetour?.();
        annuleRetour = deps.planifie(() => {
          annuleRetour = null;
          if (ferme || vue.transport !== "repli" || vue.fin !== null) return;
          annuleFilet?.();
          annuleFilet = null;
          ouvreFlux();
        }, RETOUR_FLUX_MS);
    }
  };

  /** Recrée le flux depuis le curseur : l'ancien se tait, le nouveau reprend. */
  const rouvreFlux = (): void => {
    source?.close();
    source = null;
    ouvreFlux();
  };

  /**
   * La veille du flux, tant qu'il est ouvert : après un silence, une lecture
   * témoin. Si elle apporte des lignes que le flux aurait dû porter, ou si le
   * flux n'est plus ouvert, on le recrée.
   *
   * ⚠️ Un flux silencieux sur une conversation au repos est normal : le
   * silence seul ne fait pas reconnecter, la preuve d'un manque si.
   */
  const verifieFlux = async (): Promise<void> => {
    if (ferme || vue.transport !== "flux") return;
    if (source === null || source.readyState !== OUVERT) {
      void litIncrement();
      rouvreFlux();
      return;
    }
    const apporte = await litIncrement();
    if (apporte && !ferme && vue.transport === "flux") rouvreFlux();
  };

  const armeVeille = (): void => {
    annuleVeille?.();
    if (ferme || vue.transport !== "flux") return;
    annuleVeille = deps.planifie(() => {
      annuleVeille = null;
      if (visible() && maintenant() - dernierSigne >= SILENCE_MAX_MS) void verifieFlux();
      armeVeille();
    }, VEILLE_MS);
  };

  const ouvreFlux = (): void => {
    if (ferme || deps.ouvreFlux === null) return;
    const ouvrir = deps.ouvreFlux;
    let ouvert = false;
    let courante: SourceDEvenements;
    try {
      courante = ouvrir(urlDuFlux(deps.paneId, curseur));
    } catch (cause) {
      passeEnRepli(`flux de session impossible à ouvrir : ${message(cause)}`);
      return;
    }
    const url = urlDuFlux(deps.paneId, curseur);
    source = courante;
    const actuelle = (): boolean => !ferme && source === courante;

    /*
      ⚠️ Un événement reçu prouve aussi que le flux est ouvert : certains
      mandataires (le proxy de développement de Vite, mesuré) retiennent les
      en-têtes jusqu'au premier octet du corps, et `open` n'arrive qu'avec lui.
    */
    const marqueOuvert = (): void => {
      dernierSigne = maintenant();
      if (ouvert) return;
      ouvert = true;
      echecsFlux = 0;
      annuleFilet?.();
      annuleFilet = null;
      publie({ causeRepli: null, transport: "flux" });
      armeVeille();
    };
    courante.addEventListener("open", () => {
      if (actuelle()) marqueOuvert();
    });

    courante.addEventListener("entries", (evenement) => {
      if (!actuelle()) return;
      marqueOuvert();
      const lu = Option.getOrUndefined(decodeEntries(lireJson(evenement.data)));
      if (lu === undefined) {
        // Un événement illisible ne se devine pas : on le dit, et on relit par
        // HTTP depuis le dernier curseur sûr.
        publie({ avertissement: "Événement « entries » illisible — relecture de la session." });
        void litIncrement();
        return;
      }
      curseur = lu.cursor;
      if (lu.entries.length === 0) return;
      publie({
        entries: fusionnerEntrees(vue.entries, lu.entries),
        erreur: null,
        phase: "pret",
      });
    });

    courante.addEventListener("reset", (evenement) => {
      if (!actuelle()) return;
      marqueOuvert();
      const page = Option.getOrUndefined(decodeReset(lireJson(evenement.data)));
      if (page === undefined) {
        publie({ avertissement: "Événement « reset » illisible — relecture de la session." });
        curseur = undefined;
        void litIncrement();
        return;
      }
      appliquePage({ ...page, reset: true });
    });

    courante.addEventListener("gone", (evenement) => {
      if (!actuelle()) return;
      const lu = Option.getOrUndefined(decodeGone(lireJson(evenement.data)));
      courante.close();
      source = null;
      // ⚠️ Fin définitive : pas de reconnexion en boucle, la cause est montrée.
      publie({
        fin: lu?.reason ?? "le démon a fermé le flux sans donner de raison",
        transport: "aucun",
      });
    });

    courante.addEventListener("error", () => {
      if (!actuelle()) return;
      if (!ouvert) {
        echecsFlux += 1;
        if (courante.readyState === FERME || echecsFlux >= ECHECS_FLUX_MAX) {
          passeEnRepli(
            courante.readyState === FERME
              ? "le flux de session a été refusé pour ce pane"
              : `le flux de session n'a pas pu s'ouvrir (${String(echecsFlux)} essais)`,
          );
          void qualifieEchec(url);
        }
        return;
      }
      // Le flux a fonctionné : le navigateur reconnecte seul (Last-Event-ID).
      // S'il abandonne (erreur HTTP à la reconnexion), on rouvre depuis le curseur.
      if (courante.readyState !== FERME) return;
      courante.close();
      source = null;
      annuleReouverture?.();
      annuleReouverture = deps.planifie(() => {
        annuleReouverture = null;
        ouvreFlux();
      }, DELAI_REOUVERTURE_MS);
    });
  };

  const demarre = (): void => {
    if (ferme || !deps.aUneSession) return;
    void (async () => {
      const mienne = epoque;
      try {
        const page = await deps.lit(deps.paneId, { tail: fenetre });
        if (ferme) return;
        if (mienne === epoque) appliquePage(page);
      } catch (cause) {
        if (!ferme) echecDeLecture(cause);
      }
      if (ferme) return;
      if (deps.ouvreFlux === null) passeEnRepli(null);
      else ouvreFlux();
      // Une page de queue sans demande ne se lit pas : on remonte jusqu'à elle.
      if (vue.precedent !== null && !deps.contientDemande(vue.entries)) {
        await chargePlusAncien();
      }
    })();
  };

  const chargePlusAncien = async (): Promise<void> => {
    if (ferme || vue.chargementAncien || vue.precedent === null) return;
    const mienne = epoque;
    publie({ chargementAncien: true, erreurAncien: null });
    try {
      let pageCurseur: string | null = vue.precedent;
      let vides = 0;
      let lues = 0;
      const anciennes: Array<ReadonlyArray<Entree>> = [];
      while (pageCurseur !== null && lues < PAGES_PAR_REMONTEE) {
        // Séquentiel par nature : chaque page donne le curseur de la suivante.
        // oxlint-disable-next-line no-await-in-loop
        const page = await deps.lit(deps.paneId, { before: pageCurseur });
        lues += 1;
        if (ferme || mienne !== epoque) return;
        if (page.reset) {
          appliquePage(page);
          return;
        }
        anciennes.push(page.entries);
        const suivant: string | null = page.previousCursor ?? null;
        if (suivant === null || suivant === pageCurseur) {
          pageCurseur = null;
          break;
        }
        pageCurseur = suivant;
        // ⚠️ Une page VIDE n'est pas la fin : une ligne plus grande que la
        // fenêtre la remplit entièrement. On continue, avec un plafond.
        if (page.entries.length === 0) {
          vides += 1;
          if (vides >= PAGES_VIDES_MAX) break;
          continue;
        }
        vides = 0;
        if (deps.contientDemande(page.entries)) break;
      }
      const ajout = anciennes.toReversed().flat();
      publie({
        ajoutsEnHaut: ajout.length > 0 ? vue.ajoutsEnHaut + 1 : vue.ajoutsEnHaut,
        entries: ajout.length > 0 ? [...ajout, ...vue.entries] : vue.entries,
        // Rien ramené = plus rien à remonter : un curseur vivant ferait boucler.
        precedent: ajout.length > 0 ? pageCurseur : null,
      });
    } catch (cause) {
      if (!ferme && mienne === epoque) publie({ erreurAncien: message(cause) });
    } finally {
      if (!ferme) publie({ chargementAncien: false });
    }
  };

  return {
    chargePlusAncien,
    demarre,
    ferme: () => {
      ferme = true;
      source?.close();
      source = null;
      annuleSignal?.();
      annuleFilet?.();
      annuleReouverture?.();
      annuleVeille?.();
      annuleRetour?.();
      abonnes.clear();
    },
    reveille: () => {
      if (ferme) return;
      if (vue.transport === "repli") {
        void litIncrement();
        return;
      }
      // En direct : le flux a pu mourir pendant la veille de l'appareil sans
      // le dire. On rattrape par HTTP, et on le recrée s'il n'est plus ouvert.
      if (vue.transport === "flux") {
        void litIncrement();
        if (source === null || source.readyState !== OUVERT) rouvreFlux();
      }
    },
    signale: () => {
      // En direct, le flux de session porte déjà le contenu : un signal global
      // n'apprend rien de plus, et relire doublerait le trafic.
      if (ferme || vue.transport !== "repli" || annuleSignal !== null) return;
      annuleSignal = deps.planifie(() => {
        annuleSignal = null;
        void litIncrement();
      }, DELAI_SIGNAL_MS);
    },
    souscrire: (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
    vue: () => vue,
  };
};
