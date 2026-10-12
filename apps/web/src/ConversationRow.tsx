/**
 * Ligne de conversation — trois lignes, plat, sans bulle.
 *
 * La disposition suit une liste dense et lisible d'un coup d'œil :
 *
 * ```
 * agent · projet                    il y a 2 min
 * Titre de la conversation
 * onglet 1 · pi · projet          En cours
 * ```
 *
 * ⚠️ **Le statut est un mot, pas une pastille.** Une pastille oblige à
 * connaître la légende ; un mot se lit. Et il est **coloré** plutôt que
 * entouré d'une pastille : c'est l'information qu'on cherche en premier — « est-ce
 * que ça m'attend ? » — donc elle doit sauter aux yeux sans lecture.
 *
 * ⚠️ **Pas de bordure entre les lignes.** L'espace fait la séparation, comme
 * dans la référence. Une bordure sur toute la largeur ajoute du bruit visuel
 * sans rien ajouter : les lignes sont déjà alignées sur la même grille.
 */
import { memo, useCallback } from "react";
import type { AgentView } from "./api.ts";
import type { AgentStatus } from "@herdr-remote/shared";
import { agentContext, agentName, statusLabel } from "./labels.tsx";
import { dureeDepuis } from "./duree.ts";

/**
 * Couleur du mot d'état.
 *
 * Le statut n'a pas de couleur « officielle » côté Herdr : ces quatre classes
 * sont les nôtres, et elles sont **vérifiées par contraste** (voir
 * `contrast.test.ts`). Un état inconnu reste en `muted` — jamais en rouge, qui
 * serait une accuses portée sur l'agent alors qu'on ne sait rien.
 */
const CLASSE_ETAT: Record<AgentStatus, string> = {
  blocked: "etat etat--bloque",
  done: "etat etat--fait",
  idle: "etat",
  unknown: "etat",
  working: "etat etat--en-cours",
};

interface Props {
  readonly agent: AgentView;
  /**
   * Dernier événement **connu** pour cet agent, ou `null`.
   *
   * ⚠️ Herdr ne fournit aucun horodatage par agent : ni `lastActivityAt`, ni
   * équivalent. La seule source réelle est le journal d'événements que
   * l'interface tient. Sans lui, la colonne reste vide — jamais une heure
   * inventée, qui serait précisément la donnée que l'utilisateur vient chercher.
   */
  readonly instant: number | null;
  readonly maintenant: number;
  readonly onOpen: (paneId: string) => void;
}

/**
 * Titre de la ligne.
 *
 * `title` est ce que l'agent a écrit comme titre de session ; à défaut, son
 * nom. Jamais l'identifiant du pane : il n'apprend rien et n'a jamais aidé
 * personne à comprendre ce qu'il regarde.
 */
const titreDe = (agent: AgentView): string => agent.title ?? agentName(agent);

const ConversationRowInner = ({ agent, instant, maintenant, onOpen }: Props) => {
  const ouvrir = useCallback(() => onOpen(agent.paneId), [agent.paneId, onOpen]);
  return (
    <button type="button" className="conv" onClick={ouvrir}>
      <span className="conv__ligne conv__ligne--haut">
        <span className="conv__source">{agentName(agent)}</span>
        <span className="conv__temps">{dureeDepuis(instant, maintenant) ?? ""}</span>
      </span>
      <span className="conv__titre">{titreDe(agent)}</span>
      <span className="conv__ligne conv__ligne--bas">
        <span className="conv__meta">{agentContext(agent)}</span>
        <span className={CLASSE_ETAT[agent.status]}>{statusLabel(agent.status)}</span>
      </span>
    </button>
  );
};

/**
 * Mémoïsée : la liste se rafraîchit toutes les 4 s, et sans cela chaque ligne
 * se redessinerait — donc la position de défilement sautait à chaque passage.
 */
export const ConversationRow = memo(ConversationRowInner);
