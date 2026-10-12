/**
 * Ligne de projet, dans la liste des projets (A02).
 *
 * **Déplacement seul** — aucun changement de rendu ni de comportement. Elle
 * vivait dans `App.tsx`, entre le routeur et l'écran, et portait les décisions
 * de lancement : c'est du code d'affichage, pas de la navigation.
 *
 * ⚠️ Deux zones cliquables distinctes, jamais imbriquées : un bouton dans un
 * bouton est du HTML invalide, et le clic sur « + » ouvrait aussi le projet.
 */
import { memo, useCallback, useState } from "react";
import type { InstalledKind, WorkspaceView } from "./api.ts";
import { LaunchSheet } from "./LaunchSheet.tsx";
import type { LaunchChoice } from "./launch.ts";
import { statusClass, statusLabel } from "./labels.tsx";

/**
 * Ligne de projet. **Cliquable** : ouvre les agents de ce projet.
 *
 * Avant, la ligne était statique — le clic ne faisait rien, ce qui laissait
 * croire à une application cassée.
 */
/**
 * Ligne de projet.
 *
 * Elle montre **ce qui s'y passe** et propose l'action utile : ouvrir l'agent
 * s'il y en a un, en lancer un sinon. Une ligne qui ne fait rien laisse croire
 * que l'application est cassée.
 */
export const WorkspaceRow = ({
  workspace,
  agentPaneCount,
  kinds,
  launching,
  onLaunch,
  onOpen,
}: {
  workspace: WorkspaceView;
  agentPaneCount: number;
  launching: boolean;
  kinds: ReadonlyArray<InstalledKind>;
  onLaunch: (workspaceId: string, kind: string, choice: LaunchChoice) => void;
  onOpen: (workspaceId: string) => void;
}) => {
  const hasAgent = agentPaneCount > 0;
  const [sheetOpen, setSheetOpen] = useState(false);
  const handleOpen = useCallback(
    () => onOpen(workspace.workspaceId),
    [onOpen, workspace.workspaceId],
  );
  const ouvrirSheet = useCallback(() => setSheetOpen(true), []);
  const fermerSheet = useCallback(() => setSheetOpen(false), []);

  /**
   * Type retenu quand on lance sans passer par la feuille.
   *
   * `pi` quand il est installé — c'est l'agent réellement utilisé, donc le
   * premierinstallé n'est pas forcément le bon. Sinon le premier que Herdr
   * connaît, et non aucun : « aucun agent installé » a déjà son refus
   * explicite sur le bouton.
   */
  const kindParDefaut =
    kinds.find((candidat) => candidat.kind === "pi")?.kind ?? kinds[0]?.kind ?? "pi";

  /**
   * Lancement immédiat, **sans choix**.
   *
   * Le `+` reste à une seule frappe : c'est l'action la plus courante, et la
   * feuille de lancement est à côté, pas dessus. Un choix omis n'est pas un
   * choix raté — l'agent démarre avec ses propres valeurs, et c'est écrit
   * dans la feuille.
   */
  const handleLaunch = useCallback(
    () => onLaunch(workspace.workspaceId, kindParDefaut, {}),
    [kindParDefaut, onLaunch, workspace.workspaceId],
  );

  return (
    /*
      Un vrai `<button>` pour la zone « ouvrir », et les contrôles de lancement
      **à côté** — jamais imbriqués. Un bouton dans un bouton est du HTML
      invalide ; le lint l'a signalé, et il avait raison.
    */
    <div className="row row--project">
      <button
        type="button"
        className="row__open"
        aria-label={
          hasAgent
            ? `Ouvrir ${workspace.label ?? "le projet"}`
            : `Lancer un agent dans ${workspace.label ?? "le projet"}`
        }
        onClick={hasAgent ? handleOpen : handleLaunch}
      >
        <span className={statusClass(workspace.agentStatus ?? "unknown")} />
        <span className="row__main">
          <strong>{workspace.label ?? "(projet sans nom)"}</strong>
          <span className="muted small">
            {agentPaneCount === 0
              ? // « état inconnu » sur un projet sans agent est du bruit : il n'y a
                // pas d'état à connaître.
                "aucun agent"
              : `${String(agentPaneCount)} agent${agentPaneCount > 1 ? "s" : ""} · ${statusLabel(workspace.agentStatus ?? "unknown")}`}
          </span>
        </span>
      </button>
      {/* Lancement possible **même si un agent tourne** : cela crée un nouvel
          onglet dans le projet. */}
      {
        <span
          className="launch"
          role="presentation"
          // Le choix du type et le lancement ne doivent pas déclencher
          // l'ouverture du projet.
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <button type="button" className="ghost launch__toggle" onClick={ouvrirSheet}>
            Options
          </button>
          <button
            type="button"
            className="row__action row__action--primary"
            onClick={handleLaunch}
            disabled={launching || workspace.checkoutPath === null || kinds.length === 0}
          >
            {/* ⚠️ Un seul libellé : dans tous les cas on **ajoute** un agent.
                « Lancer » et « + » faisaient la même chose sous deux noms. */}
            {launching ? "…" : "+"}
          </button>
        </span>
      }
      {sheetOpen ? (
        <LaunchSheet
          kinds={kinds}
          launching={launching}
          onClose={fermerSheet}
          onLaunch={onLaunch}
          titre={workspace.label ?? workspace.workspaceId}
          workspaceId={workspace.workspaceId}
        />
      ) : null}
    </div>
  );
};

// La ligne est mémoïsée : la liste des projets se redessinait en entier à chaque
// rafraîchissement du snapshot, alors que son contenu change rarement.
export const WorkspaceRowMemo = memo(WorkspaceRow);
