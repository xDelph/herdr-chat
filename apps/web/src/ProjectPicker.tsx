/**
 * Choix du projet — pour le bouton flottant « Nouvel agent ».
 *
 * ⚠️ Lancer un agent exige une cible, et le bouton flottant est **sans**
 * contexte : il n'y a pas de projet « courant ». Deux solutions : demander le
 * projet, ou envoyer vers l'onglet Projets.
 *
 * On demande. Le bouton dit « nouvel agent » ; s'il menait à la liste des
 * projets, il ne ferait pas ce qu'il annonce, et l'utilisateur devrait
 * recommencer sa sélection.
 */
import { useState } from "react";
import type { WorkspaceView } from "./api.ts";
import { Feuille } from "./Feuille.tsx";

interface Props {
  readonly workspaces: ReadonlyArray<WorkspaceView>;
  readonly onClose: () => void;
  /** Ouvre le projet choisi : son détail porte déjà « Nouvel agent ». */
  readonly onPick: (workspaceId: string) => void;
}

export const ProjectPicker = ({ onClose, onPick, workspaces }: Props) => {
  const [projetEnAttente, setProjetEnAttente] = useState<string | null>(null);
  const fermer = () => {
    if (projetEnAttente === null) onClose();
    else onPick(projetEnAttente);
  };

  return (
    <Feuille
      ariaLabel="Choose a workspace"
      fermeture={projetEnAttente !== null}
      onClose={fermer}
      titre="Where should the agent run?"
    >
      {workspaces.length === 0 ? (
        <p className="muted small">No workspaces visible in Herdr yet.</p>
      ) : (
        <ul className="picker">
          {workspaces.map((workspace) => (
            <li key={workspace.workspaceId}>
              <button
                type="button"
                className="picker__row"
                disabled={projetEnAttente !== null}
                onClick={() => setProjetEnAttente(workspace.workspaceId)}
              >
                <span className="picker__nom">{workspace.label ?? workspace.workspaceId}</span>
                <span className="picker__compte">
                  {workspace.agentPanes.length === 1
                    ? "1 agent"
                    : `${String(workspace.agentPanes.length)} agents`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Feuille>
  );
};
