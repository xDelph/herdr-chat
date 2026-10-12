/**
 * Ligne de conversation, dans la liste des agents (A02).
 *
 * **Déplacement seul.** L'identifiant passe par `data-pane` plutôt que par une
 * closure : la liste peut contenir beaucoup d'agents, et une closure par ligne
 * se recrée à chaque rafraîchissement du snapshot.
 */
import { useCallback } from "react";
import type { AgentView } from "./api.ts";
import { agentContext, agentName, statusClass, statusLabel } from "./labels.tsx";

export const AgentRow = ({
  agent,
  onOpen,
}: {
  agent: AgentView;
  onOpen: (paneId: string) => void;
}) => {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const paneId = event.currentTarget.dataset["pane"];
      if (paneId !== undefined) onOpen(paneId);
    },
    [onOpen],
  );

  return (
    <button
      type="button"
      className="row"
      aria-label={`Ouvrir ${agentName(agent)}`}
      data-pane={agent.paneId}
      onClick={handleClick}
    >
      <span className={statusClass(agent.status)} />
      <span className="row__main">
        <strong>{agentName(agent)}</strong>
        <span className="muted small">
          {/*
            ⚠️ Un agent fraîchement lancé est détecté par Herdr au bout de
            ~20 secondes. Pendant ce délai `agent` est nul : sans ce message, la
            ligne ressemble à un agent cassé.
          */}
          {agent.agent === null
            ? "démarrage en cours…"
            : `${agentContext(agent)} · ${statusLabel(agent.status)}`}
        </span>
      </span>
    </button>
  );
};
