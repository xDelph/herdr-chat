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
import type { AgentView, AnswerResult, SessionEntry } from "./api.ts";
import {
  answerQuestion,
  fetchSession,
  sendPrompt,
  stopAgent,
  reportError,
  focusAgent,
} from "./api.ts";
import type { Question } from "@herdr-remote/shared";
import type { RenderedMessage } from "./blocks.ts";
import { toItems, toMessages, touchedFilesOf } from "./blocks.ts";
import { agentName, headerContext, statusClass } from "./labels.tsx";
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
}: {
  agent: AgentView;
  currentModel: string | undefined;
  currentProvider: string | undefined;
  currentThinking: string | undefined;
  onBack: () => void;
  /** Question posée à l'écran, quand l'agent en attend une. */
  question?: Question | undefined;
}) => {
  type EnvoiLocal = {
    readonly baseline: number;
    readonly detail: string | null;
    readonly failureState: "attente" | "erreur" | "inconnu" | null;
    readonly id: string;
    readonly state: "queued" | "sending" | "delivered" | "uncertain" | "failed";
    readonly text: string;
  };
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
  const [error, setError] = useState<string | null>(null);
  /**
   * Phase du chargement — nécessaire pour distinguer « vide » de « pas encore
   * chargé ». Un booléen `loading` ne le permet pas : les deux états ont la même
   * liste de messages, et le premier affichage serait un faux vide.
   */
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  /** Champ de saisie, pour lui rendre sa taille après un envoi. */
  const champRef = useRef<HTMLTextAreaElement | null>(null);
  const [sending, setSending] = useState(false);
  const [envoisLocaux, setEnvoisLocaux] = useState<readonly EnvoiLocal[]>([]);
  const [messageOuvert, setMessageOuvert] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopFeedback, setStopFeedback] = useState<string | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Plafond de pages vides remontées d'affilée avant d'abandonner.
   *
   * ⚠️ Le serveur peut rendre une page vide **en avançant le curseur** (une ligne
   * plus grande que la fenêtre). Sans plafond, on lirait le fichier entier sur un
   * seul appui ; sans continuité, le bouton ne ferait rien du tout.
   */
  const PAGES_VIDES_MAX = 8;

  const nextLocalId = useRef(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const placeholder = `Message ${agentName(agent)}…`;
  const files = touchedFilesOf(messages);
  const [showFiles, setShowFiles] = useState(false);
  const [fichierEnAttente, setFichierEnAttente] = useState<string | null>(null);
  const [showModel, setShowModel] = useState(false);
  /** Fichier ouvert dans la visionneuse plein écran. */
  const [openFile, setOpenFile] = useState<string | null>(null);
  /** `true` quand la visionneuse a été ouverte depuis la liste des fichiers. */
  const [fromFiles, setFromFiles] = useState(false);

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
  const autoLoadedPrevious = useRef(false);

  const load = useCallback(
    async (mode: "initial" | "incremental") => {
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

        if (session.incremental) {
          if (session.entries.length > 0) {
            // Analyse des seules entrées nouvelles.
            const added = toMessages(session.entries);
            setEntries((current) => [...current, ...session.entries]);
            setMessages((current) => [...current, ...added]);
          }
        } else {
          setEntries(session.entries);
          setMessages(toMessages(session.entries));
        }
        // `reset` signifie que le curseur ne décrivait plus ce fichier :
        // rotation, troncature, ou session relue depuis la fin. Les entrées
        // reçues **remplacent** la vue, sans quoi l'écran montrerait des
        // messages qui ne sont plus dans le fichier.
        if (session.reset) {
          setEntries(session.entries);
          setMessages(toMessages(session.entries));
          setPhase("ready");
        }
        setError(null);
        setPhase("ready");
      } catch (cause) {
        // La cause réelle est affichée : pas de message générique qui masque.
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setPhase("error");
        reportError("échec du chargement de session", {
          message,
          paneId: agent.paneId,
        });
      } finally {
        loading.current = false;
      }
    },
    [agent.paneId],
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
    autoLoadedPrevious.current = false;
    setPreviousCursor(null);
    void load("initial");
    // `setTimeout` en cascade plutôt que `setInterval` : la cadence est relue à
    // chaque tour, donc elle suit le statut sans que l'effet en dépende.
    const cadence = () => (statutRef.current === "working" ? 750 : 2000);
    let timer = 0;
    const tour = () => {
      void load("incremental");
      timer = window.setTimeout(tour, cadence());
    };
    timer = window.setTimeout(tour, cadence());
    return () => window.clearTimeout(timer);
  }, [load]);

  /*
    On **acquitte** la réponse en posant le focus sur le pane.

    ⚠️ **Un seul effet, et rien à relâcher** — le mécanisme est une action, pas
    un état. `agent.focus` fait passer un `done` à `idle` ; il n'existe aucun
    « je ne regarde plus » à envoyer. Toute la mécanique de relâchement qui
    précédait n'existait que parce que `agent.view.set` était un état — et elle
    pouvait relâcher après avoir acquitté, laissant l'agent `done` pour toujours.

    ⚠️ On la refait à chaque changement de statut : une réponse qui arrive
    **pendant** qu'on regarde la conversation doit être acquittée aussi.
  */
  useEffect(() => {
    void focusAgent(agent.paneId);
  }, [agent.paneId, agent.status]);

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
        const precedents = toMessages(entriesAnterieures);
        setEntries((current) => [...entriesAnterieures, ...current]);
        setMessages((current) => [...precedents, ...current]);
      }
      setPreviousCursor(pageCursor);
    } catch (cause) {
      setPreviousError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loading.current = false;
      setLoadingPrevious(false);
    }
  }, [agent.paneId, loadingPrevious, previousCursor]);

  useEffect(() => {
    if (previousCursor === null || autoLoadedPrevious.current) return undefined;
    let timer = 0;
    const loadWhenIdle = () => {
      // A poll can begin between the initial page arriving and this effect
      // running. Keep waiting instead of consuming the one automatic attempt.
      if (loading.current) {
        timer = window.setTimeout(loadWhenIdle, 100);
        return;
      }
      autoLoadedPrevious.current = true;
      void chargerPrecedents();
    };
    timer = window.setTimeout(loadWhenIdle, 0);
    return () => window.clearTimeout(timer);
  }, [chargerPrecedents, previousCursor]);

  /**
   * Défilement automatique — **conditionnel**.
   *
   * Avant, chaque arrivée de message déclenchait un `scrollIntoView` animé.
   * Pendant la saisie, l'animation se battait avec le clavier iOS et le
   * défilement partait en vrille. On ne défile donc que si l'utilisateur est
   * déjà en bas, et **sans animation** : un saut instantané ne se bat avec rien.
   */
  const atBottom = useRef(true);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    // 48 px de tolérance : un doigt sur un écran ne vise pas le pixel.
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
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
    suivreLeBas();
    return () => observer.disconnect();
  }, []);

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
  const ajusterHauteur = (field: HTMLTextAreaElement): void => {
    field.style.height = "auto";
    const maximum = LINE_HEIGHT * MAX_LIGNES;
    field.style.height = `${String(Math.min(field.scrollHeight, maximum))}px`;
    field.style.overflowY = field.scrollHeight > maximum ? "auto" : "hidden";
  };

  const onDraftChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    ajusterHauteur(event.target);
  }, []);

  const transmettre = useCallback(
    async (id: string, text: string) => {
      setEnvoisLocaux((current) =>
        current.map((message) =>
          message.id === id
            ? { ...message, detail: null, failureState: null, state: "sending" }
            : message,
        ),
      );
      try {
        const result = await sendPrompt(agent.paneId, text);
        setEnvoisLocaux((current) =>
          current.map((message) => {
            if (message.id !== id) return message;
            if (result.kind === "suppressed") {
              return {
                ...message,
                detail: `Herdr avait déjà confirmé un envoi identique : ${result.reason}`,
                state: "delivered",
              };
            }
            if (result.kind === "sent") {
              return {
                ...message,
                detail:
                  result.confirmation === "confirmed"
                    ? "Herdr confirmed that it received the message."
                    : "Herdr did not confirm whether it received the message.",
                state: result.confirmation === "confirmed" ? "delivered" : "uncertain",
              };
            }
            return {
              ...message,
              detail: result.message,
              failureState: result.state,
              state: "failed",
            };
          }),
        );
        if (result.kind === "failed") {
          reportError("échec de l'envoi du message", {
            message: result.message,
            paneId: agent.paneId,
            state: result.state,
          });
        }
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        setEnvoisLocaux((current) =>
          current.map((message) =>
            message.id === id
              ? { ...message, detail, failureState: "inconnu", state: "failed" }
              : message,
          ),
        );
        reportError("échec de l'envoi du message", {
          detail,
          paneId: agent.paneId,
        });
      } finally {
        setSending(false);
      }
    },
    [agent.paneId],
  );

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    const id = `local-${String(Date.now())}-${String(++nextLocalId.current)}`;
    const baseline = messages.filter(
      (message) => message.role === "user" && message.text === text,
    ).length;
    setEnvoisLocaux((current) => [
      ...current,
      { baseline, detail: null, failureState: null, id, state: "queued", text },
    ]);
    setSending(true);
    setMessageOuvert(null);
    setDraft("");
    if (champRef.current !== null) {
      champRef.current.value = "";
      ajusterHauteur(champRef.current);
    }
    // La bulle apparaît immédiatement et reste annulable avant tout appel réseau.
    sendTimer.current = setTimeout(() => {
      sendTimer.current = null;
      void transmettre(id, text);
    }, 900);
  }, [draft, messages, sending, transmettre]);

  useEffect(
    () => () => {
      if (sendTimer.current !== null) clearTimeout(sendTimer.current);
    },
    [],
  );

  useEffect(() => {
    const messagesUtilisateur = messages.filter((message) => message.role === "user");
    setEnvoisLocaux((current) => {
      const restants = new Map<string, number>();
      for (const message of messagesUtilisateur) {
        restants.set(message.text, (restants.get(message.text) ?? 0) + 1);
      }
      const next: EnvoiLocal[] = [];
      for (const local of current) {
        const count = restants.get(local.text) ?? 0;
        if (count > local.baseline) {
          restants.set(local.text, count - 1);
          continue;
        }
        next.push(local);
      }
      return next;
    });
  }, [messages]);

  const annulerEnvoi = useCallback((message: EnvoiLocal) => {
    if (message.state !== "queued") return;
    if (sendTimer.current !== null) clearTimeout(sendTimer.current);
    sendTimer.current = null;
    setEnvoisLocaux((current) => current.filter((candidate) => candidate.id !== message.id));
    setMessageOuvert(null);
    setDraft(message.text);
    setSending(false);
    requestAnimationFrame(() => {
      if (champRef.current !== null) {
        champRef.current.value = message.text;
        ajusterHauteur(champRef.current);
      }
    });
  }, []);

  const reessayerEnvoi = useCallback(
    (message: EnvoiLocal) => {
      if (message.state !== "failed" && message.state !== "uncertain") return;
      setMessageOuvert(null);
      setSending(true);
      void transmettre(message.id, message.text);
    },
    [transmettre],
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
      reportError("échec de l'interruption d'un agent", {
        detail,
        paneId: agent.paneId,
      });
    } finally {
      setStopping(false);
    }
  }, [agent.paneId, stopping]);

  /** État de la dernière réponse à une question, pour ne jamais mentir dessus. */
  const [reponse, setReponse] = useState<AnswerResult | null>(null);
  const [envoiReponse, setEnvoiReponse] = useState(false);

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
              */}
              <strong>{agent.title ?? agentName(agent)}</strong>
              {/*
                Le statut **en tete** : la ligne est tronquée à l'ellipse sur
                un écran étroit, et « onglet 1 · pi · devcli-private » se coupe
                avant d'arriver au statut — qui est la seule information encore
                utile quand le reste a disparu.
              */}
              <div className="muted small">{headerContext(agent)}</div>
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

          {agent.sessionPath === null ? (
            <Notice ton="avertissement">
              Herdr does not expose a session path for this agent. Its conversation cannot be
              displayed or reconstructed.
            </Notice>
          ) : null}

          {error !== null ? <Notice ton="erreur">{error}</Notice> : null}

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
          agent.sessionPath !== null &&
          messages.length === 0 &&
          envoisLocaux.length === 0 ? (
            <div className="messages__empty">
              <strong>No messages</strong>
              <p>
                Nothing to show for this agent. Pi creates a session when it receives its first
                message.
              </p>
              <p className="muted small">
                If this agent has worked before, Herdr no longer exposes its session file.
              </p>
            </div>
          ) : null}

          <div className="messages" ref={scrollerRef} onScroll={onScroll}>
            <div className="messages__content" ref={contentRef}>
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
              <ItemsView
                enCours={agent.status === "working"}
                items={toItems(messages, agent.status === "working")}
                cwd={agent.cwd}
              />
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
              {reponse === null ? null : (
                <p className={`question__reponse question__reponse--${reponse.state}`}>
                  {reponse.detail}
                </p>
              )}
            </section>
          )}

          <div className="composer">
            <textarea
              ref={champRef}
              value={draft}
              onChange={onDraftChange}
              placeholder={placeholder}
              rows={1}
              onFocus={() => setComposerFocused(true)}
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
