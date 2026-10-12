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
 * `done` affiche **quand** ça s'est terminé — c'est ce qu'on cherche en ouvrant
 * la liste, pas l'état lui-même.
 */
const motDEtat = (conversation: ConversationSummary, maintenant: number): string => {
  if (conversation.status === "unknown") return "état inconnu";
  if (conversation.status === "done") {
    const quand = dureeDepuis(conversation.timestamp ?? null, maintenant);
    return quand === null ? "terminé" : `terminé ${quand}`;
  }
  if (conversation.status === "idle") return "au repos";
  return "en cours";
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
  return (
    <button type="button" className="conv" onClick={ouvrir}>
      <span className="conv__ligne">
        <span className="conv__origine">
          <span className="conv__projet">{projet}</span>
          {onglet.length > 0 ? <span className="conv__onglet">– {onglet}</span> : null}
        </span>
        <span className={CLASSE_ETAT[conversation.status]}>
          {motDEtat(conversation, maintenant)}
        </span>
      </span>

      {/*
        La demande occupe **deux lignes au plus**. Au-delà, une ligne de liste
        prend la moitié de l'écran et la liste cesse d'être parcourable.
      */}
      <span className="conv__demande">{conversation.lastPrompt ?? conversation.preview ?? ""}</span>

      {morceaux.length > 0 ? <span className="conv__details">{morceaux.join(" · ")}</span> : null}
    </button>
  );
};

/**
 * Mémoïsée : la liste se rafraîchit toutes les 4 s, et sans cela chaque ligne
 * se redessinerait — donc la position de défilement sauterait à chaque passage.
 */
export const ConversationRow = memo(ConversationRowInner);
