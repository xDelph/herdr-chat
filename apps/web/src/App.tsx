/**
 * Herdr Chat — interface iPhone.
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
import type { ConversationSummary } from "@herdr-remote/shared";
import type { AgentView, Health, InstalledKind, Overview, TrustRequired } from "./api.ts";
import { ChatScreen } from "./ChatScreen.tsx";
import { BandeauEtat } from "./EtatLecture.tsx";
import { SettingsSheet } from "./SettingsSheet.tsx";
import { FENETRE_DEMARRAGE_MS, etatLecture } from "./etats.ts";
import { ProjectAgentsOf } from "./ProjectDetail.tsx";
import type { LaunchChoice } from "./launch.ts";
import { TrustCard } from "./TrustCard.tsx";
import { parseRoute, routeToHash } from "./routing.ts";
import { groupesDe, ORDRE_LABEL } from "./sections.ts";
import type { Ordre } from "./sections.ts";
import { lireGroupement, retenirGroupement, type Groupement } from "./preferences.ts";
import { ConversationRow } from "./ConversationRow.tsx";
import { SectionTitle } from "./SectionTitle.tsx";
import { ProjectPicker } from "./ProjectPicker.tsx";
import type { Route } from "./routing.ts";
import { Notice } from "./Notice.tsx";
import {
  EVENEMENTS_RAFRAICHISSANTS,
  cadence,
  creeClient,
  creeRegroupement,
  doitAppliquer,
  type Resultat,
} from "./rafraichissement.ts";
import { miseAJourEnAttente } from "./mise-a-jour.ts";
import { BandeauMiseAJour } from "./BandeauMiseAJour.tsx";
import { Chargement } from "./Chargement.tsx";
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
  live: "connected",
  reconnexion: "reconnecting",
  "hors-ligne": "offline",
  inconnu: "unknown status",
};

export const App = () => {
  const [route, navigate] = useHashRoute();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<"live" | "down">("down");
  /** L'instant d'ouverture, posé une seule fois dans un effet. */
  const debutPage = useRef<number | null>(null);

  /*
    La coquille **est** le viewport visuel. Rien à deviner.

    ⚠️ **Ce que ce bloc a fait de mal, deux fois.**

    1. Il prenait la hauteur dans `100dvh`, que WebKit calcule court en mode
       installé — bande blanche en bas de l'écran.
    2. Puis dans `Math.max(window.innerHeight, visualViewport.height)` retenu hors
       saisie. Ce maximum est le défaut : `innerHeight` est la hauteur de **mise
       en page**, qui en mode installé dépasse la zone réellement visible. La
       coquille grandissait donc de la hauteur de la barre d'accueil, et le
       composeur comme le bouton flottant tombaient à moitié sous le bord.

    `visualViewport.height` est la seule valeur dont le **contrat** est « ce qui
    est visible ». Elle tient compte du clavier toute seule, donc la détection
    « clavier ouvert ? » disparaît avec le reste : il n'y avait rien à détecter,
    seulement une valeur à lire.

    ⚠️ Une règle précédente disait « on préfère une coquille trop haute à une trop
    courte ». Elle est fausse : trop haute, le bas est **coupé** — c'est-à-dire
    invisible, donc pire qu'un vide qu'on voit.
  */
  const coquille = useRef({ hauteur: 0, haut: 0 });

  useEffect(() => {
    const viewport = window.visualViewport;

    const applique = (hauteur: number, haut: number): void => {
      if (coquille.current.hauteur === hauteur && coquille.current.haut === haut) return;
      coquille.current = { hauteur, haut };
      document.documentElement.style.setProperty("--app-viewport-height", `${hauteur}px`);
      document.documentElement.style.setProperty("--app-viewport-top", `${haut}px`);
    };

    const syncViewport = () => {
      /*
        ⚠️ `visualViewport` absent (navigateurs anciens) : `innerHeight` est un
        repli, pas une préférence. Et on ne retient rien d'un tour à l'autre —
        retenir, c'est exactement ce qui a produit une coquille trop haute qui ne
        redescendait jamais.
      */
      applique(viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0);
    };

    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    // ⚠️ `focusin`/`focusout` restent écoutés : iOS ne redimensionne pas toujours
    // le viewport visuel de façon fiable au premier instant de la saisie.
    document.addEventListener("focusin", syncViewport);
    document.addEventListener("focusout", syncViewport);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      document.removeEventListener("focusin", syncViewport);
      document.removeEventListener("focusout", syncViewport);
      window.removeEventListener("resize", syncViewport);
      document.documentElement.style.removeProperty("--app-viewport-height");
      document.documentElement.style.removeProperty("--app-viewport-top");
    };
  }, []);

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
   * Le client de données partagé (C23, T059).
   *
   * ⚠️ **Un seul vol pour tous les signaux** : le minuteur, le flux SSE, le
   * retour au premier plan et le resync appellent tous `refresh`, et sans ce
   * client huit signaux simultanés lançaient huit lectures. Il porte aussi la
   * **génération**, qui empêche une réponse lente d'écraser une plus récente,
   * et des **issues séparées** : un health en panne ne jette plus la liste.
   */
  const client = useMemo(
    () =>
      creeClient({
        conversations: fetchConversations,
        health: fetchHealth,
        overview: fetchOverview,
      }),
    [],
  );

  /** La génération déjà appliquée — pour ignorer un résultat plus ancien. */
  const generationAppliquee = useRef(0);

  /** Les trois charges du client, typées par les lectures elles-mêmes. */
  type Charge = Resultat<Overview, Health, { conversations: ReadonlyArray<ConversationSummary> }>;

  const applique = useCallback((resultat: Charge): void => {
    if (!doitAppliquer(resultat, generationAppliquee.current)) return;
    generationAppliquee.current = resultat.generation;
    // ⚠️ **Chaque partie est appliquée pour elle-même** : une lecture qui a
    // échoué n'efface pas les données déjà affichées, et n'empêche pas les
    // deux autres de se mettre à jour. La cause part au journal, pas à l'écran
    // sous forme d'erreur globale.
    if (resultat.overview.ok) {
      setOverview(resultat.overview.valeur);
    } else {
      reportError("failed to load the overview", resultat.overview.cause);
    }
    if (resultat.health.ok) {
      setHealth(resultat.health.valeur);
    }
    if (resultat.conversations.ok) {
      setConversations(resultat.conversations.valeur.conversations);
    } else if (!resultat.overview.ok) {
      // Les DEUX lectures de contenu ont échoué : là seulement, l'écran n'a
      // rien de frais à montrer — le bandeau hors-ligne prend le relais.
      setError(resultat.conversations.cause);
    }
    if (resultat.overview.ok || resultat.conversations.ok || resultat.health.ok) {
      setDernierSucces(Date.now());
      setError(null);
    }
  }, []);

  /** Le flux parle-t-il ? C'est ce qui décide du régime de rafraîchissement. */
  const direct = live === "live";

  const refresh = useCallback(async () => {
    setChargement(true);
    try {
      applique(await client.lit());
    } finally {
      setChargement(false);
    }
  }, [applique, client]);

  useEffect(() => {
    void refresh();
    let timer: number | null = null;

    /*
      ⚠️ **Deux cadences (C26)** : 4 s quand la fenêtre est visible, 60 s sinon.
      Et au RETOUR, on relit immédiatement — un onglet qu'on rouvre ne doit pas
      attendre la cadence pour se remettre à jour.

      ⚠️ **Et deux RÉGIMES.** Quand le flux d'événements est vivant, la cadence
      passe au filet (30 s / 120 s) : ce sont les événements qui amènent la
      fraîcheur. Le minuteur reste pour le cas où le flux se tairait sans le
      dire — un écran figé est pire qu'un peu de trafic.
    */
    const programme = (): void => {
      if (timer !== null) window.clearInterval(timer);
      timer = window.setInterval(
        () => {
          void refresh();
          // L'horloge de la liste suit la veille : sans elle, « il y a 2 min »
          // resterait figé pendant toute la session.
          setMaintenant(Date.now());
        },
        cadence(document.visibilityState === "visible", direct),
      );
    };

    const surVisibilite = (): void => {
      programme();
      if (document.visibilityState === "visible") {
        // `refresh` joint le vol en cours s'il y en a un : aucun doublon.
        void refresh();
        setMaintenant(Date.now());
      }
    };

    programme();
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [direct, refresh]);

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

  useEffect(() => {
    /*
      ⚠️ **Un lot, pas un vol par événement.** Le serveur publie par rafales
      (`agent_status` d'un agent, puis `prompt`, puis `session_changed` dans la
      même seconde). Sans regroupement, chaque événement lançait sa lecture ;
      avec, une rafale vaut **une** vol — le client « un vol à la fois » ne
      suffisait pas, il sérialisait les rafales au lieu de les fondre.

      Le délai est court (150 ms) : il ne retarde rien de perceptible, il
      supprime la répétition.
    */
    const regroupement = creeRegroupement(() => {
      void refresh();
    });

    const fermer = openEventStream({
      // Tous les événements du serveur changent la liste ou ses aperçus ;
      // `resync` a son propre chemin (relecture immédiate, jamais différée).
      onEvent: (kind: string) => {
        if ((EVENEMENTS_RAFRAICHISSANTS as readonly string[]).includes(kind)) {
          regroupement.signale();
        }
      },
      // Continuité rompue côté serveur : on recharge au lieu de croire à un
      // flux continu.
      onResync: () => {
        void refresh();
      },
      onStatus: setLive,
    });

    return () => {
      regroupement.annule();
      fermer();
    };
  }, [refresh]);

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
  /*
    ⚠️ L'âge de la page, tické pendant les premières secondes seulement : après
    la fenêtre de grâce, il n'a plus d'usage et un minuteur de plus serait du
    bruit.
  */
  const [agePage, setAgePage] = useState(0);
  useEffect(() => {
    if (debutPage.current === null) debutPage.current = Date.now();
    if (agePage >= FENETRE_DEMARRAGE_MS) return undefined;
    const debut = debutPage.current;
    const timer = window.setTimeout(() => setAgePage(Date.now() - debut), 500);
    return () => window.clearTimeout(timer);
  }, [agePage]);

  const etat = etatLecture({
    chargement,
    depuisOuverture: agePage,
    erreur: error,
    live: live === "live",
    total,
    dernierSucces,
  });

  const reessayer = useCallback(() => {
    void refresh();
  }, [refresh]);

  /**
   * **Comment** la liste est répartie — réglage de l'utilisateur.
   *
   * ⚠️ **Pourquoi cet état vit ici et pas dans la feuille de réglages**, à la
   * différence du thème et des marques. Ceux-là posent un attribut sur `<html>`
   * et n'ont besoin d'aucun rendu React : la feuille les garde pour elle. Le
   * regroupement décide de la **structure** de la liste, donc l'écran qui la
   * construit doit le connaître et se redessiner. Un réglage que le CSS applique
   * peut vivre dans la feuille ; un réglage qui change l'arbre doit remonter.
   */
  const [groupement, setGroupement] = useState<Groupement>(lireGroupement);

  /** Ordre choisi. Défaut « récent » : le contrat U04. */
  const [ordre, setOrdre] = useState<Ordre>("recent");
  const basculerOrdre = useCallback(() => {
    setOrdre((actuel) => (actuel === "recent" ? "nom" : "recent"));
  }, []);

  /** Nom du projet et libellé d'onglet — absents de `ConversationSummary`. */
  const projetDe = useCallback(
    (workspaceId: string): string =>
      overview?.workspaces.find((workspace) => workspace.workspaceId === workspaceId)?.label ??
      // ⚠️ Libellé **anglais**, comme le reste de l'interface. Il ne s'affiche que
      // si l'aperçu ne connaît pas ce projet — donc au démarrage, ou si le
      // project a disparu entre deux rafraîchissements.
      "Workspace",
    [overview],
  );

  /**
   * Les agents du **même onglet** que celui-ci, dans l'ordre de la disposition.
   *
   * ⚠️ Triés par **rang de disposition**, pas par identifiant : la barre doit
   * présenter les panes dans l'ordre où ils apparaissent sur le Mac — c'est la
   * seule chose qui permette de s'y retrouver entre deux écrans.
   */
  const voisinsDuTab = useCallback(
    (agent: AgentView): ReadonlyArray<AgentView> =>
      agents
        .filter((candidat) => candidat.tabId === agent.tabId)
        .toSorted(
          (a, b) =>
            (a.paneRank ?? Number.MAX_SAFE_INTEGER) - (b.paneRank ?? Number.MAX_SAFE_INTEGER) ||
            a.paneId.localeCompare(b.paneId),
        ),
    [agents],
  );

  /**
   * Liste répartie selon le réglage, dans l'ordre du tableau de règles.
   *
   * ⚠️ **Un seul appel**, quelle que soit la répartition : `groupesDe` décide, et
   * l'écran n'a pas à savoir laquelle des deux fonctions appeler. Sinon le choix
   * se serait trouvé à deux endroits, et en oublier un aurait donné un réglage
   * sans effet.
   *
   * ⚠️ Le calcul vient **après** `projetDe` : c'est lui qui fournit le nom des
   * projets, et le regroupement par projet ne peut pas s'en passer.
   */
  /*
    ⚠️ **La recherche, parce qu'à vingt agents on ne trouve plus rien.** Elle
    filtre sur ce que la ligne affiche déjà — agent, dernier message, modèle,
    nom — donc sans aucune requête supplémentaire : ces champs arrivent avec la
    liste, les réinterroger pour filtrer serait un aller-retour pour rien.
  */
  const [recherche, setRecherche] = useState("");
  const conversationsFiltrees = useMemo(() => {
    const terme = recherche.trim().toLowerCase();
    if (terme.length === 0) return conversations;
    return conversations.filter((conversation) =>
      [conversation.agent, conversation.lastPrompt, conversation.model, conversation.name]
        .filter((champ): champ is string => typeof champ === "string")
        .some((champ) => champ.toLowerCase().includes(terme)),
    );
  }, [conversations, recherche]);

  const sections = useMemo(
    () => groupesDe(conversationsFiltrees, ordre, groupement, projetDe),
    [conversationsFiltrees, ordre, groupement, projetDe],
  );

  /**
   * Le nombre d'agents qui **attendent une action** — le seul chiffre qui
   * mérite d'être visible sans ouvrir l'application.
   *
   * ⚠️ Poussé aussi sur l'icône quand la plateforme le permet (`setAppBadge`) :
   * sur un téléphone, c'est ce qui évite d'ouvrir l'app pour savoir s'il y a
   * quelque chose à faire.
   */
  const aTraiter =
    sections.find((section) => section.cle === "a-traiter")?.conversations.length ?? 0;
  useEffect(() => {
    const badge = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (aTraiter > 0) void badge.setAppBadge?.(aTraiter);
    else void badge.clearAppBadge?.();
  }, [aTraiter]);
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
            reportError("failed to launch an agent", {
              message,
              workspaceId,
              kind,
            });
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
  const selectedConversation =
    route.kind === "agent"
      ? conversations.find((conversation) => conversation.paneId === route.paneId)
      : undefined;

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

  /*
    La question posée par cet agent, lue à l'écran — pas dans la session.

    ⚠️ Elle vient de la **liste**, donc elle suit le même rafraîchissement : dès
    que l'agent reprend, la question disparaît de l'écran sans code de mon côté.
  */
  const questionAffichee =
    agentAffiche === null
      ? undefined
      : conversations.find((ligne) => ligne.paneId === agentAffiche.paneId)?.question;

  /**
   * L'invite de confiance de cet agent, si son écran en porte une.
   *
   * ⚠️ Elle vient de la **liste**, comme la question : elle suit donc le même
   * rafraîchissement, et la carte disparaît d'elle-même dès que l'agent reprend.
   */
  const trustAffiche =
    agentAffiche === null
      ? undefined
      : conversations.find((ligne) => ligne.paneId === agentAffiche.paneId)?.trust;

  /**
   * Ce que l'agent affiche quand il attend, sans question numérotée lisible.
   *
   * ⚠️ **Le cas opencode.** Ses formulaires ont plusieurs champs puis une étape
   * **Review** : cet écran n'a aucun choix numéroté, donc aucune carte de
   * question. L'agent restait `blocked` sans que rien ne dise sur quoi. On
   * affiche l'écran, brut, sans inventer de choix.
   *
   * Elle vient de la **liste** comme la question, et disparaît donc d'elle-même
   * dès que l'agent reprend.
   */
  const attenteAffichee =
    agentAffiche === null
      ? undefined
      : conversations.find((ligne) => ligne.paneId === agentAffiche.paneId)?.waiting;

  if (route.kind === "agent" && agentAffiche !== null) {
    return (
      <div className="app">
        {agentPerime ? (
          <Notice ton="avertissement">
            This agent is no longer visible in Herdr. Showing its last known state.
          </Notice>
        ) : null}
        <ChatScreen
          agent={agentAffiche}
          /*
            ⚠️ Les voisins viennent de **l'overview**, donc des agents tels
            qu'Herdr les décrit — y compris ceux dont la session n'est pas encore
            lisible. La liste des conversations, elle, ne les contient pas tous :
            s'en servir aurait rendu des panes invisibles dans la barre.
          */
          onOuvrirVoisin={onOpenAgent}
          voisins={voisinsDuTab(agentAffiche)}
          currentModel={selectedConversation?.model}
          currentProvider={selectedConversation?.provider}
          currentThinking={selectedConversation?.thinking}
          onBack={closeAgent}
          question={questionAffichee}
          trust={trustAffiche}
          waiting={attenteAffichee}
        />
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
    /*
      ⚠️ **« N'existe plus » ne se dit qu'après avoir REGARDÉ.** Au rechargement
      sur une route d'agent, l'overview n'est pas encore arrivé : l'écran
      annonçait donc la disparition d'un agent parfaitement vivant, pendant toute
      la première lecture. Même règle que le bandeau d'erreur au démarrage : tant
      qu'aucune lecture n'a réussi, on ne sait rien — on attend.
    */
    const saitDeja = dernierSucces !== null || error !== null;
    if (!saitDeja) {
      /*
        ⚠️ **La sortie reste EN PLACE pendant le chargement.** Cet écran rendait
        un simple bandeau de titre : la flèche de retour n'existait pas encore, et
        elle apparaissait ensuite **à une autre position** — on ne pouvait pas
        quitter un écran qui n'avait pas fini de charger, et l'icône « sautait »
        à l'arrivée des données. L'en-tête est donc le même que la conversation,
        avec le même bouton au même endroit.
      */
      return (
        <div className="app">
          <header className="topbar">
            <button type="button" className="back" onClick={closeAgent}>
              ‹ Back
            </button>
            <h1>Herdr Chat</h1>
          </header>
          <Chargement
            detail="Herdr is being read for the first time."
            texte="Loading conversation…"
          />
        </div>
      );
    }
    return (
      <div className="app">
        <header className="topbar">
          <h1>Herdr Chat</h1>
        </header>
        <Notice ton="erreur">This agent no longer exists in Herdr. It may have been closed.</Notice>
        <button type="button" className="back" onClick={closeAgent}>
          ‹ Back
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      {/*
        La mise à jour ne s'applique QUE sur action (C21) : le bandeau explique
        pourquoi elle attend, et n'est présent que si un worker est en attente.
      */}
      {miseAJourEnAttente() ? <BandeauMiseAJour /> : null}
      {/*
        En-tête : le titre, puis l'état de connexion et les réglages.

        ⚠️ Le libellé « temps réel » a disparu au profit d'un **point** (U17).
        Un mot gris qu'il faut lire à chaque fois n'apprend rien ; la couleur
        seule se lit d'un regard, et le libellé reste accessible aux lecteurs
        d'écran par `aria-label`.
      */}
      <header className="topbar">
        <h1>Herdr Chat</h1>
        <div className="topbar__droite">
          {/*
            ⚠️ Le point est **décoratif** : la couleur ne dit rien à un lecteur
            d'écran. Le texte accessible est donc à côté, masqué visuellement
            mais lu — c'est aussi ce qui rend l'information disponible au clavier
            et au survol.
          */}
          {/*
            ⚠️ **La recherche est dans l'en-tête, comme dans toute application
            web.** Elle était un bloc pleine largeur sous l'en-tête : ça coûtait
            une ligne de liste et ça ne ressemblait à rien de connu. Ici elle
            partage l'en-tête avec le titre et les réglages, et n'apparaît
            qu'au-delà de six conversations — en dessous, elle prendrait la place
            du titre pour filtrer trois lignes.
          */}
          {conversations.length > 6 ? (
            <label className="topbar__recherche">
              <span className="sr-only">Search conversations</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="m16 16 4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              <input
                autoComplete="off"
                onChange={(evenement) => setRecherche(evenement.target.value)}
                placeholder="Search"
                type="search"
                value={recherche}
              />
            </label>
          ) : null}
          <span className={`point point--${connexion}`} aria-hidden="true" />
          <span className="sr-only">Herdr {LIBELLE_CONNEXION[connexion]}</span>
          <button
            type="button"
            className="ghost topbar__engrenage"
            aria-label="Settings"
            onClick={ouvrirReglages}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="m19.4 15 .05.05a1.8 1.8 0 0 1-2.55 2.55l-.05-.05a1.8 1.8 0 0 0-3.06 1.27v.14a1.8 1.8 0 0 1-3.6 0v-.08a1.8 1.8 0 0 0-3.06-1.27l-.05.05a1.8 1.8 0 0 1-2.55-2.55l.05-.05A1.8 1.8 0 0 0 3.25 12H3.1a1.8 1.8 0 0 1 0-3.6h.08a1.8 1.8 0 0 0 1.27-3.06l-.05-.05a1.8 1.8 0 0 1 2.55-2.55l.05.05a1.8 1.8 0 0 0 3.06-1.27v-.14a1.8 1.8 0 0 1 3.6 0v.08a1.8 1.8 0 0 0 3.06 1.27l.05-.05a1.8 1.8 0 0 1 2.55 2.55l-.05.05A1.8 1.8 0 0 0 20.55 9h.14a1.8 1.8 0 0 1 0 3.6h-.08A1.8 1.8 0 0 0 19.4 15Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {/*
        ⚠️ **Une seule attente, un seul aspect.** L'écran d'agent montre trois
        points centrés ; la liste affichait une ligne grise en haut. On rend donc
        le MÊME composant ici dès qu'il n'y a rien d'autre à lire — la première
        lecture, et le cas où le parc est encore vide.
      */}
      {etat.phase === "chargement" ? (
        <Chargement detail="Reading Herdr for the first time." texte="Loading…" />
      ) : (
        <BandeauEtat
          etat={etat}
          libelleVide="No conversations in Herdr yet."
          onReessayer={reessayer}
        />
      )}

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
      {route.kind !== "projet" ? (
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
              aria-label={ordre === "nom" ? "Sort by date" : "Sort by name"}
              aria-pressed={ordre === "nom"}
              onClick={basculerOrdre}
              title={ORDRE_LABEL[ordre]}
            >
              <span aria-hidden="true">{ordre === "nom" ? "A→Z" : "⏱"}</span>
            </button>
          </div>
          {sections.map(({ cle, conversations: lignes, titre }) => (
            <section key={cle}>
              <SectionTitle count={lignes.length}>{titre}</SectionTitle>
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
            <p className="muted liste__rien">No agents in Herdr yet.</p>
          ) : null}
        </section>
      ) : null}

      {route.kind === "liste" ? (
        <footer className="app__footer">
          <button type="button" className="fab" onClick={() => setProjetChoisi(true)}>
            + New agent
          </button>
        </footer>
      ) : null}

      {projetChoisi ? (
        <ProjectPicker
          onClose={() => setProjetChoisi(false)}
          onPick={choisirProjet}
          workspaces={overview?.workspaces ?? []}
        />
      ) : null}

      {reglagesOuverts ? (
        <SettingsSheet
          groupement={groupement}
          health={health}
          onClose={fermerReglages}
          onGroupement={(suivant) => {
            retenirGroupement(suivant);
            setGroupement(suivant);
          }}
          sansSession={overview?.withoutSession ?? 0}
        />
      ) : null}
    </div>
  );
};
