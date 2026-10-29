/**
 * Le magasin de données de l'application — **un seul propriétaire** pour la
 * liste, la santé et le flux d'événements global.
 *
 * ⚠️ **Les défauts qu'il ferme, tous mesurés dans la version précédente.**
 *
 * - Deux `EventSource` sur `/api/events` dès qu'une conversation était ouverte
 *   (un pour la liste, un pour le chat). Ici le flux global est ouvert **une
 *   fois** ; le chat s'y abonne (`ecoute`).
 * - Trois lectures `await`-ées **en série** à chaque événement : une rafale de
 *   cinq `agent_status` lançait quinze requêtes l'une après l'autre. Ici les
 *   signaux sont regroupés (`creeRegroupement`, 150 ms) et les lectures partent
 *   en **un seul vol** partagé (`creeClient`).
 * - La boucle de rafraîchissement redémarrait à chaque changement de l'état du
 *   direct. Ici la cadence est **relue à chaque tour** : le minuteur ne connaît
 *   pas l'état, il le demande.
 * - Une lecture ratée effaçait les deux autres. Ici chaque ressource garde sa
 *   dernière valeur lue et porte sa propre cause d'échec.
 *
 * Le module ne connaît ni React ni le réseau : tout est injecté.
 */
import type { ConversationSummary, InstalledKind } from "@herdr-remote/shared";
import type { Health, Overview } from "./api.ts";
import {
  cadence,
  creeClient,
  creeRegroupement,
  EVENEMENTS_RAFRAICHISSANTS,
} from "./rafraichissement.ts";
import type { Resultat } from "./rafraichissement.ts";

export type Direct = "live" | "down" | "inconnu";

export interface EtatDonnees {
  readonly overview: Overview | null;
  readonly health: Health | null;
  readonly conversations: ReadonlyArray<ConversationSummary> | null;
  readonly erreurs: {
    readonly overview: string | null;
    readonly health: string | null;
    readonly conversations: string | null;
  };
  /** Un vol est en cours. */
  readonly chargement: boolean;
  /** Instant de la dernière lecture réussie de la liste, ou `null`. */
  readonly dernierSucces: number | null;
  readonly direct: Direct;
  /**
   * Début de travail **observé** par pane : l'instant où le flux a annoncé le
   * passage à `working`. Absent quand on ne l'a pas vu passer — on n'invente pas
   * une durée qu'on n'a pas mesurée.
   */
  readonly debutsTravail: ReadonlyMap<string, number>;
  readonly kinds: ReadonlyArray<InstalledKind> | null;
  readonly erreurKinds: string | null;
}

/** Un événement du flux global, tel que transmis aux abonnés. */
export interface EvenementGlobal {
  readonly genre: string;
  readonly donnees: unknown;
}

export interface Lectures {
  readonly overview: () => Promise<Overview>;
  readonly health: () => Promise<Health>;
  readonly conversations: () => Promise<{
    readonly conversations: ReadonlyArray<ConversationSummary>;
  }>;
  readonly kinds: () => Promise<ReadonlyArray<InstalledKind>>;
}

export type OuvreEvenements = (gestionnaires: {
  readonly onEvent: (genre: string, donnees: unknown) => void;
  readonly onResync: () => void;
  readonly onStatus: (statut: "live" | "down") => void;
}) => () => void;

export interface DependancesDonnees {
  readonly lectures: Lectures;
  readonly ouvreEvenements: OuvreEvenements;
  readonly planifie: (action: () => void, delai: number) => () => void;
  readonly visible: () => boolean;
  readonly maintenant: () => number;
  readonly delaiRegroupement?: number;
  /** Journalise une lecture ratée (dédoublonné par l'appelant). */
  readonly signale?: (message: string, detail?: unknown) => void;
}

export interface MagasinDonnees {
  readonly etat: () => EtatDonnees;
  readonly souscrire: (abonne: () => void) => () => void;
  /** Ouvre le flux, lance la première lecture et la cadence. Idempotent. */
  readonly demarre: () => void;
  readonly arrete: () => void;
  /**
   * Lecture immédiate. Par défaut elle rejoint le vol en cours (retour au
   * premier plan) ; `frais` exige une lecture partie APRÈS l'appel (un
   * événement, le bouton « Réessayer »).
   */
  readonly rafraichit: (frais?: boolean) => Promise<void>;
  /** S'abonner aux événements du flux global (le chat, les envois). */
  readonly ecoute: (abonne: (evenement: EvenementGlobal) => void) => () => void;
  readonly lectureDesKinds: () => Promise<void>;
}

const lisChaine = (objet: unknown, cle: string): string | undefined => {
  if (typeof objet !== "object" || objet === null) return undefined;
  const valeur: unknown = Reflect.get(objet, cle);
  return typeof valeur === "string" ? valeur : undefined;
};

