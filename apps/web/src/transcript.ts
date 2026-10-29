/**
 * La transcription d'une conversation, **incrémentale**.
 *
 * ⚠️ **Le défaut qu'elle ferme.** L'écran de conversation refaisait, à chaque
 * delta, le décodage de toutes les entrées (`JSON.parse` + schéma) puis le
 * découpage de tout l'historique en éléments. Un agent qui travaille produit un
 * delta par seconde ou plus : sur 2 000 messages, chaque delta redécodait 2 000
 * lignes et recréait 2 000 éléments — donc 2 000 lignes React à comparer.
 *
 * Ici :
 *
 * - une entrée n'est décodée **qu'une fois par objet** (`MemoMessages`) ;
 * - le découpage se fait **par tour** (une demande et ce qui la suit), et un tour
 *   dont les messages n'ont pas changé rend **les mêmes objets** qu'avant. Les
 *   lignes mémoïsées des tours anciens ne se redessinent donc pas, que le delta
 *   arrive en bas (flux) ou en haut (historique).
 *
 * Le module ne connaît ni React ni le réseau : il se vérifie en test, à
 * l'identité près.
 */
import type { Action } from "./actions.ts";
import { actionDeBloc, estBlocDeTravail } from "./actions.ts";
import {
  creeMemoMessages,
  estMessageDuHarnais,
  itemsDuTour,
  toMessages,
  toursDe,
  type Item,
  type RenderedMessage,
} from "./blocks.ts";

/** Une entrée de session, réduite à ce que la transcription lit. */
export interface EntreeTranscrite {
  readonly id?: string | undefined;
  readonly raw: string;
  readonly timestamp?: string | undefined;
  readonly type: string;
}

export interface Transcription {
  readonly messages: ReadonlyArray<RenderedMessage>;
  readonly items: ReadonlyArray<Item>;
}

const memesElements = <T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean =>
  a.length === b.length && a.every((valeur, index) => valeur === b[index]);

/**
 * Le groupeur incrémental : messages → éléments, avec un cache **par tour**.
 *
 * La clé d'un tour est son premier message (l'objet) ; le cache n'est valable
 * que si **tous** les messages du tour sont les mêmes objets. Un tour qui a
 * grandi d'un message est recalculé — lui seul.
 */
export const creeGroupeur = (): ((
  messages: ReadonlyArray<RenderedMessage>,
) => ReadonlyArray<Item>) => {
  const cache = new WeakMap<
    RenderedMessage,
    { readonly messages: ReadonlyArray<RenderedMessage>; readonly items: ReadonlyArray<Item> }
  >();
  let precedent: {
    readonly messages: ReadonlyArray<RenderedMessage>;
    readonly items: ReadonlyArray<Item>;
  } | null = null;

  return (messages) => {
    if (precedent !== null && precedent.messages === messages) return precedent.items;
    const items: Item[] = [];
    for (const tour of toursDe(messages)) {
      const premier = tour[0];
      if (premier === undefined) continue;
      const connu = cache.get(premier);
      if (connu !== undefined && memesElements(connu.messages, tour)) {
        for (const item of connu.items) items.push(item);
        continue;
      }
      const calcules = itemsDuTour(tour);
      cache.set(premier, { items: calcules, messages: tour });
      for (const item of calcules) items.push(item);
    }
    precedent = { items, messages };
    return items;
  };
};

/**
 * La transcription complète : entrées → messages → éléments.
 *
 * Une instance par conversation affichée (elle garde ses caches). Appeler deux
 * fois avec le même tableau rend le même résultat, sans aucun travail.
 */
export const creeTranscripteur = (): ((
  entries: ReadonlyArray<EntreeTranscrite>,
) => Transcription) => {
  const memo = creeMemoMessages();
  const groupe = creeGroupeur();
  let precedent: {
    readonly entries: ReadonlyArray<EntreeTranscrite>;
    readonly resultat: Transcription;
  } | null = null;
  return (entries) => {
    if (precedent !== null && precedent.entries === entries) return precedent.resultat;
    const messages = toMessages(entries, memo);
    const resultat = { items: groupe(messages), messages };
    precedent = { entries, resultat };
    return resultat;
  };
};

/** Ce que la ligne « au travail » affiche, mesuré sur la session. */
export interface TourEnCours {
  /** Instant de la demande qui a ouvert le tour, ou `null` s'il n'est pas daté. */
  readonly debutMs: number | null;
  /** Jetons déclarés par les messages du tour, ou `null` si aucun n'en déclare. */
  readonly jetons: number | null;
  /** La dernière action du tour (outil, réflexion), ou `null`. */
  readonly derniereAction: Action | null;
}

/**
 * Le message qui **ouvre** un tour : une demande de l'utilisateur, ou une carte
 * du harnais arrivée agent au repos (une fin de tâche réveille l'agent) — jamais
 * ce qui arrive PENDANT le travail (`pendantTour`) : une demande envoyée en plein
 * tour ne relance pas le chronomètre. La même règle que `tourDebut` du démon.
 */
export const ouvreUnTour = (message: RenderedMessage): boolean =>
  (message.role === "user" || estMessageDuHarnais(message)) && message.meta["pendantTour"] !== "1";

/**
 * Le tour en cours : depuis la demande qui l'a **ouvert**.
 *
 * ⚠️ **Rien n'est inventé.** La durée part de l'horodatage de la demande tel que
 * la session l'écrit, pas de l'horloge de l'écran ; sans horodatage, pas de
 * durée. Les jetons sont la somme de ce que les messages déclarent ; sans
 * déclaration, pas de chiffre.
 */
export const tourEnCours = (messages: ReadonlyArray<RenderedMessage>): TourEnCours => {
  let index = messages.length - 1;
  while (index >= 0) {
    const message = messages[index];
    if (message !== undefined && ouvreUnTour(message)) break;
    index -= 1;
  }
  const demande = index >= 0 ? messages[index] : undefined;
  const debut = demande?.at === null || demande?.at === undefined ? NaN : Date.parse(demande.at);
  let jetons = 0;
  let avecJetons = false;
  let derniereAction: Action | null = null;
  for (let courant = index + 1; courant < messages.length; courant += 1) {
    const message = messages[courant];
    if (message === undefined) continue;
    const brut = message.meta["tokens"];
    const valeur = brut === undefined ? NaN : Number.parseInt(brut, 10);
    if (Number.isFinite(valeur) && valeur > 0) {
      jetons += valeur;
      avecJetons = true;
    }
    for (const block of message.blocks) {
      if (block.kind === "toolResult") continue;
      if (estBlocDeTravail(block)) derniereAction = actionDeBloc(block);
    }
  }
  return {
    debutMs: Number.isFinite(debut) ? debut : null,
    derniereAction,
    jetons: avecJetons ? jetons : null,
  };
};

/** `true` si la page contient au moins une demande de l'utilisateur. */
export const contientDemande = (entries: ReadonlyArray<EntreeTranscrite>): boolean =>
  toMessages(entries).some((message) => message.role === "user");
