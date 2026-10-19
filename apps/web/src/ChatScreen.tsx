/**
 * Écran Chat — une conversation, son historique et son composeur.
 *
 * **Déplacement seul (A02)** — aucun changement de rendu, vérifié par les tests
 * et par le typecheck. Ce module regroupait déjà tout l'état d'une
 * conversation ; il était écrit au milieu de la navigation, dans un fichier de
 * plus de 1100 lignes.
 *
 * ⚠️ Le composeur est **hors** du conteneur défilant. Sinon tout l'écran
 * défile, composeur compris, et le clavier iOS se bat avec le défilement
 * (D016.2).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ecritPosition,
  hauteurDeReprise,
  litPosition,
  positionAffichee,
  stockageNavigateur,
} from "./memoire-defilement.ts";
import { decideAffichage, gardeLeFilMalgréErreur, mentionLecturePartielle } from "./session-vue.ts";
import {
  SEUIL_PREMIERES_LIGNES_PX,
  ancrage,
  doitChargerPlusTot,
  positionApresPrepend,
  suitLeBas,
} from "./defilement.ts";
import type { AgentView, AnswerResult, SessionEntry } from "./api.ts";
import { estOptionSaisieLibre } from "@herdr-remote/shared";
import {
  answerQuestion,
  fetchSession,
  sendPrompt,
  stopAgent,
  reportError,
  focusAgent,
} from "./api.ts";
import type { Question } from "@herdr-remote/shared";
import { ecrireBrouillon, lireBrouillon } from "./brouillons.ts";
import type { RenderedMessage } from "./blocks.ts";
import { avecTravailEnCours, toItems, toMessages, touchedFilesOf } from "./blocks.ts";
import { marqueEnvoisEnCours } from "./envois-en-cours.ts";
import { creeMagasinEnvois, planificateurReel, type Envoi as EnvoiMagasin } from "./envois.ts";
import { fusionnerEntrees } from "./messages.ts";
import { agentName, headerContext, headerReglages, statusClass } from "./labels.tsx";
import { TabPanes } from "./TabPanes.tsx";
import { TrustCard } from "./TrustCard.tsx";
import type { TrustRequired } from "./api.ts";
import { FileOpenerContext, ItemsView, UrlOpenerContext } from "./Blocks.tsx";
import { FilesSheet } from "./Files.tsx";
import { ModelSheet } from "./ModelSheet.tsx";
import { FileViewer } from "./Viewer.tsx";
import { Notice } from "./Notice.tsx";

export const ChatScreen = ({
  agent,
  currentModel,
  currentProvider,
  currentThinking,
  onBack,
  question,
  trust,
  waiting,
  voisins,
  onOuvrirVoisin,
}: {
  agent: AgentView;
  /** Les agents du **même onglet**, pour la barre de navigation. */
  voisins: ReadonlyArray<AgentView>;
  onOuvrirVoisin: (paneId: string) => void;
  currentModel: string | undefined;
  currentProvider: string | undefined;
  currentThinking: string | undefined;
  onBack: () => void;
  /** Question posée à l'écran, quand l'agent en attend une. */
  question?: Question | undefined;
  /**
   * Invite de confiance à l'écran.
   *
   * ⚠️ **Distincte de la question, et pas par commodité** : une invite de
   * confiance n'a pas toujours de choix numérotés (claude présente une
   * sélection), donc elle ne peut pas passer par le chemin de réponse d'une
   * question. La carte est celle du lancement — une seule carte, une seule
   * route, une seule décision.
   */
  trust?: TrustRequired | undefined;
  /**
   * Ce que l'agent affiche quand il attend, mais qu'aucune question numérotée
   * n'a pu être lue.
   *
   * ⚠️ **Distinct de `question`, et pas par commodité.** opencode pose ses
   * questions en formulaires à plusieurs champs, puis passe par une étape
   * **Review** qui n'a aucun choix numéroté : il n'y a rien à cliquer, mais
   * l'agent attend quand même. Sans ce champ, l'écran était **muet** sur un
   * agent bloqué — et l'utilisateur sans recours.
   *
   * ⚠️ C'est l'écran **brut**. Aucun choix n'est fabriqué à partir de lui.
   */
  waiting?: string | undefined;
}) => {
  const [entries, setEntries] = useState<readonly SessionEntry[]>([]);
  /**
   * Messages déjà analysés.
   *
   * ⚠️ Analyser **toute** la conversation à chaque rafraîchissement coûtait un
   * `JSON.parse` et un décodage par entrée, toutes les 2 s. En incrémental, on
   * n'analyse que ce qui arrive.
   */
  const [messages, setMessages] = useState<readonly RenderedMessage[]>([]);
  const [previousCursor, setPreviousCursor] = useState<string | null>(null);
  const [loadingPrevious, setLoadingPrevious] = useState(false);
  const [previousError, setPreviousError] = useState<string | null>(null);
  /**
   * Le fil affiché est **incomplet** : une lecture a échoué ou n'a rien rendu
   * alors qu'on avait des messages. Distinct d'une erreur : le fil reste lisible.
   */
  const [lecturePartielle, setLecturePartielle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Phase du chargement — nécessaire pour distinguer « vide » de « pas encore
   * chargé ». Un booléen `loading` ne le permet pas : les deux états ont la même
   * liste de messages, et le premier affichage serait un faux vide.
   */
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState(() => lireBrouillon(agent.paneId));
  const [composerFocused, setComposerFocused] = useState(false);
  /** Champ de saisie, pour lui rendre sa taille après un envoi. */
  const champRef = useRef<HTMLTextAreaElement | null>(null);
  const [sending, setSending] = useState(false);
  /**
   * ⚠️ **Les envois vivent dans un magasin PAR PANE (T058).** Ils étaient dans
   * l'état de ce composant : un changement de conversation les perdait, la
   * minuterie de 900 ms mourait au démontage, et « réessayer » visait l'agent
   * affiché au lieu de celui de l'envoi. Le magasin capture la cible.
   */
  const magasinEnvois = useMemo(
    () => creeMagasinEnvois((pane, text) => sendPrompt(pane, text), planificateurReel),
    [],
  );
  const [, forceRenduEnvois] = useState(0);
  useEffect(
    () => magasinEnvois.souscrire(() => forceRenduEnvois((valeur) => valeur + 1)),
    [magasinEnvois],
  );
  const envoisLocaux: ReadonlyArray<EnvoiMagasin> = magasinEnvois.liste(agent.paneId);

  /*
    ⚠️ La mise à jour de la PWA a besoin de savoir qu'un envoi n'est pas
    résolu (T060) : un « sending » ou un « uncertain » peut être parti, et
    recharger l'effacerait. On publie le fait, pas le détail.
  */
  useEffect(() => {
    marqueEnvoisEnCours(
      envoisLocaux.some(
        (envoi) =>
          envoi.state === "queued" || envoi.state === "sending" || envoi.state === "uncertain",
      ),
    );
  });
  const [messageOuvert, setMessageOuvert] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopFeedback, setStopFeedback] = useState<string | null>(null);
  /** Le retour du geste « focus sur le Mac » — jamais un succès supposé. */
  const [focusFeedback, setFocusFeedback] = useState<string | null>(null);
  /**
   * Plafond de pages vides remontées d'affilée avant d'abandonner.
   *
   * ⚠️ Le serveur peut rendre une page vide **en avançant le curseur** (une ligne
   * plus grande que la fenêtre). Sans plafond, on lirait le fichier entier sur un
   * seul appui ; sans continuité, le bouton ne ferait rien du tout.
   */
  const PAGES_VIDES_MAX = 8;

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** Le repère du haut du fil : sa visibilité déclenche le chargement. */
  const sentinelleRef = useRef<HTMLSpanElement | null>(null);
  /**
   * Dernier statut **vu** pour cet agent, pour distinguer une arrivee d'une fin
   * de travail. Remis a `null` au changement d'agent.
   */
  const statutVu = useRef<string | null>(null);
  const placeholder = `Message ${agentName(agent)}…`;
  const files = touchedFilesOf(messages);
  const [showFiles, setShowFiles] = useState(false);
  const [fichierEnAttente, setFichierEnAttente] = useState<string | null>(null);
  const [showModel, setShowModel] = useState(false);
  /** Fichier ouvert dans la visionneuse plein écran. */
  const [openFile, setOpenFile] = useState<string | null>(null);
  /** `true` quand la visionneuse a été ouverte depuis la liste des fichiers. */
  const [fromFiles, setFromFiles] = useState(false);

  /*
    ⚠️ **Les items ne se recalculent PAS à chaque frappe (C27).** `messages`
    est un état : il ne change qu'à l'arrivée de vrais messages. Sans ce
    `useMemo`, chaque touche dans le composeur refaisait le découpage de tout
    l'historique — 2 000 messages, à chaque caractère.
  */
  const aguiche = agent.status === "working";
  const items = useMemo(
    () => avecTravailEnCours(toItems(messages, aguiche), aguiche),
    [messages, aguiche],
  );

  const réglagesSession = useMemo(() => {
    let model: string | undefined;
    let provider: string | undefined;
    let thinking: string | undefined;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      if (
        (model === undefined && entry.type === "model_change") ||
        (thinking === undefined && entry.type === "thinking_level_change")
      ) {
        try {
          const raw: unknown = JSON.parse(entry.raw);
          if (typeof raw !== "object" || raw === null) continue;
          if (model === undefined && entry.type === "model_change") {
            const modelId: unknown = Reflect.get(raw, "modelId");
            if (typeof modelId === "string") {
              model = modelId;
              const providerId: unknown = Reflect.get(raw, "provider");
              if (typeof providerId === "string") provider = providerId;
            }
          }
          if (thinking === undefined && entry.type === "thinking_level_change") {
            const thinkingLevel: unknown = Reflect.get(raw, "thinkingLevel");
            if (typeof thinkingLevel === "string") thinking = thinkingLevel;
          }
        } catch {
          // Une ligne malformée n'empêche pas de lire les autres réglages.
        }
      }
      if (model !== undefined && thinking !== undefined) break;
    }
    return { model, provider, thinking };
  }, [entries]);
  const onToggleFiles = useCallback(() => {
    setShowFiles((value) => !value);
    setShowModel(false);
  }, []);

  const fermerFichiers = useCallback(() => {
    setShowFiles(false);
    if (fichierEnAttente !== null) {
      setFromFiles(true);
      setOpenFile(fichierEnAttente);
      setFichierEnAttente(null);
    }
  }, [fichierEnAttente]);

  /**
   * Chargement **incrémental** de la conversation.
   *
   * Premier passage : on lit la fin du fichier (`tail`), pour peindre vite.
   * Ensuite : on ne demande que ce qui suit le dernier offset connu (`since`).
   *
   * Avant, chaque rafraîchissement re-téléchargeait la session entière — 1,8 Mo
   * sur une session réelle, toutes les 2,5 s — et l'écran ne s'affichait jamais.
   */
  const cursor = useRef<{ cursor: string | undefined; path: string } | null>(null);
  const loading = useRef(false);
  /**
   * Le nombre d'entrées et d'envois **affichés**, lisibles depuis `load` sans
   * l'ajouter à ses dépendances.
   *
   * ⚠️ La règle d'affichage en a besoin : « cette page vide doit-elle vider le
   * fil ? » dépend de ce qui est déjà à l'écran. Lire l'état directement
   * obligerait à mettre `entries` en dépendance de `load`, donc à recréer le
   * chargeur à chaque message — et à relancer des lectures en boucle.
   */
  const entriesRef = useRef(0);
  const envoisRef = useRef(0);

  // Les compteurs suivent l'état après chaque rendu (voir la note des refs).
  useEffect(() => {
    entriesRef.current = entries.length;
  }, [entries]);
  useEffect(() => {
    envoisRef.current = envoisLocaux.length;
  }, [envoisLocaux]);

  const load = useCallback(
    async (mode: "initial" | "incremental") => {
      /*
        ⚠️ **Pas de session : il n'y a rien à lire, donc on ne demande rien.**

        Herdr n'annonce `agent_session` qu'à partir du premier message : un agent
        neuf a `sessionPath === null`, et la route répond alors 404 « no usable
        session path for this agent ». L'écran affichait donc un **avis** *et* une
        **erreur rouge** pour la même absence — crier au loup sur un agent qui
        démarre. L'absence est déjà dite par l'avis ; ici on constate simplement
        qu'il n'y a rien à appeler.
      */
      if (agent.sessionPath === null) {
        setPhase("ready");
        // Le chargement des pages précédentes n'a plus d'objet non plus.
        setPreviousCursor(null);
        return;
      }
      if (loading.current) return;
      loading.current = true;
      if (mode === "initial") setPhase("loading");
      try {
        const known = cursor.current;
        const session =
          mode === "incremental" && known !== null && known.cursor !== undefined
            ? await fetchSession(agent.paneId, { cursor: known.cursor })
            : await fetchSession(agent.paneId, { tail: 524_288 });

        cursor.current = { cursor: session.cursor, path: session.sessionPath };
        if (!session.incremental || session.reset) {
          setPreviousCursor(session.previousCursor ?? null);
        }

        /*
          ⚠️ **La décision d'affichage est une règle, pas un `if` au fil de
          l'eau.** Elle vivait ici, et elle vidait le fil dès qu'une page
          arrivait vide (`setEntries([])` sur un `reset` ou une session
          disparue) : plus de messages, plus de repère de défilement, écran
          inutilisable — observé quand un agent passe en `blocked` ou subit un
          incident. La règle est maintenant dans `session-vue.ts`, testée.
        */
        const decision = decideAffichage({
          affiches: entriesRef.current + envoisRef.current,
          page: {
            cause: session.cause,
            entries: session.entries,
            incremental: session.incremental,
            reset: session.reset,
          },
        });
        if (decision.genre === "remplace") {
          setEntries(session.entries);
          setMessages(toMessages(session.entries));
        } else if (decision.genre === "ajoute") {
          // ⚠️ Fusion, pas empilement : une entrée peut être **remplacée**
          // (opencode réécrit la ligne d'un message pendant qu'il le compose).
          const ajoutees = toMessages(session.entries);
          setEntries((current) => fusionnerEntrees(current, session.entries));
          setMessages((current) => fusionnerEntrees(current, ajoutees));
        } else if (decision.genre === "garde-et-previens") {
          // Le fil reste : on ne détruit pas ce qui est lu, on le dit.
          setLecturePartielle(mentionLecturePartielle(decision.raison));
        }
        if (decision.genre !== "garde-et-previens") setLecturePartielle(null);
        setError(null);
        setPhase("ready");
      } catch (cause) {
        // La cause réelle est affichée : pas de message générique qui masque.
        const message = cause instanceof Error ? cause.message : String(cause);
        /*
          ⚠️ **On ne vide pas le fil sur une erreur de lecture.** Un 502 passager
          ne dit rien du contenu : il dit qu'on n'a pas pu le lire maintenant.
          L'écran basculait en `error` **et** laissait le fil en place, mais
          l'état d'erreur masquait tout le reste de l'écran dans les versions
          antérieures ; ici la règle est explicite et testée.
        */
        if (!gardeLeFilMalgréErreur(entriesRef.current + envoisRef.current)) {
          setPhase("error");
        }
        setLecturePartielle(mentionLecturePartielle(message));
        setError(message);
        reportError("failed to load the session", {
          message,
          paneId: agent.paneId,
        });
      } finally {
        loading.current = false;
      }
    },
    // ⚠️ `sessionPath` est une dépendance : sans elle, la garde ci-dessus
    // resterait figée sur « pas de session » et l'écran ne chargerait jamais rien
    // quand l'agent finit par écrire la sienne.
    [agent.paneId, agent.sessionPath],
  );

  /**
   * Cadence de rafraîchissement, lue sans relancer le chargement.
   *
   * ⚠️ **`agent.status` ne doit PAS être une dépendance de l'effet ci-dessous.**
   * Il l'était, et chaque changement d'état relançait tout : le curseur remis à
   * zéro, la session relue depuis la fin, et le chargement automatique des pages
   * précédentes qui **préfixait de vieux messages en haut de la conversation**.
   *
   * Ce n'est pas un cas rare : appliquer un modèle ou un niveau de pensée envoie
   * `/model` ou `/thinking`, l'agent passe `working` → `idle`, et l'écran sautait.
   * Le statut ne choisit que la **cadence** ; il n'a rien à dire sur ce qui est
   * affiché. Un rafraîchissement doit s'ajouter, jamais repartir de zéro.
   */
  const statutRef = useRef(agent.status);
  useEffect(() => {
    statutRef.current = agent.status;
  }, [agent.status]);

  useEffect(() => {
    cursor.current = null;
    // ⚠️ Le statut vu appartient à **cet** agent : le garder ferait croire à une
    // transition qui n'a pas eu lieu chez le suivant.
    statutVu.current = null;
    setPreviousCursor(null);
    void load("initial");
    /*
      ⚠️ **La cadence suit le regard, pas seulement le statut.**

      Une app visible est regardée : on veut la mise à jour au plus près. Une app
      en arrière-plan ne l'est pas — la sonder au même rythme vide la batterie du
      téléphone pour un écran que personne ne lit. Le statut reste le second axe :
      un agent qui travaille bouge vite, un agent au repos non.

      Avant : 750 ms / 2 s quelle que soit la visibilité. On payait le prix du
      premier plan en permanence, sans jamais l'obtenir au bon moment.

      ⚠️ **`visibilitychange` et non le focus du document.** La propriété
      `hasFocus` de `document` est instable sur iOS : elle tombe à `false` sans
      que l'app ait été quittée, et caler la cadence dessus la ralentirait au
      moment précis où on est en train de lire. Le `focus` de la fenêtre est donc
      utilisé pour **réveiller**, jamais pour ralentir.
    */
    const regardActif = () => document.visibilityState === "visible";
    const cadence = () => {
      if (!regardActif()) return statutRef.current === "working" ? 3000 : 10_000;
      return statutRef.current === "working" ? 400 : 1200;
    };
    // `setTimeout` en cascade plutôt que `setInterval` : la cadence est relue à
    // chaque tour, donc elle suit le statut et le regard sans que l'effet en
    // dépende.
    let timer = 0;
    const tour = () => {
      void load("incremental");
      timer = window.setTimeout(tour, cadence());
    };
    /*
      ⚠️ **Revenir au premier plan exige une lecture immédiate.** Sans cela on
      attend la fin du tour en cours — jusqu'à dix secondes si l'app était en
      arrière-plan — et l'écran paraît figé au moment précis où on le rouvre.
    */
    const reveil = () => {
      window.clearTimeout(timer);
      tour();
    };
    document.addEventListener("visibilitychange", reveil);
    window.addEventListener("focus", reveil);
    timer = window.setTimeout(tour, cadence());
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", reveil);
      window.removeEventListener("focus", reveil);
    };
  }, [load]);

  /*
    ⚠️ **AUCUN focus automatique (C24).** Il y avait ici un effet qui POSTait
    `/api/agents/:id/focus` à l'ouverture **et** à chaque changement de statut.
    Deux conséquences mesurées :

    - lire une conversation changeait le focus réel du Mac — ouvrir un onglet
      pour *regarder* volait le clavier à l'utilisateur ;
    - l'acquittement d'un agent dépendait donc de la navigation : regarder une
      réponse la marquait lue, sans que personne l'ait décidé.

    Le geste est désormais **explicite** : le bouton de l'en-tête
    (`focusDesktop`), et lui seul. L'endpoint reste, sa cible est capturée à
    l'appel.
  */
  const focusDesktop = useCallback(async () => {
    // ⚠️ Cible capturée : le pane de CETTE conversation, jamais « l'agent
    // affiché au moment où la requête revient ».
    const cible = agent.paneId;
    setFocusFeedback(null);
    try {
      await focusAgent(cible);
      setFocusFeedback("Focus moved to this pane on the Mac");
    } catch (cause: unknown) {
      // L'échec est une VALEUR : on dit que ça n'a pas marché, on ne prétend
      // pas que le focus a bougé.
      setFocusFeedback(
        `Could not focus on the Mac: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }, [agent.paneId]);

  /**
   * La hauteur du fil **avant** un préfixe — pour compenser après.
   *
   * ⚠️ Elle est mesurée au début du chargement, pas au moment du `setState` :
   * entre les deux, une réponse peut arriver et changer la hauteur, et on
   * compenserait alors un delta faux (la vue sauterait d'autant).
   */
  const hauteurAvantPrepend = useRef<{ hauteur: number; scroll: number } | null>(null);

  const chargerPrecedents = useCallback(async () => {
    const before = previousCursor;
    if (before === null || loadingPrevious || loading.current) return;
    setLoadingPrevious(true);
    loading.current = true;
    setPreviousError(null);
    try {
      let pageCursor: string | null = before;
      let pagesVides = 0;
      const pagesAnterieures: Array<typeof entries> = [];
      // Codex logs work as many short events. The prompt can sit over ten
      // pages behind the live tail even when the tail itself loads quickly.
      while (pageCursor !== null) {
        // Pages are cursor dependent; each next cursor is returned by this fetch.
        // oxlint-disable-next-line no-await-in-loop
        const session = await fetchSession(agent.paneId, { before: pageCursor });
        if (session.reset) {
          setEntries(session.entries);
          setMessages(toMessages(session.entries));
          cursor.current = { cursor: session.cursor, path: session.sessionPath };
          setPreviousCursor(session.previousCursor ?? null);
          return;
        }
        pagesAnterieures.push(session.entries);
        const nextCursor = session.previousCursor ?? null;
        const hasPrompt = toMessages(session.entries).some((message) => message.role === "user");

        // Le curseur ne bouge plus : continuer boucherait à l'infini.
        if (nextCursor === pageCursor || nextCursor === null) {
          pageCursor = null;
          break;
        }

        /*
          ⚠️ **Une page VIDE n'est pas la fin.**

          Le serveur peut rendre `entries: []` **tout en avançant le curseur** :
          mesuré sur une session de ~4,2 Mo, où une page de 512 Ko ne contenait
          aucune ligne complète — une seule ligne plus grande que la fenêtre la
          remplit entièrement. La version précédente s'arrêtait sur ce vide et
          laissait le curseur avancé : « Charger les messages précédents »
          semblait alors ne **jamais rien faire**, indéfiniment.

          On continue donc à remonter, avec un plafond : un fichier réellement
          fait de pages vides ne doit pas nous faire lire 4 Mo sur un appui.
        */
        if (session.entries.length === 0) {
          pagesVides += 1;
          if (pagesVides >= PAGES_VIDES_MAX) break;
        } else {
          pagesVides = 0;
        }

        // Une demande de l'utilisateur atteinte : on a remonté jusqu'au tour
        // précédent, c'est exactement ce qu'on voulait ramener à l'écran.
        if (hasPrompt) break;
        pageCursor = nextCursor;
      }
      const entriesAnterieures = pagesAnterieures.toReversed().flat();
      if (entriesAnterieures.length > 0) {
        const scroller = scrollerRef.current;
        if (scroller !== null) {
          hauteurAvantPrepend.current = {
            hauteur: scroller.scrollHeight,
            scroll: scroller.scrollTop,
          };
        }
        const precedents = toMessages(entriesAnterieures);
        setEntries((current) => [...entriesAnterieures, ...current]);
        setMessages((current) => [...precedents, ...current]);
      }
      /*
        ⚠️ **Rien de chargé = il n'y a plus rien, et on le dit.**

        Le curseur peut encore désigner quelque chose alors que la remontée n'a
        ramené **aucune** entrée : pages vides en cascade, ou plafond atteint.
        Laisser le bouton dans cet état est le pire des deux mondes — il reste
        affiché et ne fait rien, indéfiniment. On le retire.

        Un curseur nul fait disparaître le bouton : c'est le seul signal que
        l'interface écoute, et c'est exactement ce qu'il signifie ici.
      */
      setPreviousCursor(entriesAnterieures.length > 0 ? pageCursor : null);
      // ⚠️ La compensation se fait **après** que React a peint les nouveaux
      // messages : mesurer la hauteur dans le même tour lirait l'ancienne.
      const mesure = hauteurAvantPrepend.current;
      hauteurAvantPrepend.current = null;
      if (mesure !== null) {
        requestAnimationFrame(() => {
          const actuel = scrollerRef.current;
          if (actuel === null) return;
          actuel.scrollTop = positionApresPrepend({
            hauteurApres: actuel.scrollHeight,
            hauteurAvant: mesure.hauteur,
            scrollAvant: mesure.scroll,
          });
        });
      }
    } catch (cause) {
      setPreviousError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loading.current = false;
      setLoadingPrevious(false);
    }
  }, [agent.paneId, loadingPrevious, previousCursor]);

  /**
   * **Le chargement paresseux de l'historique, au défilement vers le haut.**
   *
   * ⚠️ **Ce que ça remplace, et pourquoi.** Avant, une seule page était chargée
   * automatiquement après l'arrivée de la première — puis plus rien sans un
   * appui sur un bouton. Sur une session codex réelle, la demande courante peut
   * se trouver **dix pages** en arrière : l'utilisateur devait donc appuyer
   * plusieurs fois, en attendant chaque aller-retour.
   *
   * Ici, approcher du haut **déclenche** le chargement, avec
   * `SEUIL_PREMIERES_LIGNES_PX` de marge : on charge avant d'atteindre le bord,
   * donc on ne voit jamais de trou. Le bouton reste, pour le clavier et pour
   * réessayer après un échec.
   *
   * ⚠️ `doitChargerPlusTot` porte les deux gardes qui évitent les défauts
   * classiques : pas de second chargement pendant qu'un est en cours (double
   * page), et rien à charger quand le curseur est épuisé (boucle pour rien).
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const sentinelle = sentinelleRef.current;
    if (scroller === null || sentinelle === null) return undefined;
    const observateur = new IntersectionObserver(
      (entrees) => {
        const visible = entrees.some((entree) => entree.isIntersecting);
        if (!visible) return;
        if (
          doitChargerPlusTot({
            curseurDisponible: previousCursor !== null,
            distanceAuHaut: 0,
            enCours: loadingPrevious || loading.current,
            seuil: SEUIL_PREMIERES_LIGNES_PX,
          })
        ) {
          void chargerPrecedents();
        }
      },
      { root: scroller, rootMargin: `${String(SEUIL_PREMIERES_LIGNES_PX)}px 0px 0px 0px` },
    );
    observateur.observe(sentinelle);
    return () => observateur.disconnect();
  }, [chargerPrecedents, loadingPrevious, previousCursor]);

  /**
   * Défilement automatique — **conditionnel**.
   *
   * Avant, chaque arrivée de message déclenchait un `scrollIntoView` animé.
   * Pendant la saisie, l'animation se battait avec le clavier iOS et le
   * défilement partait en vrille. On ne défile donc que si l'utilisateur est
   * déjà en bas, et **sans animation** : un saut instantané ne se bat avec rien.
   */
  const atBottom = useRef(true);

  /*
    ⚠️ **On retient la position, pas seulement l'intention.** `atBottom` dit si
    on suivait le direct ; il ne dit pas *où* on lisait. Partir sur l'ordinateur
    et revenir sur la PWA ramenait le fil en haut, parce que rien n'avait été
    mémorisé. La position est écrite avec un délai : un défilement en produit
    des dizaines par seconde.
  */
  const memoireEnAttente = useRef<number | undefined>(undefined);
  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      atBottom.current = suitLeBas(el);
      const position = positionAffichee({
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        seuilBas: 48,
      });
      if (memoireEnAttente.current !== undefined) window.clearTimeout(memoireEnAttente.current);
      memoireEnAttente.current = window.setTimeout(() => {
        memoireEnAttente.current = undefined;
        ecritPosition(stockageNavigateur(), agent.paneId, position);
      }, 400);
    },
    [agent.paneId],
  );

  /*
    Le retour dans une conversation **reprend la position mémorisée**, une seule
    fois, dès que le contenu est là. Sans mémoire (première visite), c'est la
    règle d'ancrage qui tranche — et elle est appliquée par l'effet de statut.
  */
  const repriseFaite = useRef(false);
  useEffect(() => {
    repriseFaite.current = false;
  }, [agent.paneId]);
  useEffect(() => {
    if (phase !== "ready" || repriseFaite.current) return;
    const scroller = scrollerRef.current;
    if (scroller === null || entries.length === 0) return;
    const position = litPosition(stockageNavigateur(), agent.paneId);
    if (position === null) return;
    repriseFaite.current = true;
    scroller.scrollTop = hauteurDeReprise(position, {
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
    });
    // La reprise fixe aussi l'intention : si l'on était en bas, on suit le bas.
    atBottom.current = position.bas;
  }, [agent.paneId, entries.length, phase]);

  /**
   * Amène la **dernière demande** de l'utilisateur en haut de la vue.
   *
   * ⚠️ **Pourquoi ce n'est pas le bas.** Une réponse qui arrive au bas de
   * l'écran pousse la demande hors du cadre : on lit la réponse sans savoir à
   * quoi elle répond, et il faut remonter d'un geste. En posant la demande en
   * haut, on lit les deux d'un même regard.
   *
   * ⚠️ On vise `.bubble--user:not(.optimistic)` : un envoi en attente porte aussi
   * la classe `bubble--user`, mais il est **collé au bas** (`.envois`). Le prendre
   * pour la demande ferait viser un élément qui ne défile pas.
   */
  const derniereDemandeEnHaut = useCallback((): void => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const demandes = scroller.querySelectorAll(".bubble--user:not(.optimistic)");
    const derniere = demandes[demandes.length - 1];
    if (derniere === undefined) return;
    const ecart = derniere.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    // 8 px de marge : collée au bord, la bulle paraît coupée.
    scroller.scrollTop += ecart - 8;
    /*
      ⚠️ On **recalcule** l'intention ici, au lieu d'attendre l'événement de
      défilement. Celui-ci arrive après, et l'observateur de taille pouvait
      repasser entre-temps et ramener la vue en bas : le correctif aurait été
      annulé par le mécanisme existant. Le calcul rend aussi la vérité du cas
      court — quand tout tient à l'écran, on **est** en bas, et suivre le bas
      reste correct.
    */
    atBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    const scroller = scrollerRef.current;
    if (content === null || scroller === null) return undefined;
    const suivreLeBas = () => {
      if (atBottom.current) scroller.scrollTop = scroller.scrollHeight;
    };
    const observer = new ResizeObserver(suivreLeBas);
    observer.observe(content);
    /*
      ⚠️ **Le conteneur aussi, et ce n'est pas un détail.**

      N'observer que le contenu laissait passer le cas le plus fréquent : quand
      le **conteneur** rétrécit, le contenu ne change pas de taille et rien ne
      relit la position. Or le conteneur rétrécit pour deux raisons parfaitement
      banales — **le composeur qui grandit** quand on écrit trois lignes, et **le
      clavier iOS** qui monte. Mesuré dans le vrai PWA, avec une fenêtre de
      téléphone : composeur +200 px → `clientHeight` 711 → 535, et le bas de la
      conversation se retrouve **176 px sous la zone visible**, sans qu'aucun
      événement ne le signale. Le dernier message disparaît sous le composeur.

      `atBottom` reste la seule autorité : il enregistre l'**intention** de
      l'utilisateur (« je suivais le bas »), et il n'est pas recalculé quand le
      conteneur rétrécit — c'est précisément ce qu'on veut. Quelqu'un qui lisait
      plus haut n'est donc pas ramené de force.
    */
    observer.observe(scroller);
    suivreLeBas();
    return () => observer.disconnect();
  }, []);

  /**
   * Où se poser quand un agent finit de travailler.
   *
   * ⚠️ **À l'ouverture, tout dépend de l'état.** Un agent `idle` a déjà été lu :
   * on se pose en bas, la convention de toutes les messageries. Un agent `done`
   * attend une réponse qu'on n'a **pas** vue — se poser en bas la montrerait sans
   * sa demande, donc on se pose sur la demande.
   *
   * ⚠️ **Pendant qu'on regarde, la fin d'un travail ramène à la demande.**
   * Seulement si l'on suivait le bas : quelqu'un qui lisait plus haut n'est pas
   * tiré de sa lecture.
   */
  useEffect(() => {
    if (phase !== "ready") return;
    const avant = statutVu.current;
    statutVu.current = agent.status;
    const ou = ancrage({ apres: agent.status, avant, suivaitLeBas: atBottom.current });
    if (ou === "aucun") return;
    if (ou === "bas") {
      const scroller = scrollerRef.current;
      if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    derniereDemandeEnHaut();
  }, [phase, agent.paneId, agent.status, derniereDemandeEnHaut]);

  /**
   * Champ grandissant, borné à cinq lignes.
   *
   * ⚠️ Un `textarea` à hauteur fixe oblige à faire défiler son propre message
   * dès la deuxième ligne. Toutes les messageries grandissent puis s'arrêtent :
   * au-delà de cinq lignes on écrit un document, pas un message.
   *
   * La hauteur est remise à `auto` **avant** de mesurer — sinon `scrollHeight`
   * ne fait que croître et le champ ne redescend jamais quand on efface.
   */
  /** Hauteur d'une ligne — doit suivre le `line-height` du CSS. */
  const LINE_HEIGHT = 22;
  /** Au-delà, on écrit un document, pas un message. */
  const MAX_LIGNES = 5;
  /**
   * Ajuste la hauteur du champ à son contenu.
   *
   * ⚠️ La hauteur est remise à `auto` **avant** de mesurer : sinon
   * `scrollHeight` ne fait que croître et le champ ne redescend jamais.
   * Appelée aussi **après l'envoi**, sans quoi le champ restait à la hauteur du
   * message précédent alors qu'il est vide.
   */
  const ajusterHauteur = useCallback((field: HTMLTextAreaElement): void => {
    field.style.height = "auto";
    const maximum = LINE_HEIGHT * MAX_LIGNES;
    field.style.height = `${String(Math.min(field.scrollHeight, maximum))}px`;
    field.style.overflowY = field.scrollHeight > maximum ? "auto" : "hidden";
  }, []);

  /**
   * Écrit un texte dans le champ, **et laisse le curseur à la fin**.
   *
   * ⚠️ **Écrire dans `.value` remet le curseur à 0.** C'est la cause du défaut :
   * après un changement d'agent — ou la réexpédition d'un message en échec — le
   * curseur repartait au début, et la suite du texte s'insérait **avant** tout
   * le brouillon. Le champ restait aussi à la hauteur d'une ligne, puisque
   * celle-ci n'était recalculée qu'à la première frappe : on voyait un
   * brouillon de trois lignes s'afficher sur une seule.
   *
   * ⚠️ **On ne force pas la fin à chaque prise de focus.** Ce serait plus simple
   * et faux : on ne pourrait plus taper au milieu du texte pour corriger un mot.
   * Le curseur n'est déplacé qu'au moment où c'est **l'application** qui écrit,
   * c'est-à-dire quand la position courante n'est plus celle qu'on a laissée.
   */
  const ecrireAuChamp = useCallback(
    (texte: string): void => {
      const champ = champRef.current;
      if (champ === null) return;
      champ.value = texte;
      ajusterHauteur(champ);
      champ.setSelectionRange(texte.length, texte.length);
    },
    [ajusterHauteur],
  );

  /**
   * Le champ reprend le focus.
   *
   * ⚠️ **La hauteur est recalculée ici.** `onBlur` la remet à `""` pour rendre
   * le champ au CSS (une ligne, `rows={1}`) ; sans ce recalcul, un brouillon
   * multiligne réapparaissait sur une seule ligne après un aller-retour de
   * focus, et ne se corrigeait qu'à la première frappe — d'où l'impression que
   * la première lettre manquait.
   */
  const reprendreFocus = useCallback(
    (champ: HTMLTextAreaElement): void => {
      setComposerFocused(true);
      ajusterHauteur(champ);
    },
    [ajusterHauteur],
  );

  const onDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      ecrireBrouillon(agent.paneId, event.target.value);
      ajusterHauteur(event.target);
    },
    [agent.paneId, ajusterHauteur],
  );

  /*
    ⚠️ **Changer d'agent change de brouillon.**

    Chaque agent a le sien, gardé en mémoire : on peut commencer à écrire, partir
    vérifier ailleurs, et retrouver son texte en revenant. Sans cette clé, ce
    qu'on avait écrit pour un agent se retrouverait dans le composeur d'un autre,
    prêt à partir au mauvais endroit — un défaut bien pire que la perte d'un
    brouillon.

    ⚠️ Dépendances : `agent.paneId` et `ajusterHauteur` seulement. Relire le
    magasin à chaque rendu écraserait la frappe en cours — d'où la mémorisation
    d'`ajusterHauteur`, sans laquelle cet effet se rejouerait en boucle.
  */
  useEffect(() => {
    const retrouve = lireBrouillon(agent.paneId);
    setDraft(retrouve);
    ecrireAuChamp(retrouve);
  }, [agent.paneId, ecrireAuChamp]);

  /** État de la dernière réponse à une question, pour ne jamais mentir dessus. */
  const [reponse, setReponse] = useState<AnswerResult | null>(null);
  const [envoiReponse, setEnvoiReponse] = useState(false);
  /**
   * Numéro de l'option de **saisie libre** en cours de réponse, ou `null`.
   *
   * ⚠️ **Cette option ne se répond pas par un chiffre.** opencode l'ajoute
   * lui-même (« Type your own answer ») et la choisir **ouvre un champ texte** :
   * envoyer le seul numéro laissait l'utilisateur avec un champ ouvert et aucun
   * moyen d'y écrire. Tant que ce mode est actif, l'envoi part comme **réponse à
   * la question** — le numéro ET le texte — au lieu d'un prompt, que Herdr
   * refuserait de toute façon sur un agent bloqué.
   */
  const [saisieLibre, setSaisieLibre] = useState<number | null>(null);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    /*
      ⚠️ **Répondre à l'option de saisie libre.** Le texte part **avec** le
      numéro : le choix ouvre le champ, le texte l'emplit, la validation suit —
      c'est la séquence prouvée dans le code d'opencode, et c'est le serveur qui
      l'exécute pour qu'elle ne soit pas recomposée ici.
    */
    if (saisieLibre !== null) {
      if (envoiReponse) return;
      setEnvoiReponse(true);
      setDraft("");
      ecrireBrouillon(agent.paneId, "");
      ecrireAuChamp("");
      try {
        setReponse(await answerQuestion(agent.paneId, saisieLibre, text));
        // Le mode ne survit pas à une réponse : la question est traitée.
        setSaisieLibre(null);
      } catch (cause) {
        // Jamais d'échec muet : la cause est nommée, et le mode reste actif.
        setReponse({
          detail: cause instanceof Error ? cause.message : "Unknown error",
          state: "refusee",
        });
      } finally {
        setEnvoiReponse(false);
      }
      return;
    }
    const baseline = messages.filter(
      (message) => message.role === "user" && message.text === text,
    ).length;
    // ⚠️ La cible et la minuterie sont au MAGASIN : changer de conversation
    // n'annule plus l'envoi, et « réessayer » visera ce pane-ci.
    magasinEnvois.ajoute({ baseline, pane: agent.paneId, text });
    setSending(true);
    setMessageOuvert(null);
    setDraft("");
    // Le message est parti : le brouillon de CET agent n'a plus lieu d'être.
    ecrireBrouillon(agent.paneId, "");
    if (champRef.current !== null) {
      champRef.current.value = "";
      ajusterHauteur(champRef.current);
    }
    // La bulle apparaît immédiatement ; le magasin l'envoie dans 900 ms, et
    // elle reste annulable jusque-là.
  }, [
    agent.paneId,
    ajusterHauteur,
    draft,
    ecrireAuChamp,
    envoiReponse,
    magasinEnvois,
    messages,
    saisieLibre,
    sending,
  ]);

  useEffect(() => {
    // Le message apparaît enfin dans la session : la bulle optimiste s'efface.
    const messagesUtilisateur = messages.filter((message) => message.role === "user");
    const restants = new Map<string, number>();
    for (const message of messagesUtilisateur) {
      restants.set(message.text, (restants.get(message.text) ?? 0) + 1);
    }
    for (const local of magasinEnvois.liste(agent.paneId)) {
      const compte = restants.get(local.text) ?? 0;
      if (compte > local.baseline) {
        restants.set(local.text, compte - 1);
        magasinEnvois.oublie(local.id);
      }
    }
  }, [agent.paneId, magasinEnvois, messages]);

  const annulerEnvoi = useCallback(
    (message: EnvoiMagasin) => {
      if (message.state !== "queued") return;
      const texte = magasinEnvois.annule(message.id);
      if (texte === null) return;
      setMessageOuvert(null);
      setDraft(texte);
      setSending(false);
      requestAnimationFrame(() => {
        ecrireAuChamp(texte);
      });
    },
    [ecrireAuChamp, magasinEnvois],
  );

  const reessayerEnvoi = useCallback(
    (message: EnvoiMagasin) => {
      setMessageOuvert(null);
      setSending(magasinEnvois.reessaye(message.id));
    },
    [magasinEnvois],
  );

  const interrompreAgent = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    setStopFeedback(null);
    try {
      const result = await stopAgent(agent.paneId);
      setStopFeedback(
        result.status === "interrupt-sent"
          ? "Ctrl+C sent to Herdr. The agent has not confirmed stopping yet."
          : "Herdr reports that the agent is no longer working.",
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setStopFeedback(`Stop request failed: ${detail}`);
      reportError("failed to interrupt the agent", {
        detail,
        paneId: agent.paneId,
      });
    } finally {
      setStopping(false);
    }
  }, [agent.paneId, stopping]);

  const choisir = useCallback(
    async (numero: number) => {
      if (envoiReponse) return;
      setEnvoiReponse(true);
      try {
        setReponse(await answerQuestion(agent.paneId, numero));
      } catch (cause) {
        // Jamais d'échec muet : la cause est nommée à l'écran.
        setReponse({
          detail: cause instanceof Error ? cause.message : "Unknown error",
          state: "refusee",
        });
      } finally {
        setEnvoiReponse(false);
      }
    },
    [agent.paneId, envoiReponse],
  );

  const onSubmit = useCallback(() => {
    void submit();
  }, [submit]);

  // Mémoïsés : sans cela, le `value` du Context est une **nouvelle fonction à
  // chaque rendu**, ce qui redessine tout l'arbre sous le provider — donc toute
  // la conversation — même quand seul le composeur change. C'est la famille du
  // défaut D016 (travail inutile sur le fil principal à chaque frappe).
  const openUrlFromBlock = useCallback((url: string) => {
    setFromFiles(false);
    setOpenFile(url);
  }, []);
  const openPathFromBlock = useCallback((path: string) => {
    setFromFiles(false);
    setOpenFile(path);
  }, []);

  return (
    // La visionneuse est fournie au fond de l'arbre : un bloc qui cite une image
    // l'ouvre sans qu'aucun composant intermédiaire n'ait à la connaître.
    <UrlOpenerContext.Provider value={openUrlFromBlock}>
      <FileOpenerContext.Provider value={openPathFromBlock}>
        <section className="chat">
          <header className="screen__head">
            <button type="button" className="back" onClick={onBack} aria-label="Back">
              ‹
            </button>
            {agent.status === "working" ? (
              <span className="working-dots" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
            ) : (
              <span className={statusClass(agent.status)} aria-hidden="true" />
            )}
            <div className="screen__title">
              {/*
                Le titre de la conversation, pas le nom de l'agent : c'est ce
                qu'on a sous les yeux en ouvrant, et le contexte juste dessous
                dit de quel agent et de quel projet il s'agit.

                ⚠️ **Pas de marque ici.** Le logo de l'agent vit dans la liste
                des conversations, ou il sert a choisir ; une fois la
                conversation ouverte, on sait deja laquelle on regarde, et le
                titre d'Herdr porte deja son propre signe (`π - pixel`).
              */}
              <strong>{agent.title ?? agentName(agent)}</strong>
              {/*
                Le statut **en tete** : la ligne est tronquée à l'ellipse sur
                un écran étroit, et « onglet 1 · pi · devcli-private » se coupe
                avant d'arriver au statut — qui est la seule information encore
                utile quand le reste a disparu.
              */}
              {/*
                ⚠️ **Une seule ligne de contexte, modèle compris.** Il y en
                avait deux — `working · onglet 1 · pi`, puis le modèle — et
                elles coûtaient ~25 px de fil sur un écran de 852 px, pour une
                information qu'on ne lit qu'une fois. Le modèle est **tronqué à
                l'ellipse** : la ligne entière est déjà coupée sur un iPhone, et
                le modèle complet reste lisible dans la feuille « Model », où on
                va de toute façon pour le changer.
              */}
              <div className="muted small screen__reglages">
                {`${headerContext(agent)} · ${headerReglages(currentModel, currentThinking)}`}
              </div>
            </div>
            {/*
          Les fichiers sont une **action**, pas une section permanente : un
          bouton discret, avec le compte, uniquement s'il y en a.
        */}
            {files.length > 0 ? (
              <button
                type="button"
                className="row__action row__action--icone"
                onClick={onToggleFiles}
                aria-label={`Files changed (${String(files.length)})`}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 5.5h6l2 2h8v11H4z" />
                  <path d="M4 9h16" />
                </svg>
              </button>
            ) : null}
            {/*
              Changer de modèle ou de pensée est une **action** : un bouton
              discret dans l'en-tête, qui ouvre la feuille dédiée. La commande
              envoyée est `/model …` ou `/thinking …`, transmise par le même
              canal confirmé qu'un prompt (voir ModelSheet.tsx).
            */}
            {/*
              ⚠️ Le focus desktop est un **geste**, jamais un effet de bord de
              la navigation (C24). L'icône est un écran avec un curseur :
              « amener ce pane au premier plan sur le Mac ».
            */}
            <button
              type="button"
              className="row__action row__action--icone"
              aria-label="Focus this pane on the Mac"
              onClick={() => void focusDesktop()}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="13" rx="1.5" />
                <path d="M8 20h8M12 17v3" />
                <path d="m10 8 4 2.5-4 2.5z" />
              </svg>
            </button>
            <button
              type="button"
              className="row__action row__action--icone"
              aria-label="Model and thinking"
              onClick={() => {
                setShowFiles(false);
                setShowModel((value) => !value);
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42m-9.88 9.88-1.42 1.42" />
                <circle cx="12" cy="12" r="4" />
              </svg>
            </button>
          </header>
          {/*
            ⚠️ La barre est **sous l'en-tête**, pas au-dessus du composeur. Le
            bas de l'écran est la zone qu'on a stabilisée pour le clavier iOS et
            la taille du champ : y ajouter une barre aurait touché exactement ce
            qui vient d'être rendu prévisible.
          */}
          <TabPanes agents={voisins} courant={agent.paneId} onOpen={onOuvrirVoisin} />

          {error !== null ? <Notice ton="erreur">{error}</Notice> : null}
          {/*
            ⚠️ **Un fil incomplet se dit, sans effacer ce qui est lisible.** Une
            session momentanément illisible (agent `blocked`, incident, 502)
            laissait autrefois un écran vide ; ici les derniers messages connus
            restent à l'écran et cette mention explique pourquoi ils ne bougent
            plus. C'est une information, pas une erreur : la conversation est
            toujours consultable.
          */}
          {lecturePartielle === null ? null : <Notice ton="neutre">{lecturePartielle}</Notice>}
          {focusFeedback === null ? null : <Notice ton="neutre">{focusFeedback}</Notice>}

          {/*
            Une session vide n'est **pas** une panne.

            Herdr expose un `session_path` avant que Pi n'écrive le fichier : le
            JSONL naît au premier message. Le serveur répond donc `200` +
            `entries: []` — un succès, et traiter une session vide comme une erreur
            produirait un message rouge en boucle sur un agent qui démarre.

            Mais `ItemsView` rend `null` sur une liste vide : sans cet état,
            l'écran restait muet entre l'en-tête et le composeur, et rien ne
            distinguait « rien à afficher » d'un chargement bloqué.

            Aucun diagnostic n'est inventé : les deux causes possibles sont
            énoncées, et la charge utile reste utilisable.
          */}
          {phase === "ready" &&
          error === null &&
          messages.length === 0 &&
          envoisLocaux.length === 0 ? (
            <div className="messages__empty">
              <strong>No messages</strong>
              <p>
                Nothing to show for this agent yet. Some agents announce their session only once
                they have received their first message.
              </p>
              {/*
                ⚠️ **Les deux causes sont dites, et sur le même ton.** Cet écran
                affichait auparavant un **avis alarmant** quand Herdr n'exposait
                pas de chemin — « its conversation cannot be displayed or
                reconstructed » — pour exactement la même situation que ce
                panneau-ci, qui lui est neutre. Un agent qui vient de démarrer
                passait donc pour un agent cassé, alors que sa session apparaît
                dès qu'il a tourné.
              */}
              <p className="muted small">
                {agent.sessionPath === null
                  ? "Herdr does not expose a session for this agent — nothing is lost: this panel shows the conversation as soon as there is one."
                  : "If this agent has worked before, Herdr no longer exposes its session."}
              </p>
            </div>
          ) : null}

          <div className="messages" ref={scrollerRef} onScroll={onScroll}>
            <div className="messages__content" ref={contentRef}>
              {/*
                Le repère du **chargement paresseux** : invisible, il n'existe
                que pour l'observateur. Il précède le bouton, donc il est atteint
                en premier quand on remonte.

                ⚠️ Un `span`, pas un élément de bloc : la profondeur du fil est
                vérifiée par un test de structure qui compte les balises de
                bloc — une balise auto-fermante y décalerait toutes les
                profondeurs, et « composeur et fil sont frères » échouerait pour
                une raison sans rapport avec le composeur.
              */}
              <span className="messages__sentinel" ref={sentinelleRef} aria-hidden="true" />
              {previousCursor === null ? null : (
                <div className="history__older">
                  <button
                    type="button"
                    onClick={() => void chargerPrecedents()}
                    disabled={loadingPrevious}
                  >
                    {loadingPrevious ? "Loading history…" : "Load earlier messages"}
                  </button>
                  {previousError === null ? null : <p role="alert">{previousError}</p>}
                </div>
              )}
              <ItemsView enCours={aguiche} items={items} cwd={agent.cwd} />
              {/*
                  ⚠️ **Les envois en attente restent COLLÉS au bas du fil.**
              
                  Un message non encore pris en compte doit rester sous les yeux tant
                  qu'il n'a pas été accepté : s'il défile hors de vue, on ne sait plus
                  s'il est parti — et on le renvoie. Le `sticky` suffit : les envois sont
                  les derniers enfants du fil, donc ils se collent au bord bas du
                  conteneur défilant pendant qu'on remonte lire.
                */}
              <div className="envois">
                {envoisLocaux.map((message) => {
                  const status =
                    message.state === "queued"
                      ? "Queued…"
                      : message.state === "sending"
                        ? "Sending"
                        : message.state === "delivered"
                          ? "Received by Herdr"
                          : message.state === "uncertain"
                            ? "Delivery unconfirmed"
                            : "Send failed";
                  const interactive = message.state !== "delivered";
                  const open = messageOuvert === message.id;
                  return (
                    <article
                      key={message.id}
                      className={`bubble bubble--user optimistic optimistic--${message.state}`}
                    >
                      {interactive ? (
                        <button
                          type="button"
                          className="optimistic__tap"
                          aria-label={`${message.text}. Status: ${status}. Tap for options.`}
                          aria-expanded={open}
                          onClick={() => setMessageOuvert(open ? null : message.id)}
                        >
                          <span className="optimistic__text">{message.text}</span>
                          <span className="optimistic__status" aria-hidden="true">
                            {message.state === "queued" || message.state === "sending"
                              ? "◌"
                              : message.state === "failed"
                                ? "!"
                                : "?"}
                          </span>
                        </button>
                      ) : (
                        <>
                          <span className="optimistic__text">{message.text}</span>
                          <span className="optimistic__status" aria-label={status} title={status}>
                            ✓
                          </span>
                        </>
                      )}
                      {open ? (
                        <fieldset className="optimistic__menu" aria-label="Message status">
                          <strong>{status}</strong>
                          {message.detail === null ? null : (
                            <p className={message.state === "failed" ? "optimistic__error" : ""}>
                              {message.detail}
                            </p>
                          )}
                          {message.state === "queued" ? (
                            <button type="button" onClick={() => annulerEnvoi(message)}>
                              Cancel send
                            </button>
                          ) : null}
                          {message.state === "failed" || message.state === "uncertain" ? (
                            <button type="button" onClick={() => reessayerEnvoi(message)}>
                              {message.failureState === "inconnu"
                                ? "Retry (may send a duplicate)"
                                : "Retry"}
                            </button>
                          ) : null}
                          <button type="button" onClick={() => setMessageOuvert(null)}>
                            Cancel
                          </button>
                        </fieldset>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          </div>

          {openFile !== null ? (
            // La visionneuse est **au-dessus** de tout : elle ne peut pas être
            // recouverte par le composeur, contrairement à l'ancien panneau.
            <FileViewer
              path={openFile}
              onClose={() => {
                setOpenFile(null);
                setFromFiles(false);
              }}
              onBack={
                // Revenir d'un cran **seulement** si on vient de la liste.
                fromFiles
                  ? () => {
                      setOpenFile(null);
                      setShowFiles(true);
                    }
                  : undefined
              }
            />
          ) : showFiles ? (
            <FilesSheet
              files={files}
              cwd={agent.cwd}
              fermeture={fichierEnAttente !== null}
              onClose={fermerFichiers}
              onOpenFile={setFichierEnAttente}
            />
          ) : showModel ? (
            <ModelSheet
              agentName={agentName(agent)}
              kind={agent.agent ?? "pi"}
              currentModel={currentModel ?? réglagesSession.model}
              currentProvider={currentProvider ?? réglagesSession.provider}
              currentThinking={currentThinking ?? réglagesSession.thinking}
              paneId={agent.paneId}
              onClose={() => setShowModel(false)}
            />
          ) : null}

          {/*
            La question de l'agent, avec ses choix.

            ⚠️ **Hors du fil défilant**, comme le composeur : c'est une action à
            faire, pas un message à relire. Un agent bloqué qui attend une
            réponse doit l'avoir sous les yeux, pas au-dessus de 200 lignes.

            ⚠️ On ne fabrique aucun choix : les boutons sont **exactement** ceux
            lus à l'écran. Le serveur revalide de son côté.
          */}
          {/*
            ⚠️ **Avant la question**, et pas après : approuver un dossier est un
            préalable — tant qu'il n'est pas tranché, l'agent ne fera rien, et sa
            question éventuelle ne se posera pas.
          */}
          {trust === undefined ? null : <TrustCard onDone={() => undefined} request={trust} />}
          {question === undefined ? null : (
            <section className="question" aria-label="Agent question">
              <p className="question__texte">❓ {question.texte}</p>
              {question.contexte.length > 0 ? (
                <p className="question__contexte">{question.contexte.join(" · ")}</p>
              ) : null}
              <div className="question__choix">
                {question.choix.map((choix) => (
                  <button
                    key={choix.numero}
                    type="button"
                    className="question__choix-bouton"
                    disabled={envoiReponse}
                    onClick={() => {
                      /*
                        ⚠️ **L'option de saisie libre n'est pas envoyée.** La
                        choisir ouvre un champ texte chez opencode ; l'expédier
                        seule laisserait ce champ vide. On passe donc en mode
                        réponse : le composeur prend le relais, et l'envoi
                        expédie le choix et le texte ensemble.
                      */
                      if (estOptionSaisieLibre(choix.libelle)) {
                        setSaisieLibre(choix.numero);
                        setReponse(null);
                        champRef.current?.focus();
                        return;
                      }
                      void choisir(choix.numero);
                    }}
                  >
                    <span className="question__numero">{choix.numero}</span>
                    <span className="question__libelle">{choix.libelle}</span>
                    {choix.detail === undefined ? null : (
                      <span className="question__detail">{choix.detail}</span>
                    )}
                  </button>
                ))}
              </div>
              {saisieLibre === null ? null : (
                <p className="question__contexte">
                  Write your answer below, then send — the choice and the text go together.
                </p>
              )}
              {reponse === null ? null : (
                <p className={`question__reponse question__reponse--${reponse.state}`}>
                  {reponse.detail}
                </p>
              )}
            </section>
          )}

          {/*
            ⚠️ **Un agent bloqué sans question n'est pas un agent sans attente.**

            opencode pose ses questions en formulaires à plusieurs champs, puis
            affiche une étape **Review** dont l'écran n'a aucun choix numéroté.
            Il n'y a donc rien à cliquer — mais l'agent attend bel et bien, et
            l'écran restait muet : « agent marqué comme bloqué, mais plus de
            question ».

            On montre l'écran, **brut**, et on ne fabrique aucun choix à partir
            de lui : une touche inventée serait une décision que l'utilisateur
            n'a pas prise.
          */}
          {question !== undefined || waiting === undefined ? null : (
            <section
              className="question question--attente"
              aria-label="What the agent is waiting on"
            >
              <p className="question__texte">⏳ The agent is waiting</p>
              <p className="question__contexte">
                Its prompt is not a numbered question — there is nothing to choose here. This is
                what it shows:
              </p>
              <pre className="question__ecran">{waiting}</pre>
              <p className="question__contexte">
                Write your answer below and send: for a blocked agent, your message is typed into
                its prompt rather than sent as a new request.
              </p>
            </section>
          )}

          <div className="composer">
            <textarea
              ref={champRef}
              value={draft}
              onChange={onDraftChange}
              placeholder={placeholder}
              rows={1}
              onFocus={(event) => reprendreFocus(event.currentTarget)}
              onBlur={() =>
                window.setTimeout(() => {
                  setComposerFocused(false);
                  const field = champRef.current;
                  if (field) {
                    field.style.height = "";
                    field.style.overflowY = "auto";
                  }
                }, 0)
              }
            />
            {/*
              Bouton d'envoi **rond, avec une flèche** — la forme standard d'iOS.

              ⚠️ Il est **éteint quand le champ est vide** : c'est le
              comportement d'iOS, et il dit avant l'appui qu'il n'y a rien à
              envoyer. Un bouton actif qui ne fait rien laisse croire à une panne.
              Le libellé disparaît de l'écran mais reste lu : `aria-label`.
            */}
            {/*
              ⚠️ **Le bouton d'arrêt ne prend la place que si le champ est VIDE.**

              Avant, il remplaçait « envoyer » dès que l'agent travaillait. Il
              suffisait que le champ perde le focus pour que l'appui suivant
              **arrête l'agent** au lieu d'envoyer le message qu'on venait
              d'écrire — un message qu'on croyait parti, et une action qu'on
              n'avait pas demandée. Le texte présent dit ce qu'on veut faire :
              on envoie.
            */}
            {agent.status === "working" && !composerFocused && draft.trim().length === 0 ? (
              <button
                type="button"
                className="send send--stop"
                onClick={() => void interrompreAgent()}
                disabled={stopping}
                aria-label="Stop agent"
                title="Stop agent"
              >
                <span aria-hidden="true">■</span>
              </button>
            ) : (
              <button
                type="button"
                className="send"
                onClick={onSubmit}
                disabled={phase !== "ready" || sending || draft.trim().length === 0}
                aria-label="Send"
              >
                <span aria-hidden="true">↑</span>
              </button>
            )}
          </div>
          {stopFeedback === null ? null : <output className="sendState">{stopFeedback}</output>}
        </section>
      </FileOpenerContext.Provider>
    </UrlOpenerContext.Provider>
  );
};
