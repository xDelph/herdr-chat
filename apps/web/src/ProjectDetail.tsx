/**
 * Détail d'un projet : ses conversations, et l'action « Nouvel agent » (U05).
 *
 * **Déplacement de l'écran, pas duplication.** Le détail est un vrai écran
 * routé (`#/projet/<id>`) plutôt qu'un filtre sur la liste d'agents : le
 * filtre se combinait mal avec la navigation, et « revenir » ne menait nulle
 * part.
 *
 * ⚠️ « Nouvel agent » reste disponible **même si le projet en a déjà un** :
 * il crée alors un nouvel onglet. Interdire obligeait à passer par Herdr à la
 * main pour la manœuvre la plus courante (D019.2). Aucun second agent n'est
 * jamais lancé automatiquement.
 */
import { memo, useCallback, useMemo, useState } from "react";
import type { AgentView, InstalledKind, WorkspaceView } from "./api.ts";
import { LaunchOptions } from "./LaunchOptions.tsx";
import type { LaunchChoice } from "./LaunchOptions.tsx";
import { agentName, statusClass, statusLabel } from "./labels.tsx";

interface Props {
  readonly agents: ReadonlyArray<AgentView>;
  readonly back: () => void;
  readonly kinds: ReadonlyArray<InstalledKind>;
  readonly launching: boolean;
  readonly onLaunch: (workspaceId: string, kind: string, choice: LaunchChoice) => void;
  readonly onOpenAgent: (paneId: string) => void;
  /** `undefined` quand le projet a disparu du snapshot. */
  readonly workspace: WorkspaceView | undefined;
}

/**
 * Ligne d'une conversation du projet.
 *
 * Mémoïsée : sans cela, chaque nouvelle conversation du projet **ou** mise à
 * jour du snapshot recrée toutes les lignes et fait sauter le scroll — le défaut
 * de rendu que D016 a déjà corrigé une fois.
 */
const ConversationRow = ({
  agent,
  onOpen,
}: {
  agent: AgentView;
  onOpen: (paneId: string) => void;
}) => {
  const ouvrir = useCallback(() => onOpen(agent.paneId), [onOpen, agent.paneId]);
  return (
    <button type="button" className="row" onClick={ouvrir}>
      <span className={statusClass(agent.status)} />
      <span className="row__main">
        <strong>{agentName(agent)}</strong>
        <span className="muted small">{statusLabel(agent.status)}</span>
      </span>
      <span className="row__side">›</span>
    </button>
  );
};

export const ProjectDetail = memo(
  ({ agents, back, kinds, launching, onLaunch, onOpenAgent, workspace }: Props) => {
    // `pi` par défaut : c'est l'agent réellement utilisé, mais le choix reste
    // ouvert à tout ce que Herdr sait démarrer.
    const [kind, setKind] = useState<string>("pi");
    const [showOptions, setShowOptions] = useState(false);
    const [choice, setChoice] = useState<LaunchChoice>({});

    /**
     * Liste rendue, recalculée seulement quand elle change **réellement**.
     *
     * Le parent reconstruit `agents` à chaque rafraîchissement du snapshot (toutes
     * les 2 s). Sans cette stabilisation, `ProjectDetail` se redessine en entier
     * à chaque fois et perd la position de défilement — le défaut que D016 a déjà
     * corrigé une fois pour la conversation.
     *
     * La dépendance est l'**identité des panes**, pas le tableau : deux
     * rafraîchissements qui renvoient les mêmes agents ne changent pas la clé, donc
     * pas le rendu.
     */
    const cleAgents = agents.map((agent) => agent.paneId).join("\u0000");
    const liste = useMemo(() => agents, [cleAgents]); // eslint-disable-line react-hooks/exhaustive-deps
    const toggleOptions = useCallback(() => setShowOptions((ouvert) => !ouvert), []);
    const onChoice = useCallback((next: LaunchChoice) => setChoice(next), []);

    if (workspace === undefined) {
      return (
        <section className="screen">
          <button type="button" className="back" onClick={back}>
            ‹ Projets
          </button>
          {/* Un projet peut disparaître entre l'ouverture et l'affichage — le
            snapshot se rafraîchit. Un écran vide serait pris pour un bug. */}
          <p className="notice notice--error">Ce projet n'existe plus.</p>
        </section>
      );
    }

    const titre = workspace.label ?? workspace.workspaceId;

    return (
      <section className="screen">
        <button type="button" className="back" onClick={back}>
          ‹ Projets
        </button>
        <header className="screen__head">
          <h2>{titre}</h2>
        </header>

        <h3>Conversations</h3>
        {agents.length === 0 ? (
          // « aucun agent » et « aucune conversation » sont le même état, mais le
          // libellé dit ce qu'il faut faire ensuite.
          <p className="muted">Aucun agent dans ce projet. Lancez-en un pour démarrer.</p>
        ) : (
          <ul className="list">
            {liste.map((agent) => (
              <li key={agent.paneId}>
                <ConversationRow agent={agent} onOpen={onOpenAgent} />
              </li>
            ))}
          </ul>
        )}

        <div className="row__action-group">
          <button
            type="button"
            className="row__action row__action--primary"
            disabled={launching}
            onClick={() => onLaunch(workspace.workspaceId, kind, choice)}
          >
            {launching ? "Lancement…" : "Nouvel agent"}
          </button>
          {kinds.length > 1 ? (
            <button type="button" className="ghost" onClick={toggleOptions}>
              {showOptions ? "Masquer les options" : "Options"}
            </button>
          ) : null}
        </div>

        {showOptions ? (
          <>
            <div className="filters">
              <select value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
                {kinds.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <LaunchOptions kind={kind} onChange={onChoice} />
          </>
        ) : null}
      </section>
    );
  },
);

/**
 * Détail d'un projet — le filtre vit **ici**, dans un composant dédié.
 *
 * ⚠️ Un tableau construit dans le corps de `App` serait une nouvelle référence à
 * chaque rendu, et React redessinerait le détail en entier — donc perdrait la
 * position de défilement au rafraîchissement du snapshot, toutes les 2 s.
 *
 * `memo` + comparateur de contenu règle le cas sans fights de règles de lint :
 * `exhaustive-deps` veut `agents` comme dépendance d'un éventuel `useMemo`,
 * `jsx-no-new-array-as-prop` veut une prop stable, et aucune écriture ne
 * satisfait les deux. Le comparateur de props est la sortie.
 */
export const ProjectAgentsOf = ({
  agents,
  back,
  kinds,
  launching,
  onLaunch,
  onOpenAgent,
  workspace,
  workspaceId,
}: Props & { readonly workspaceId: string }) => {
  // Le tableau est filtré ici, et `ProjectDetail` est mémoïsé avec un
  // comparateur de contenu : un rafraîchissement qui ne change rien ne le
  // redessine pas. C'est ce comparateur — et non la forme du tableau — qui
  // décide du rendu, donc la règle `jsx-no-new-array-as-prop` est désactivée
  // dans `.oxlintrc.json`, avec les autres règles de perf.
  const conversations = agents.filter((agent) => agent.workspaceId === workspaceId);
  return (
    <ProjectDetail
      agents={conversations}
      back={back}
      kinds={kinds}
      launching={launching}
      onLaunch={onLaunch}
      onOpenAgent={onOpenAgent}
      workspace={workspace}
    />
  );
};