export const creeMagasinDonnees = (deps: DependancesDonnees): MagasinDonnees => {
  let etat: EtatDonnees = {
    chargement: false,
    conversations: null,
    debutsTravail: new Map(),
    dernierSucces: null,
    direct: "inconnu",
    erreurKinds: null,
    erreurs: { conversations: null, health: null, overview: null },
    health: null,
    kinds: null,
    overview: null,
  };
  const abonnes = new Set<() => void>();
  const ecouteurs = new Set<(evenement: EvenementGlobal) => void>();
  let generationAppliquee = 0;
  let demarre = false;
  let fermeFlux: (() => void) | null = null;
  let annuleTour: (() => void) | null = null;

  const publie = (changement: Partial<EtatDonnees>): void => {
    etat = { ...etat, ...changement };
    for (const abonne of abonnes) abonne();
  };

  const client = creeClient({
    conversations: deps.lectures.conversations,
    health: deps.lectures.health,
    overview: deps.lectures.overview,
  });

  const applique = (
    resultat: Resultat<
      Overview,
      Health,
      { readonly conversations: ReadonlyArray<ConversationSummary> }
    >,
  ): void => {
    // ⚠️ Une réponse plus ancienne que celle déjà appliquée est ignorée : la
    // liste ne revient jamais en arrière.
    if (resultat.generation <= generationAppliquee) return;
    generationAppliquee = resultat.generation;
    // Une barre rouge disparaît au rechargement ; le journal du démon, non.
    for (const [ressource, issue] of [
      ["overview", resultat.overview],
      ["health", resultat.health],
      ["conversations", resultat.conversations],
    ] as const) {
      if (!issue.ok) deps.signale?.(`lecture ${ressource} en échec`, { cause: issue.cause });
    }
    publie({
      conversations: resultat.conversations.ok
        ? resultat.conversations.valeur.conversations
        : etat.conversations,
      dernierSucces: resultat.conversations.ok ? deps.maintenant() : etat.dernierSucces,
      erreurs: {
        conversations: resultat.conversations.ok ? null : resultat.conversations.cause,
        health: resultat.health.ok ? null : resultat.health.cause,
        overview: resultat.overview.ok ? null : resultat.overview.cause,
      },
      health: resultat.health.ok ? resultat.health.valeur : etat.health,
      overview: resultat.overview.ok ? resultat.overview.valeur : etat.overview,
    });
  };

  const rafraichit = async (frais = false): Promise<void> => {
    publie({ chargement: true });
    try {
      applique(await (frais ? client.litFrais() : client.lit()));
    } finally {
      publie({ chargement: client.enVol() });
    }
  };

  const jetons = new Map<number, () => void>();
  let compteurJetons = 0;
  // Un événement dit qu'un état a changé : la lecture doit partir APRÈS lui.
  const regroupement = creeRegroupement(
    () => void rafraichit(true),
    deps.delaiRegroupement,
    (action, attente) => {
      compteurJetons += 1;
      const jeton = compteurJetons;
      jetons.set(
        jeton,
        deps.planifie(() => {
          jetons.delete(jeton);
          action();
        }, attente),
      );
      return jeton;
    },
    (jeton) => {
      jetons.get(jeton)?.();
      jetons.delete(jeton);
    },
  );
  /**
   * Le tour de fond. ⚠️ La cadence est relue **à chaque tour** : un changement
   * du direct ou de la visibilité vaut au tour suivant, sans redémarrer la
   * boucle (c'était le défaut : elle repartait à chaque `live`).
   */
  const planifieTour = (): void => {
    annuleTour?.();
    annuleTour = deps.planifie(
      () => {
        annuleTour = null;
        void rafraichit();
        planifieTour();
      },
      cadence(deps.visible(), etat.direct === "live"),
    );
  };

  const surStatut = (donnees: unknown): void => {
    const paneId = lisChaine(donnees, "paneId");
    const vers = lisChaine(donnees, "to");
    if (paneId === undefined || vers === undefined) return;
    const suivants = new Map(etat.debutsTravail);
    if (vers === "working") {
      if (!suivants.has(paneId)) suivants.set(paneId, deps.maintenant());
    } else {
      suivants.delete(paneId);
    }
    publie({ debutsTravail: suivants });
  };

  const lectureDesKinds = async (): Promise<void> => {
    try {
      publie({ erreurKinds: null, kinds: await deps.lectures.kinds() });
    } catch (cause) {
      publie({ erreurKinds: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  return {
    arrete: () => {
      demarre = false;
      fermeFlux?.();
      fermeFlux = null;
      annuleTour?.();
      annuleTour = null;
      regroupement.annule();
    },
    demarre: () => {
      if (demarre) return;
      demarre = true;
      fermeFlux = deps.ouvreEvenements({
        onEvent: (genre, donnees) => {
          if (genre === "agent_status") surStatut(donnees);
          if ((EVENEMENTS_RAFRAICHISSANTS as ReadonlyArray<string>).includes(genre)) {
            regroupement.signale();
          }
          for (const ecouteur of ecouteurs) ecouteur({ donnees, genre });
        },
        onResync: () => {
          void rafraichit(true);
          for (const ecouteur of ecouteurs) ecouteur({ donnees: null, genre: "resync" });
        },
        onStatus: (statut) => {
          if (statut !== etat.direct) publie({ direct: statut });
        },
      });
      void rafraichit();
      void lectureDesKinds();
      planifieTour();
    },
    ecoute: (abonne) => {
      ecouteurs.add(abonne);
      return () => ecouteurs.delete(abonne);
    },
    etat: () => etat,
    lectureDesKinds,
    rafraichit,
    souscrire: (abonne) => {
      abonnes.add(abonne);
      return () => abonnes.delete(abonne);
    },
  };
};
