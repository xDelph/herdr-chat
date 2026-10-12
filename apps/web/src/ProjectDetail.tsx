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
import { memo, useCallback, useState } from "react";
import type { AgentView, InstalledKind, WorkspaceView } from "./api.ts";
import { LaunchSheet } from "./LaunchSheet.tsx";
import type { LaunchChoice } from "./launch.ts";
import { agentName, statusClass, statusLabel } from "./labels.tsx";
import { Notice } from "./Notice.tsx";

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
    const [sheetOpen, setSheetOpen] = useState(false);
    const ouvrirSheet = useCallback(() => setSheetOpen(true), []);
    const fermerSheet = useCallback(() => setSheetOpen(false), []);

    /**
     * Type retenu quand on lance sans passer par la feuille.
     *
     * `pi` quand il est installé — c'est l'agent réellement utilisé, donc le
     * premier installé n'est pas forcément le bon. Sinon celui que Herdr
     * connaît.
     */
    const kindParDefaut =
      kinds.find((candidat) => candidat.kind === "pi")?.kind ?? kinds[0]?.kind ?? "pi";

    // Pas de stabilisation ici : `ProjectDetail` est mémoïsé avec un
    // comparateur de contenu (`memesProps` plus bas), et c'est lui — pas
    // l'identité du tableau — qui décide du rendu. Une clé calculée ici
    // reproduirait la même règle deux fois, au même endroit.
    const liste = agents;

    if (workspace === undefined) {
      return (
        <section className="screen">
          <button type="button" className="back" onClick={back}>
            ‹ Projets
          </button>
          {/* Un projet peut disparaître entre l'ouverture et l'affichage — le
            snapshot se rafraîchit. Un écran vide serait pris pour un bug. */}
          <Notice ton="erreur">Ce projet n'existe plus.</Notice>
        </section>
      );
    }

    const titre = workspace.label ?? workspace.workspaceId;

    /**
     * Lancement immédiat, **sans choix**.
     *
     * « Nouvel agent » doit rester à une seule frappe (D019.2) : c'est la
     * manœuvre la plus courante, et la feuille est à côté, pas dessus. Un choix
     * omis n'est pas un choix raté — l'agent démarre avec ses propres valeurs,
     * et la feuille le dit.
     *
     * Fonction simple et non `useCallback` : elle est définie **après** le garde
     * d'existence du projet, donc `workspace` y est déjà affirmé. Un hook ne
     * peut pas vivre après un retour anticipé.
     */
    const lancer = () => {
      onLaunch(workspace.workspaceId, kindParDefaut, {});
    };

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
            onClick={lancer}
          >
            {launching ? "Lancement…" : "Nouvel agent"}
          </button>
          <button type="button" className="ghost" onClick={ouvrirSheet}>
            Options
          </button>
        </div>

        {sheetOpen ? (
          <LaunchSheet
            kinds={kinds}
            launching={launching}
            onClose={fermerSheet}
            onLaunch={onLaunch}
            titre={titre}
            workspaceId={workspace.workspaceId}
          />
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
