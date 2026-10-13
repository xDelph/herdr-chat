/**
 * Herdr Remote — interface iPhone.
 *
 * Quatre onglets : Projets · Agents · Activité · Réglages.
 *
 * Règles d'affichage issues du protocole, pas d'un choix esthétique :
 *
 * - Herdr n'a **pas** de statut `error` : l'erreur vient de l'appel, jamais du
 *   statut. On n'invente donc aucun état (E2 / PROTOCOL.md §2.5).
 * - Un envoi **non confirmé** n'est jamais présenté comme « envoyé » (D007.2).
 * - Un double envoi supprimé est un **état normal**, pas un échec (D007.2).
 * - Ce qui n'est pas exposé par la source est affiché comme absent, jamais
 *   remplacé par un substitut inventé.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAgentKinds,
  reportError,
  TrustRequiredError,
  fetchHealth,
  launchAgent,
  fetchConversations,
  fetchOverview,
  openEventStream,
} from "./api.ts";
import type { AgentView, InstalledKind, Health, Overview, TrustRequired } from "./api.ts";
import { ChatScreen } from "./ChatScreen.tsx";
import { BandeauEtat } from "./EtatLecture.tsx";
import { SettingsSheet } from "./SettingsSheet.tsx";
import type { ConversationSummary } from "@herdr-remote/shared";
import { etatLecture } from "./etats.ts";
import { ProjectAgentsOf } from "./ProjectDetail.tsx";
import type { LaunchChoice } from "./launch.ts";
import { TrustCard } from "./TrustCard.tsx";
import { parseRoute, routeToHash } from "./routing.ts";
import { ORDRE_LABEL, SECTION_LABEL, sectionConversations } from "./sections.ts";
import type { Ordre } from "./sections.ts";
import { ConversationRow } from "./ConversationRow.tsx";
import { SectionTitle } from "./SectionTitle.tsx";
import { ProjectPicker } from "./ProjectPicker.tsx";
import type { Route } from "./routing.ts";
import { Notice } from "./Notice.tsx";
/**
 * Lit le fragment courant et se resynchronise sur les navigations, y compris le
 * bouton retour. L'analyse vit dans `routing.ts`, où elle est testée.
 */
const useHashRoute = (): [Route, (next: Route) => void] => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next);
    if (window.location.hash !== hash) {
      // Passer par l'historique : le bouton retour redevient utile.
      window.location.hash = hash;
    }
    setRoute(next);
  }, []);

  return [route, navigate];
};

/**
 * État de connexion, en trois couleurs.
 *
 * ⚠️ Trois, pas deux : une reconnexion n'est pas une panne. Le flux peut se
 * taire quelques secondes pendant que la lecture fonctionne encore ; l'annoncer
 * en rouge ferait croire à une coupure qui n'existe pas.
 *
 * Le libellé accompagne la couleur, mais **hors de l'écran** : la couleur seule
 * ne dit rien à un lecteur d'écran, et un mot gris qu'il faut lire à chaque
 * ouverture n'apporte rien à l'œil.
 */
export type Connexion = "live" | "reconnexion" | "hors-ligne" | "inconnu";

export const LIBELLE_CONNEXION: Record<Connexion, string> = {
  live: "connecté",
  reconnexion: "en reconnexion",
  "hors-ligne": "hors ligne",
  inconnu: "état inconnu",
};

