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
import type { WorkspaceView } from "./api.ts";
import { Feuille } from "./Feuille.tsx";

interface Props {
  readonly workspaces: ReadonlyArray<WorkspaceView>;
  readonly onClose: () => void;
  /** Ouvre le projet choisi : son détail porte déjà « Nouvel agent ». */
  readonly onPick: (workspaceId: string) => void;
}

export const ProjectPicker = ({ onClose, onPick, workspaces }: Props) => (
  <Feuille ariaLabel="Choisir un projet" onClose={onClose} titre="Où lancer l'agent ?">
    {workspaces.length === 0 ? (
      // Un parc sans projet ne s'invente pas. Le dire est utile ; proposer un
      // lancement sans cible ne l'est pas.
      <p className="muted small">Aucun projet visible dans Herdr pour l'instant.</p>
    ) : (
      <ul className="picker">
        {workspaces.map((workspace) => (
          <li key={workspace.workspaceId}>
            <button
              type="button"
              className="picker__row"
              onClick={() => onPick(workspace.workspaceId)}
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
