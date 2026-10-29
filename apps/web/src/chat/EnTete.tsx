/**
 * L'en-tête de conversation : retour, titre, projet · modèle · réflexion, état,
 * et le menu.
 *
 * ⚠️ **« Afficher sur le Mac » est dans le menu, et nulle part ailleurs.** Lire
 * ne touche pas au Mac (`lectures.ts`) ; poser le focus sur le pane est un geste
 * explicite, avec son issue affichée.
 */
import { memo, useEffect, useId, useRef, useState } from "react";
import type { AgentStatus, AgentView, BackgroundTaskCount } from "@herdr-remote/shared";
import { etiquetteDePane } from "@herdr-remote/shared";
import type { Transport } from "../flux-session.ts";
import { libelleReflexion } from "../libelles.ts";
import { routeToHash } from "../routing.ts";
import { FormeEtat, Marque, Pastille } from "../ui/atomes.tsx";
import { Icone } from "../ui/Icone.tsx";
import { PuceTaches } from "./PuceTaches.tsx";

const TRANSPORT: Record<Transport, string> = {
  aucun: "Contenu : pas de lecture en cours",
  flux: "Contenu : flux en direct",
  repli: "Contenu : relecture sur signal",
};

export const EnTete = memo(
  ({
    titre,
    projet,
    kind,
    modele,
    reflexion,
    status,
    transport,
    causeRepli = null,
    inactif = false,
    compteFichiers,
    tachesDeFond,
    onTaches,
    onRetour,
    onMac,
    onModele,
    onFichiers,
  }: {
    readonly titre: string;
    readonly projet: string;
    readonly kind: string | null;
    readonly modele: string | undefined;
    readonly reflexion: string | undefined;
    readonly status: AgentStatus;
    readonly transport: Transport;
    /** Pourquoi ce pane est en repli — dite telle quelle, jamais devinée. */
    readonly causeRepli?: string | null;
    /** Le pane n'existe plus : les gestes qui lui écrivent sont désactivés. */
    readonly inactif?: boolean;
    /** Le nombre de fichiers modifiés — appelé seulement menu ouvert. */
    readonly compteFichiers: () => number;
    /** Le décompte des tâches de fond (puce « 2 tâches de fond »), s'il existe. */
    readonly tachesDeFond?: BackgroundTaskCount | undefined;
    readonly onTaches?: (() => void) | undefined;
    readonly onRetour: () => void;
    readonly onMac: () => void;
    readonly onModele: () => void;
    readonly onFichiers: () => void;
  }) => {
    const [menu, setMenu] = useState(false);
    const zone = useRef<HTMLDivElement | null>(null);
    const idMenu = useId();
    const nombreFichiers = menu ? compteFichiers() : 0;

    useEffect(() => {
      if (!menu) return undefined;
      const dehors = (evenement: PointerEvent) => {
        const cible = evenement.target;
        if (zone.current !== null && cible instanceof Node && !zone.current.contains(cible)) {
          setMenu(false);
        }
      };
      const echap = (evenement: KeyboardEvent) => {
        if (evenement.key === "Escape") setMenu(false);
      };
      document.addEventListener("pointerdown", dehors);
      document.addEventListener("keydown", echap);
      return () => {
        document.removeEventListener("pointerdown", dehors);
        document.removeEventListener("keydown", echap);
      };
    }, [menu]);

    const choisit = (action: () => void) => () => {
      setMenu(false);
      action();
    };

    const reglages = [
      // Le projet n'est répété que s'il n'est pas déjà le titre.
      titre === projet ? undefined : projet,
      modele,
      reflexion === undefined ? undefined : libelleReflexion(reflexion),
    ].filter((morceau): morceau is string => morceau !== undefined && morceau.length > 0);

    return (
      <header className="tete">
        <button
          type="button"
          className="bouton-icone retour"
          aria-label="Retour aux agents"
          onClick={onRetour}
        >
          <Icone nom="back" />
        </button>
        <div className="tete__titre">
          <strong>{titre}</strong>
          <span>
            <Marque kind={kind} petite />
            {reglages.join(" · ")}
          </span>
        </div>
        {onTaches === undefined ? null : <PuceTaches compte={tachesDeFond} onOuvrir={onTaches} />}
        <Pastille status={status} />
        <div className="menu" ref={zone}>
          {/*
            ⚠️ Une liste de boutons, pas un `role="menu"` : ce rôle promet la
            navigation aux flèches, que ce petit menu n'offrait pas. Tab suffit.
          */}
          <button
            type="button"
            className="bouton-icone"
            aria-label="Plus d'actions"
            aria-controls={menu ? idMenu : undefined}
            aria-expanded={menu}
            onClick={() => setMenu((valeur) => !valeur)}
          >
            <Icone nom="more" />
          </button>
          {menu ? (
            <div className="menu__liste" id={idMenu}>
              <button type="button" onClick={choisit(onMac)} disabled={inactif}>
                <Icone nom="mac" petite />
                Afficher sur le Mac
              </button>
              <button type="button" onClick={choisit(onModele)} disabled={inactif}>
                <Icone nom="sliders" petite />
                Modèle et réflexion…
              </button>
              <button type="button" onClick={choisit(onFichiers)} disabled={nombreFichiers === 0}>
                <Icone nom="file" petite />
                Fichiers modifiés ({String(nombreFichiers)})
              </button>
              <p className="menu__info">
                {TRANSPORT[transport]}
                {transport === "repli" && causeRepli !== null ? ` (${causeRepli})` : ""}
              </p>
            </div>
          ) : null}
        </div>
      </header>
    );
  },
);
EnTete.displayName = "EnTete";

/** Les autres agents du même onglet Herdr — un geste pour passer de l'un à l'autre. */
export const Voisins = memo(
  ({
    agents,
    courant,
  }: {
    readonly agents: ReadonlyArray<AgentView>;
    readonly courant: string;
  }) => {
    if (agents.length < 2) return null;
    return (
      <nav className="voisins" aria-label="Agents de cet onglet">
        {agents.map((agent) => {
          const libelle =
            etiquetteDePane(agent) ??
            agent.name ??
            (agent.paneRank === null ? agent.paneId : `pane ${String(agent.paneRank)}`);
          return (
            <a
              key={agent.paneId}
              className="voisin"
              href={routeToHash({ kind: "agent", paneId: agent.paneId })}
              aria-current={agent.paneId === courant ? "page" : undefined}
            >
              <Marque kind={agent.agent} petite />
              <span
                className={`etat etat--${agent.status === "working" ? "work" : agent.status === "blocked" ? "attn" : "idle"}`}
              >
                <FormeEtat status={agent.status} />
              </span>
              {libelle}
            </a>
          );
        })}
      </nav>
    );
  },
);
Voisins.displayName = "Voisins";