export const App = () => {
  const [route, navigate] = useHashRoute();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<"live" | "down">("down");

  /**
   * Lignes de la liste, servies par `/api/conversations`.
   *
   * ⚠️ **Une seule requête pour tout ce qu'affiche une ligne** : demande,
   * modèle, branche, horodatage. Les prendre sur `overview` aurait laissé chaque
   * ligne chercher sa session — donc N lectures de fichiers par rafraîchissement.
   */
  const [conversations, setConversations] = useState<ReadonlyArray<ConversationSummary>>([]);
  const [reglagesOuverts, setReglagesOuverts] = useState(false);
  const [launching, setLaunching] = useState<string | null>(null);
  /** Types **réellement installés**, lus depuis Herdr — pas une liste codée. */
  const [kinds, setKinds] = useState<readonly InstalledKind[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);
  /**
   * Invite de confiance en attente de décision.
   *
   * ⚠️ Volontairement **distincte** de `launchError` : un agent bloqué sur
   * « Trust this folder? » n'a pas échoué, il attend. L'afficher comme une
   * erreur rouge serait mentir sur ce qui se passe.
   */
  const [trustRequest, setTrustRequest] = useState<TrustRequired | null>(null);
  /** Une lecture est-elle en cours ? Prévoir le premier rendu, qui n'en est pas. */
  const [chargement, setChargement] = useState(true);
  /** Horodatage de la dernière lecture **réussie**, ou `null` si jamais. */
  const [dernierSucces, setDernierSucces] = useState<number | null>(null);
  /**
   * Horloge de la liste.
   *
   * Distincte de celle du bandeau d'état, qui n'en a plus besoin : une ligne de
   * liste n'est pas une région vivante, donc « il y a 2 min » ne déclenche
   * aucune annonce répétée (U11). Elle suit la cadence de la veille, sinon
   * l'âge affiché resterait figé pendant toute la session.
   */
  const [maintenant, setMaintenant] = useState<number>(() => Date.now());

  /**
   * Dernier état connu de chaque agent.
   *
   * ⚠️ Le snapshot perd brièvement un agent : veilleur qui redémarre, `resync`,
   * Herdr qui repart. `selectedAgent` devenait alors `null` et l'application
   * **sortait de la conversation** — le fil, la position de défilement et le
   * brouillon disparaissaient. Le contrat dit « coupure conserve messages et
   * brouillon » : on garde donc la dernière observation réelle, et on signale
   * qu'elle est périmée.
   *
   * C'est un **état**, pas une référence : React interdit de lire une référence
   * pendant le rendu, et il a raison — la valeur doit déclencher un rendu.
   */
  const [memoire, setMemoire] = useState<ReadonlyMap<string, AgentView>>(() => new Map());

  /**
   * Lectures en vol.
   *
   * Un compteur, pas un booléen : la lecture automatique démarre une nouvelle
   * requête toutes les 4 s, et une réponse lente arrivait après la suivante. Le
   * « chargement » se levait trop tôt, et l'écran clignotait.
   */
  const enCours = useRef(0);
  const refresh = useCallback(async () => {
    enCours.current += 1;
    setChargement(true);
    try {
      const [nextOverview, nextHealth, nextConversations] = await Promise.all([
        fetchOverview(),
        fetchHealth(),
        fetchConversations(),
      ]);
      setOverview(nextOverview);
      setHealth(nextHealth);
      setConversations(nextConversations.conversations);
      setError(null);
      // Horodatage de la **dernière** lecture réussie : c'est ce qui permet de
      // dire l'âge de ce qui est affiché au lieu de supposer qu'il est frais.
      setDernierSucces(Date.now());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      // Journalisé : un bandeau disparaît au rechargement, pas le journal.
      reportError("échec du chargement de la vue d'ensemble", message);
    } finally {
      enCours.current -= 1;
      if (enCours.current === 0) setChargement(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
      // L'horloge de la liste suit la veille : sans elle, « il y a 2 min »
      // resterait figé pendant toute la session.
      setMaintenant(Date.now());
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Une seule lecture : les intégrations installées ne changent pas en cours de
  // session. Un échec laisse la liste vide et désactive le lancement, plutôt que
  // de proposer des agents inexistants.
  useEffect(() => {
    void (async () => {
      try {
        setKinds(await fetchAgentKinds());
      } catch {
        setKinds([]);
      }
    })();
  }, []);

  useEffect(
    () =>
      openEventStream({
        // Un changement d'état d'agent est le signal du **direct** : on
        // rafraîchit la liste, servie depuis le cache du veilleur.
        onEvent: (kind: string) => {
          if (kind === "agent_status") void refresh();
        },
        // Continuité rompue côté serveur : on recharge au lieu de croire à un
        // flux continu.
        onResync: () => {
          void refresh();
        },
        onStatus: setLive,
      }),
    [refresh],
  );

  /**
   * Agents du parc, **stables tant que l'overview ne change pas**.
   *
   * `overview?.agents ?? []` créait un **nouveau tableau vide** à chaque rendu
   * quand l'overview est absent, et une nouvelle référence à chaque rendu sinon
   * dès que le parent se rend. Passé en prop, ce tableau redessinait les
   * écrans — et faisait perdre le défilement au rafraîchissement du snapshot.
   */
  const agents = useMemo(() => overview?.agents ?? [], [overview]);

  /**
   * Mémoire des observations.
   *
   * Alimentée à chaque rafraîchissement réussi : elle sert de filet quand le
   * snapshot perd un agent. Le `resync` et le redémarrage du veilleur en
   * produisent, et pendant ce temps `ChatScreen` reste monté.
   *
   * La carte n'est remplacée que si quelque chose a **vraiment** changé : sinon
   * chaque lecture redéclencherait le rendu de toute la liste.
   */
  useEffect(() => {
    setMemoire((precedent) => {
      if (
        precedent.size === agents.length &&
        agents.every((agent) => precedent.get(agent.paneId) === agent)
      ) {
        return precedent;
      }
      const suivant = new Map(precedent);
      for (const agent of agents) suivant.set(agent.paneId, agent);
      return suivant;
    });
  }, [agents]);

  /**
   * Nombre de lignes que l'onglet courant montre.
   *
   * C'est cette quantité qui décide si l'écran est « vide », pas le nombre
   * d'agents : l'onglet Projets affiche des projets, et trois projets sans
   * agent ne sont pas une liste vide.
   */
  const total = conversations.length;

  /**
   * Un seul état d'affichage, jamais deux.
   *
   * `error` garde son nom : c'est la cause d'échec de la dernière lecture. Ce
   * qui change, c'est ce qu'on en fait — voir `etats.ts`.
   */
  const etat = etatLecture({
    chargement,
    erreur: error,
    live: live === "live",
    total,
    dernierSucces,
  });

  const reessayer = useCallback(() => {
    void refresh();
  }, [refresh]);

  /**
   * Captures servies par le backend.
   *
   * Elles vivent dans `apps/web/public/screenshots`, donc sous le dossier du
   * projet : le service de fichiers les accepte comme n'importe quel fichier de
   * projet, sans route dédiée.
   */
  // Hors du corps du composant : le tableau ne dépend que de `projectRoot`, donc
  // il est identique à chaque rendu. Le reconstruire ici en créait une nouvelle
  // référence et redessinait la galerie entière (react-perf).
  /**
   * Liste par sections, dans l'ordre du tableau de règles.
   *
   * Les sections sont celles de la référence, et elles répondent à la seule
   * question qu'on se pose en ouvrant l'application : **qu'est-ce qui m'attend ?**
   */
  /** Ordre choisi. Défaut « récent » : le contrat U04. */
  const [ordre, setOrdre] = useState<Ordre>("recent");
  const basculerOrdre = useCallback(() => {
    setOrdre((actuel) => (actuel === "recent" ? "nom" : "recent"));
  }, []);

  const sections = useMemo(
    () =>
      sectionConversations(conversations, ordre).map(({ conversations: lignes, section }) => ({
        lignes,
        section,
      })),
    [conversations, ordre],
  );

  /** Nom du projet et libellé d'onglet — absents de `ConversationSummary`. */
  const projetDe = useCallback(
    (workspaceId: string): string =>
      overview?.workspaces.find((workspace) => workspace.workspaceId === workspaceId)?.label ??
      "projet",
    [overview],
  );
  const ongletDe = useCallback(
    (paneId: string): string => {
      const agent = agents.find((candidat) => candidat.paneId === paneId);
      const label = agent?.tabLabel ?? null;
      // Un libellé d'onglet purement numérique est le nom par défaut de Herdr :
      // « – 3 » n'apprend rien, donc on n'affiche rien.
      return label === null || /^\d+$/.test(label.trim()) ? "" : label;
    },
    [agents],
  );

  /**
   * État de la connexion, en trois couleurs.
   *
   * ⚠️ Trois états réels, pas deux : `live` (le flux parle), `reconnexion` (le
   * flux s'est tu mais la lecture marche encore), `hors-ligne` (la dernière
   * lecture a échoué). Un jaune pour la reconnexion évite de crier au rouge
   * pendant une coupure de quelques secondes.
   */
  const connexion: Connexion =
    etat.phase === "erreur" || etat.phase === "hors-ligne"
      ? "hors-ligne"
      : etat.phase === "reconnexion"
        ? "reconnexion"
        : live === "live"
          ? "live"
          : "inconnu";

  const ouvrirReglages = useCallback(() => setReglagesOuverts(true), []);
  const fermerReglages = useCallback(() => setReglagesOuverts(false), []);

  const [projetChoisi, setProjetChoisi] = useState(false);
  const choisirProjet = useCallback(
    (workspaceId: string) => {
      setProjetChoisi(false);
      navigate({ kind: "projet", workspaceId });
    },
    [navigate, setProjetChoisi],
  );

  // Détail d'un projet (U05) : ses conversations, et rien d'autre. Le filtre de
  // la liste globale ne s'applique pas ici — ce sont **toutes** les
  // conversations du projet, sinon un agent masqué par un filtre resterait
  // invisible dans le projet où il se trouve.
  const projectWorkspaceId = route.kind === "projet" ? route.workspaceId : "";
  /**
   * Conversations du projet — **comparaison explicite**, pas `useMemo`.
   *
   * Les deux règles du lint se contredisent si on se contente de mémoïser :
   * `exhaustive-deps` veut `agents` en dépendance (donc nouvelle référence à
   * chaque rafraîchissement), et `jsx-no-new-array-as-prop` veut une prop
   * stable. On les applique donc à la main, et c'est `useStable` qui décide.
   */
  const projectWorkspace = (overview?.workspaces ?? []).find(
    (workspace) => workspace.workspaceId === projectWorkspaceId,
  );
  const onBackToProjects = useCallback(() => navigate({ kind: "liste" }), [navigate]);

  // Wrapper synchrone : `onClick` attend un retour `void`.
  const onLaunchAgent = useCallback(
    (workspaceId: string, kind: string, choice: LaunchChoice) => {
      void (async () => {
        setLaunching(workspaceId);
        setLaunchError(null);
        setTrustRequest(null);
        try {
          const started = await launchAgent(workspaceId, kind, choice);
          // Le projet a maintenant un agent : on ouvre sa conversation.
          navigate({ kind: "agent", paneId: started.paneId });
          await refresh();
        } catch (cause: unknown) {
          // L'invite de confiance a son propre affichage : elle n'est pas une erreur.
          if (cause instanceof TrustRequiredError) {
            setTrustRequest(cause.request);
          } else {
            const message = cause instanceof Error ? cause.message : String(cause);
            setLaunchError(message);
            reportError("échec du lancement d'agent", { message, workspaceId, kind });
          }
        } finally {
          setLaunching(null);
        }
      })();
    },
    [navigate, refresh],
  );

  const closeAgent = useCallback(() => navigate({ kind: "liste" }), [navigate]);

  const openAgent = useCallback(
    (agent: AgentView) => {
      // ⚠️ Naviguer **est** l'ouverture : le rendu se fonde sur la route. Mettre
      // à jour un état local sans toucher à la route ne faisait rien du tout.
      navigate({ kind: "agent", paneId: agent.paneId });
    },
    [navigate],
  );

  const onOpenAgent = useCallback(
    (paneId: string) => {
      const agent = (overview?.agents ?? []).find((candidate) => candidate.paneId === paneId);
      if (agent !== undefined) openAgent(agent);
    },
    [openAgent, overview],
  );

  // L'agent affiché est **dérivé de la route** : après un rafraîchissement, le
  // fragment `#/agent/<paneId>` rouvre le même agent.
  const selectedAgent =
    route.kind === "agent" ? (agents.find((a) => a.paneId === route.paneId) ?? null) : null;

  /**
   * Repli sur la dernière observation, le temps que l'agent revienne.
   *
   * `ChatScreen` n'est jamais démonté pendant une coupure : ses messages, sa
   * position de défilement et son brouillon restent en mémoire. Le bandeau dit
   * que l'affichage est périmé — on ne prétend pas que ce qui est à l'écran
   * vient d'arriver.
   */
  const agentMemorise = route.kind === "agent" ? (memoire.get(route.paneId) ?? null) : null;
  const agentAffiche = selectedAgent ?? agentMemorise;
  const agentPerime = selectedAgent === null && agentMemorise !== null;

  if (route.kind === "agent" && agentAffiche !== null) {
    return (
      <div className="app">
        {agentPerime ? (
          <Notice ton="avertissement">
            Cet agent n'apparaît plus dans Herdr. Ce qui suit est le dernier état connu.
          </Notice>
        ) : null}
        <ChatScreen agent={agentAffiche} onBack={closeAgent} />
      </div>
    );
  }

  /**
   * La route pointe un agent **jamais** vu.
   *
   * Avant, l'application retombait silencieusement sur les onglets : le
   * fragment disait « agent », l'écran disait « liste ». Rien ne signalait la
   * perte, et l'utilisateur ne comprenait pas ce qui s'était passé.
   */
  if (route.kind === "agent") {
    return (
      <div className="app">
        <header className="topbar">
          <h1>Herdr Remote</h1>
        </header>
        <Notice ton="erreur">Cet agent n'existe plus dans Herdr. Il a peut-être été fermé.</Notice>
        <button type="button" className="back" onClick={closeAgent}>
          ‹ Retour
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      {/*
        En-tête : le titre, puis l'état de connexion et les réglages.

        ⚠️ Le libellé « temps réel » a disparu au profit d'un **point** (U17).
        Un mot gris qu'il faut lire à chaque fois n'apprend rien ; la couleur
        seule se lit d'un regard, et le libellé reste accessible aux lecteurs
        d'écran par `aria-label`.
      */}
      <header className="topbar">
        <h1>Herdr Remote</h1>
        <div className="topbar__droite">
          {/*
            ⚠️ Le point est **décoratif** : la couleur ne dit rien à un lecteur
            d'écran. Le texte accessible est donc à côté, masqué visuellement
            mais lu — c'est aussi ce qui rend l'information disponible au clavier
            et au survol.
          */}
          <span className={`point point--${connexion}`} aria-hidden="true" />
          <span className="sr-only">Herdr {LIBELLE_CONNEXION[connexion]}</span>
          <button
            type="button"
            className="ghost topbar__engrenage"
            aria-label="Réglages"
            onClick={ouvrirReglages}
          >
            ⚙
          </button>
        </div>
      </header>

      <BandeauEtat
        etat={etat}
        libelleVide="Aucune conversation dans Herdr pour l'instant."
        onReessayer={reessayer}
      />

      {/*
        Invite de confiance : **globale**, au-dessus de tout.
        Elle peut naître d'un lancement fait depuis n'importe quel écran, et un
        agent bloqué sur une question doit la poser où qu'on soit. La renvoyer
        dans un onglet la rendrait invisible depuis le détail d'un projet.
      */}
      {trustRequest !== null ? (
        <TrustCard request={trustRequest} onDone={() => setTrustRequest(null)} />
      ) : null}
      {launchError !== null ? <Notice ton="erreur">{launchError}</Notice> : null}

      {/*
        Détail d'un projet : la seule destination hors liste. Il porte
        « Nouvel agent », donc c'est le chemin de lancement — le bouton flottant
        y mène par le choix du projet.
      */}
      {route.kind === "projet" ? (
        <ProjectAgentsOf
          agents={agents}
          back={onBackToProjects}
          kinds={kinds}
          launching={launching === route.workspaceId}
          onLaunch={onLaunchAgent}
          onOpenAgent={onOpenAgent}
          workspace={projectWorkspace}
          workspaceId={projectWorkspaceId}
        />
      ) : null}

      {/*
        La liste, sans onglets ni filtres.

        ⚠️ Les onglets sont partis : « Projets » n'était qu'un détour vers le
        détail d'un projet, atteignable depuis le bouton flottant, et
        « Réglages » est passé derrière l'engrenage. Trois onglets pour deux
        écrans réels coûtaient un geste à chaque ouverture.
      */}
      <section className="screen screen--liste">
        {/*
          Un **basculement**, pas une liste déroulante : deux états, un seul
          geste, et la place d'une icône. Une liste déroulante pour deux choix
          coûtait une ligne entière et deux gestes.

          ⚠️ Le défaut reste « récent » : à l'ouverture on veut voir ce qui vient
          de bouger. « Par nom » sert à retrouver une conversation précise.
        */}
        <div className="ordre">
          <button
            type="button"
            className="ordre__bascule"
            aria-pressed={ordre === "nom"}
            onClick={basculerOrdre}
            title={ORDRE_LABEL[ordre]}
          >
            <span aria-hidden="true">{ordre === "nom" ? "A→Z" : "⏱"}</span>
            <span className="visually-hidden">
              {ordre === "nom"
                ? "Trié par nom, appuyer pour trier par date"
                : "Trié par date, appuyer pour trier par nom"}
            </span>
          </button>
        </div>
        {sections.map(({ lignes, section }) => (
          <section key={section}>
            <SectionTitle count={lignes.length}>{SECTION_LABEL[section]}</SectionTitle>
            {lignes.map((conversation) => (
              <ConversationRow
                conversation={conversation}
                key={conversation.paneId}
                maintenant={maintenant}
                onglet={ongletDe(conversation.paneId)}
                onOpen={onOpenAgent}
                projet={projetDe(conversation.workspaceId)}
              />
            ))}
          </section>
        ))}
        {conversations.length === 0 && etat.phase === "pret" ? (
          <p className="muted liste__rien">Aucun agent dans Herdr pour l'instant.</p>
        ) : null}
      </section>

      <button
        type="button"
        className="fab"
        disabled={conversations.length === 0}
        onClick={() => setProjetChoisi(true)}
      >
        + Nouvel agent
      </button>

      {projetChoisi ? (
        <ProjectPicker
          onClose={() => setProjetChoisi(false)}
          onPick={choisirProjet}
          workspaces={overview?.workspaces ?? []}
        />
      ) : null}

      {reglagesOuverts ? (
        <SettingsSheet
          health={health}
          onClose={fermerReglages}
          sansSession={overview?.withoutSession ?? 0}
        />
      ) : null}
    </div>
  );
};
