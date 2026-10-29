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
  "a-traiter": "Attend une décision",
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
    /*
      ⚠️ **`done` rejoint les récents, marqué non lu** (maquette « Boîte de
      réception », 2026-10-29). « Attend une décision » ne contient plus que ce
      qui se **tranche** depuis la liste — question, confiance, saisie. Une
      réponse terminée se *lit* : elle vit en tête des récents (tri par date),
      avec son point « non lu » tant qu'on ne l'a pas ouverte ici
      (`lectures.ts`). Avant, la mélanger aux décisions noyait les vraies
      questions sous des réponses à lire.
    */
    case "done":
      return "recents";
    case "idle":
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
  recent: "Plus récent",
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

/**
 * Un groupe de la liste, prêt à afficher.
 *
 * ⚠️ **Le titre est déjà résolu, et c'est délibéré.** Selon le réglage, une clé
 * est une `Section` (« à traiter ») ou un identifiant de projet : une seule des
 * deux se traduit par une table. Résoudre ici évite un `as Section` dans le
 * rendu — c'est-à-dire une assertion qui **masquerait** une clé inattendue au
 * lieu de la montrer.
 */
export interface Groupe {
  /** Clé stable, unique dans la liste : sert de `key` React et de comparaison. */
  readonly cle: string;
  readonly titre: string;
  readonly conversations: ReadonlyArray<ConversationSummary>;
}

/** Trie des lignes selon l'ordre choisi — un seul endroit. */
const trier = (
  conversations: ReadonlyArray<ConversationSummary>,
  ordre: Ordre,
): ReadonlyArray<ConversationSummary> =>
  conversations.toSorted(ordre === "nom" ? comparerParNom : comparerParDate);

/**
 * Répartit et trie les conversations par **état**.
 *
 * Chaque pane apparaît **une fois** : un agent `blocked` qui travaille aussi
 * reste dans `À traiter`, jamais en double.
 */
export const sectionConversations = (
  conversations: ReadonlyArray<ConversationSummary>,
  ordre: Ordre = "recent",
): ReadonlyArray<Groupe> =>
  SECTIONS.map((section) => ({
    cle: section,
    conversations: trier(
      conversations.filter((conversation) => sectionOf(conversation.status) === section),
      ordre,
    ),
    titre: SECTION_LABEL[section],
  })).filter((groupe) => groupe.conversations.length > 0);

/**
 * Les sections qui **restent des sections** quand la liste est groupée par
 * projet.
 *
 * ⚠️ **C'est le cœur de la règle, et elle a été corrigée par l'usage.** Une
 * première version rangeait *tout* par projet : un agent bloqué se retrouvait
 * dispersé dans le sien, alors qu'il était le seul à demander une action — il
 * fallait ouvrir chaque groupe pour trouver ce qui attendait. Le regroupement par
 * projet sert à ranger **la masse** (les agents finis et au repos) ; il ne doit
 * pas cacher ce qui demande une réponse.
 *
 * ⚠️ Et `en-cours` reste avec elles, pour une autre raison : trois agents au
 * travail se lisent d'un regard tant qu'ils sont côte à côte — « deux tournent »
 * — et ne se lisent plus du tout répartis dans leurs projets. L'attention portée
 * à un agent qui travaille est la même quel que soit le projet.
 */
const SECTIONS_D_ATTENTION: ReadonlySet<Section> = new Set(["a-traiter", "en-cours"]);

/** L'agent demande-t-il une attention qui ne dépend pas de son projet ? */
const attireLAttention = (conversation: ConversationSummary): boolean =>
  SECTIONS_D_ATTENTION.has(sectionOf(conversation.status));

/**
 * Répartit et trie les conversations par **projet**.
 *
 * `nomDuProjet` vient de l'appelant : `ConversationSummary` ne porte que
 * l'identifiant du projet, et c'est le seul endroit où le libellé existe. Le
 * passer en argument garde ce module testable **sans application** — la leçon de
 * D013.4, déjà appliquée à `sectionConversations`.
 *
 * ⚠️ **Les groupes suivent l'ordre choisi pour les lignes.** Trier les lignes par
 * nom et les groupes par date donnerait deux règles d'ordre dans le même écran,
 * et personne ne saurait plus laquelle s'applique à quoi.
 */
