/**
 * Ligne de conversation — trois lignes, plates, sans cadre (U17).
 *
 * ```
 * projet – onglet                             En cours
 * la dernière demande de l'utilisateur, sur deux lignes au plus
 * chore/setup · modèle · raisonnement
 * ```
 *
 * ⚠️ **Aucun cadre, aucune bordure.** La liste est une suite de lignes
 * séparées par l'espace, comme dans la référence. Un cadre autour de chaque
 * entrée transforme une liste en tableau, et le regard doit alors traverser
 * quatre traits pour atteindre le texte.
 *
 * ⚠️ **La deuxième ligne est la demande, pas la réponse.** C'est ce que
 * l'utilisateur a écrit, et c'est ce qu'il reconnaît. Afficher la réponse de
 * l'agent obligerait à la relire pour se rappeler de quoi il s'agissait.
 */
import { memo, useCallback } from "react";
import type { ConversationSummary } from "@herdr-remote/shared";
import { etiquetteDePane } from "@herdr-remote/shared";
import { AgentBadge } from "./AgentBadge.tsx";
import { levelLabel } from "./launch.ts";
import { dureeDepuis } from "./duree.ts";

/** Couleur du mot d'état, par état du contrat. */
const CLASSE_ETAT: Record<ConversationSummary["status"], string> = {
  blocked: "etat etat--bloque",
  done: "etat etat--fait",
  idle: "etat",
  unknown: "etat",
  working: "etat etat--en-cours",
};

/**
 * Mot d'état.
 *
 * « Inconnu » devient « état inconnu » : le mot seul laisserait croire à un
 * défaut de l'application plutôt qu'à une information qu'Herdr ne donne pas.
 * `done` et `idle` affichent **quand** le dernier travail s'est terminé, si la
 * session fournit son horodatage. `idle` sans historique reste simplement idle.
 */
const motDEtat = (conversation: ConversationSummary, maintenant: number): string => {
  if (conversation.status === "unknown") return "unknown status";
  if (conversation.status === "done" || conversation.status === "idle") {
    const quand = dureeDepuis(conversation.timestamp ?? null, maintenant);
    if (quand !== null) return `finished ${quand}`;
    return conversation.status === "done" ? "finished" : "idle";
  }
  return "working";
};

/**
 * Fragments de la troisième ligne.
 *
 * ⚠️ **Chaque fragment absent disparaît**, il n'est pas remplacé par un tiret
 * de remplissage : une ligne « — · — · — » occupe la place d'une information
 * sans en porter aucune. Un agent dont la session ne déclare ni modèle ni
 * raisonnement n'affiche que sa branche, et c'est exact.
 */
const fragments = (conversation: ConversationSummary): ReadonlyArray<string> => {
  const morceaux: Array<string> = [];
  if (conversation.branch !== undefined) morceaux.push(conversation.branch);
  if (conversation.model !== undefined) morceaux.push(conversation.model);
  if (conversation.thinking !== undefined) morceaux.push(levelLabel(conversation.thinking));
  return morceaux;
};

interface Props {
  /** Ligne construite par le serveur : elle porte tout ce qui s'affiche. */
  readonly conversation: ConversationSummary;
  /** Nom du projet — `ConversationSummary` ne porte que son identifiant. */
  readonly projet: string;
  readonly onglet: string;
  readonly maintenant: number;
  readonly onOpen: (paneId: string) => void;
}

const ConversationRowInner = ({ conversation, maintenant, onglet, onOpen, projet }: Props) => {
  const ouvrir = useCallback(() => onOpen(conversation.paneId), [conversation.paneId, onOpen]);
  const morceaux = fragments(conversation);
  /*
    ⚠️ L'etiquette du pane vient de la **fonction partagee**, la meme que celle
    de l'en-tete et de la notification. Les deux libelles du contexte (projet,
    onglet) lui sont passes : c'est avec eux qu'elle decide si un nom dit
    quelque chose de plus ou s'il ne fait que repeter la ligne.
  */
  const etiquette = etiquetteDePane({
    ...conversation,
    tabLabel: onglet.length > 0 ? onglet : null,
    workspaceLabel: projet,
  });
  return (
    <button type="button" className="conv" onClick={ouvrir}>
      <span className="conv__ligne">
        <span className="conv__origine">
          {/*
            La marque de l'agent, devant le nom du projet.

            ⚠️ **Dans la ligne du titre, pas a droite ni en dessous.** C'est la
            seule information qui dit *qui* travaille : elle doit tomber sous
            l'oeil quand on parcourt la liste, sans qu'il faille lire la ligne
            de details — qui est tronquee a l'ellipse sur un ecran etroit.
          */}
          <AgentBadge kind={conversation.agent} />
          <span className="conv__projet">{projet}</span>
          {onglet.length > 0 ? <span className="conv__onglet">– {onglet}</span> : null}
          {etiquette === undefined ? null : <span className="conv__pane">{etiquette}</span>}
        </span>
        <span className={CLASSE_ETAT[conversation.status]}>
          {motDEtat(conversation, maintenant)}
        </span>
      </span>

      {/*
        La demande occupe **deux lignes au plus**. Au-delà, une ligne de liste
        prend la moitié de l'écran et la liste cesse d'être parcourable.
      */}
      {conversation.lastPrompt === undefined ? null : (
        <span className="conv__demande">{conversation.lastPrompt}</span>
      )}

      {morceaux.length > 0 ? <span className="conv__details">{morceaux.join(" · ")}</span> : null}
    </button>
  );
};

/**
 * Mémoïsée : la liste se rafraîchit toutes les 4 s, et sans cela chaque ligne
 * se redessinerait — donc la position de défilement sauterait à chaque passage.
 */
export const ConversationRow = memo(ConversationRowInner);
