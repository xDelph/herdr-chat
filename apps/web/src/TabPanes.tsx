/**
 * Les panes d'un **même onglet** — la barre qui permet de passer de l'un à
 * l'autre.
 *
 * ⚠️ **Pourquoi elle existe.** Sur le Mac, un onglet peut être découpé en
 * plusieurs panes, chacun avec son agent : un principal et cinq vérificateurs,
 * par exemple. Sur un téléphone il n'y a pas de terminal, donc sans cette barre
 * le seul moyen d'aller d'un pane à l'autre est de revenir à la liste et d'y
 * retrouver le voisin — au milieu de tous les autres agents.
 *
 * ⚠️ **Chaque pane est un agent distinct, pas une vue du même.** Ils ont chacun
 * leur session, leur état et leurs questions. La barre ne fusionne donc rien :
 * elle rend seulement le **voisinage** visible et atteignable.
 *
 * ⚠️ **Rien n'est affiché quand l'agent est seul dans son onglet** — le cas
 * ordinaire. Une barre à une seule pastille n'apprendrait rien et prendrait
 * 44 px de hauteur sur chaque conversation.
 */
import type { AgentView } from "@herdr-remote/shared";
import { etiquetteDePane } from "@herdr-remote/shared";
import { AgentBadge } from "./AgentBadge.tsx";
import { statusClass } from "./labels.tsx";

/** Libellé court d'une pastille : le nom s'il existe, sinon le rang. */
const libelleCourt = (agent: AgentView): string =>
  agent.name ?? (agent.paneRank === null ? "" : String(agent.paneRank));

export const TabPanes = ({
  agents,
  courant,
  onOpen,
}: {
  /** Les agents du même onglet, **dans l'ordre de la disposition**. */
  readonly agents: ReadonlyArray<AgentView>;
  readonly courant: string;
  readonly onOpen: (paneId: string) => void;
}) => {
  if (agents.length < 2) return null;
  return (
    <nav className="panes" aria-label="Agents in this tab">
      {agents.map((agent) => {
        const actif = agent.paneId === courant;
        /* Le nom long (« multiplex-pi ») est coupé par le CSS : la marque dit
           de quel agent il s'agit, la pastille dit lequel est actif. */
        const court = libelleCourt(agent);
        return (
          <button
            aria-current={actif ? "true" : undefined}
            className="panes__pane"
            key={agent.paneId}
            onClick={() => {
              if (!actif) onOpen(agent.paneId);
            }}
            /*
              ⚠️ Le titre porte le libellé **long** : la pastille est tronquée à
              l'écran, et c'est le seul endroit où le nom complet reste lisible.
            */
            title={etiquetteDePane(agent) ?? agent.title ?? agent.paneId}
            type="button"
          >
            <AgentBadge kind={agent.agent} />
            <span className={statusClass(agent.status)} aria-hidden="true" />
            {court.length > 0 ? <span className="panes__nom">{court}</span> : null}
          </button>
        );
      })}
    </nav>
  );
};