const groupesParProjet = (
  conversations: ReadonlyArray<ConversationSummary>,
  ordre: Ordre,
  nomDuProjet: (workspaceId: string) => string,
): ReadonlyArray<Groupe> => {
  const parProjet = new Map<string, Array<ConversationSummary>>();
  for (const conversation of conversations) {
    const lignes = parProjet.get(conversation.workspaceId);
    if (lignes === undefined) parProjet.set(conversation.workspaceId, [conversation]);
    else lignes.push(conversation);
  }
  return [...parProjet.entries()]
    .map(([workspaceId, lignes]) => ({
      cle: workspaceId,
      conversations: trier(lignes, ordre),
      titre: nomDuProjet(workspaceId),
    }))
    .toSorted(ordre === "nom" ? comparerGroupesParTitre : comparerGroupesParDate);
};

/**
 * Répartit **l'attention d'abord**, puis les projets.
 *
 * ⚠️ **Deux familles, et elles ne se rangent pas pareil.** Ce qui demande une
 * action ou signale une activité reste en tête et **n'est pas découpé par
 * projet** : c'est ce qu'on vient chercher, et le découper le cacherait. Le
 * reste — finis, au repos — forme la masse, et c'est elle qui devient illisible
 * quand les agents se multiplient : c'est donc elle, et elle seule, qu'on range
 * par projet.
 *
 * ⚠️ Un projet peut donc apparaître **sans** son agent bloqué : celui-ci est en
 * haut. C'est voulu, et c'est visible — le groupe du projet ne contient que ce
 * qu'il annonce.
 */
export const grouperAttentionPuisProjet = (
  conversations: ReadonlyArray<ConversationSummary>,
  ordre: Ordre,
  nomDuProjet: (workspaceId: string) => string,
): ReadonlyArray<Groupe> => [
  ...sectionConversations(conversations.filter(attireLAttention), ordre),
  ...groupesParProjet(
    conversations.filter((c) => !attireLAttention(c)),
    ordre,
    nomDuProjet,
  ),
];

/**
 * Répartit la liste selon le regroupement choisi.
 *
 * ⚠️ **Un seul point d'entrée**, pour que l'écran n'ait pas à décider quelle
 * fonction appeler : le choix se trouverait alors à deux endroits — le réglage et
 * l'appel — et oublier l'un des deux donnerait un réglage sans effet.
 *
 * ⚠️ Les deux chemins ne sont pas symétriques, et c'est la règle : « par
 * statut » est une répartition pure, « par projet » est une **priorité** suivie
 * d'un rangement (`grouperAttentionPuisProjet`).
 */
export const groupesDe = (
  conversations: ReadonlyArray<ConversationSummary>,
  ordre: Ordre,
  groupement: "statut" | "projet",
  nomDuProjet: (workspaceId: string) => string,
): ReadonlyArray<Groupe> =>
  groupement === "projet"
    ? grouperAttentionPuisProjet(conversations, ordre, nomDuProjet)
    : sectionConversations(conversations, ordre);

/**
 * Dernier horodatage d'un groupe, ou `null` s'il n'en a aucun.
 *
 * ⚠️ Sert à ordonner les projets « du plus récemment touché au plus ancien »,
 * c'est-à-dire avec **la même règle que les lignes** : un projet dont aucune
 * ligne n'est datée passe en dernier, comme une ligne sans date.
 */
const dateDuGroupe = (groupe: Groupe): number | null => {
  let dernier: number | null = null;
  for (const conversation of groupe.conversations) {
    const date = conversation.timestamp ?? null;
    if (date !== null && (dernier === null || date > dernier)) dernier = date;
  }
  return dernier;
};

const comparerGroupesParDate = (a: Groupe, b: Groupe): number => {
  const dateA = dateDuGroupe(a);
  const dateB = dateDuGroupe(b);
  if (dateA === null && dateB === null) return a.cle.localeCompare(b.cle);
  if (dateA === null) return 1;
  if (dateB === null) return -1;
  if (dateA !== dateB) return dateB - dateA;
  return a.cle.localeCompare(b.cle);
};

const comparerGroupesParTitre = (a: Groupe, b: Groupe): number =>
  a.titre.localeCompare(b.titre, "fr", { sensitivity: "base" }) || a.cle.localeCompare(b.cle);

/** Nombre de conversations d'un groupe, pour l'en-tête. */
export const countOf = (groupes: ReadonlyArray<Groupe>, cle: string): number =>
  groupes.find((entree) => entree.cle === cle)?.conversations.length ?? 0;
