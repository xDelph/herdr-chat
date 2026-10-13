/**
 * Répartition des panes en sections — la règle de l'accueil (U04).
 *
 * **Pourquoi un module à part.** Cette règle est une décision de produit, pas
 * du rendu : elle décide de ce que l'utilisateur voit en premier, et elle doit
 * être **testable sans application**. Encastrée dans un composant, elle ne
 * pourrait être vérifiée qu'en ouvrant l'app — la leçon de D013.4.
 *
 * La règle, exactement :
 *
 * 1. un pane apparaît **une fois** et une seule — `À traiter` si `blocked`,
 *    `En cours` si `working`, `Récents` sinon ;
 * 2. dans chaque section, l'ordre est **choisi** : dernier message décroissant
 *    (défaut) ou nom croissant ;
 * 3. à horodatage absent : **en dernier** ;
 * 4. à valeur égale : `paneId` **croissant**, pour que deux rafraîchissements ne
 *    réordonnent pas la même liste.
 *
 * Le point 3 est le contrepied du point 2 : une ligne sans horodatage n'est
 * pas « la plus ancienne », elle est **hors classement**, donc en bas. La
 * confondre avec une date à zéro la remonterait en tête de liste.
 */
import type { AgentStatus, ConversationSummary } from "@herdr-remote/shared";

export const SECTIONS = ["a-traiter", "en-cours", "recents"] as const;
export type Section = (typeof SECTIONS)[number];

/** Libellés exacts, utilisés par l'interface. */
export const SECTION_LABEL: Record<Section, string> = {
  "a-traiter": "À traiter",
  "en-cours": "En cours",
  recents: "Récents",
};

/**
 * Section d'un pane, selon son statut.
 *
 * `blocked` passe **avant** `working` : un agent bloqué demande une action même
 * s'il travaille encore par moments. L'inverse ferait disparaître d'« À
 * traiter » un agent qui l'était une seconde plus tôt.
 */
export const sectionOf = (status: AgentStatus): Section => {
  switch (status) {
    case "blocked":
      return "a-traiter";
    case "working":
      return "en-cours";
    case "idle":
    case "done":
    case "unknown":
      return "recents";
    default:
      // Un statut hors union ne doit pas disparaître de la liste : il rejoint
      // les récents, qui affichent tout.
      return "recents";
  }
};

/**
 * Compare deux lignes.
 *
 * `null` pour un horodatage absent : `null` est traité comme **infini** dans le
 * tri décroissant, donc ces lignes atterrissent en bas — sans être exclues.
 */
/** Comparateur par nom, avec repli sur `paneId` : l'ordre reste déterministe. */
const comparerParNom = (a: ConversationSummary, b: ConversationSummary): number =>
  nomDe(a).localeCompare(nomDe(b), "fr", { sensitivity: "base" }) ||
  a.paneId.localeCompare(b.paneId);

const comparerParDate = (a: ConversationSummary, b: ConversationSummary): number => {
  const dateA = a.timestamp ?? null;
  const dateB = b.timestamp ?? null;

  // Absence de date : toujours après une ligne datée.
  if (dateA === null && dateB === null) return a.paneId.localeCompare(b.paneId);
  if (dateA === null) return 1;
  if (dateB === null) return -1;

  if (dateA !== dateB) return dateB - dateA;
  // À horodatage égal, l'ordre est déterministe : sinon deux rafraîchissements
  // pourraient réordonner la même liste.
  return a.paneId.localeCompare(b.paneId);
};

/**
 * Ordre d'affichage dans une section.
 *
 * ⚠️ Le défaut reste `recent` : c'est le contrat U04, et c'est aussi ce qui a du
 * sens à l'ouverture — on veut voir ce qui vient de bouger. `nom` sert à
 * retrouver une conversation précise quand on sait comment elle s'appelle.
 */
export const ORDRES = ["recent", "nom"] as const;
export type Ordre = (typeof ORDRES)[number];

/** Libellés exacts, utilisés par le sélecteur. */
export const ORDRE_LABEL: Record<Ordre, string> = {
  recent: "Plus récentes",
  nom: "Par nom",
};

/**
 * Titre utilisé pour le tri alphabétique.
 *
 * ⚠️ On trie sur le **libellé affiché**, pas sur `title` seul : la cascade de
 * titre retombe sur le libellé d'onglet, puis de projet. Trier sur un champ
 * vide placerait toutes ces lignes au même rang.
 */
const nomDe = (conversation: ConversationSummary): string => conversation.title ?? "";

/** Une section de la liste, prête à afficher. */
export interface Sectioned {
  readonly section: Section;
  readonly conversations: ReadonlyArray<ConversationSummary>;
}

/**
 * Répartit et trie les conversations.
 *
 * Chaque pane apparaît **une fois** : un agent `blocked` qui travaille aussi
 * reste dans `À traiter`, jamais en double.
 */
export const sectionConversations = (
  conversations: ReadonlyArray<ConversationSummary>,
  ordre: Ordre = "recent",
): ReadonlyArray<Sectioned> =>
  SECTIONS.map((section) => ({
    conversations: conversations
      .filter((conversation) => sectionOf(conversation.status) === section)
      .toSorted(ordre === "nom" ? comparerParNom : comparerParDate),
    section,
  }));

/** Nombre de conversations par section, pour l'en-tête. */
export const countOf = (sectioned: ReadonlyArray<Sectioned>, section: Section): number =>
  sectioned.find((entree) => entree.section === section)?.conversations.length ?? 0;
