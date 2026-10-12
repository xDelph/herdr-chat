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
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentView, SendResult, SessionEntry } from "./api.ts";
import { fetchSession, sendPrompt, reportError } from "./api.ts";
import type { RenderedMessage } from "./blocks.ts";
import { toItems, toMessages, touchedFilesOf } from "./blocks.ts";
import { agentName, headerContext } from "./labels.tsx";
import { FileOpenerContext, ItemsView, UrlOpenerContext } from "./Blocks.tsx";
import { FilesSheet } from "./Files.tsx";
import { ModelSheet, describeSend } from "./ModelSheet.tsx";
import { FileViewer } from "./Viewer.tsx";
import { Notice } from "./Notice.tsx";

export const ChatScreen = ({ agent, onBack }: { agent: AgentView; onBack: () => void }) => {
  const [entries, setEntries] = useState<readonly SessionEntry[]>([]);
  /**
   * Messages déjà analysés.
   *
   * ⚠️ Analyser **toute** la conversation à chaque rafraîchissement coûtait un
   * `JSON.parse` et un décodage par entrée, toutes les 2 s. En incrémental, on
   * n'analyse que ce qui arrive.
   */
  const [messages, setMessages] = useState<readonly RenderedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Phase du chargement — nécessaire pour distinguer « vide » de « pas encore
   * chargé ». Un booléen `loading` ne le permet pas : les deux états ont la même
   * liste de messages, et le premier affichage serait un faux vide.
   */
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [lastSend, setLastSend] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const placeholder = `Message à ${agentName(agent)}…`;
  const files = touchedFilesOf(messages);
  const [showFiles, setShowFiles] = useState(false);
  const [showModel, setShowModel] = useState(false);
  /** Fichier ouvert dans la visionneuse plein écran. */
  const [openFile, setOpenFile] = useState<string | null>(null);
  /** `true` quand la visionneuse a été ouverte depuis la liste des fichiers. */
  const [fromFiles, setFromFiles] = useState(false);
  const onToggleFiles = useCallback(() => {
    setShowFiles((value) => !value);
    setShowModel(false);
  }, []);

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
        reportError("échec du chargement de session", { message, paneId: agent.paneId });
      } finally {
        loading.current = false;
      }
    },
    [agent.paneId],
  );

  useEffect(() => {
    cursor.current = null;
    void load("initial");
    const timer = setInterval(() => {
      void load("incremental");
    }, 2000);
    return () => clearInterval(timer);
  }, [load]);

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
    if (!atBottom.current) return;
    const el = scrollerRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const onDraftChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
  }, []);

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    try {
      const result = await sendPrompt(agent.paneId, text);
      setLastSend(result);
      if (result.kind === "sent") setDraft("");
    } catch (cause) {
      /*
        ⚠️ `sendPrompt` ne capture que les réponses illisibles : un `fetch` qui
        ne part pas lève, et le message resterait bloqué dans le composeur sans
        qu'aucune erreur ne s'affiche. La cause est montrée et journalisée.
      */
      const message = cause instanceof Error ? cause.message : String(cause);
      // Un `fetch` qui ne part pas est un état `inconnu` : rien ne prouve
      // que le message n'a pas atteint le serveur (B05).
      setLastSend({ kind: "failed", message, state: "inconnu" });
      reportError("échec de l'envoi du message", { message, paneId: agent.paneId });
    } finally {
      setSending(false);
    }
  }, [agent.paneId, draft, sending]);

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
            <button type="button" className="back" onClick={onBack} aria-label="Retour">
              ‹
            </button>
            <div className="screen__title">
              <strong>{agentName(agent)}</strong>
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
              <button type="button" className="row__action" onClick={onToggleFiles}>
                Fichiers
                {/*
                  Le compte est la première chose qui disparaît sous 360 px :
                  « Fichiers · 16 » et « Fichiers » occupent la même place, et
                  le titre — la seule information qui dise de quel agent il
                  s'agit — se réduisait à « herd… ». Le nombre reste lisible sur
                  l'écran de fichiers, qu'on ouvre de toute façon pour les
                  voir.
                */}
                <span className="chat__files-count"> · {files.length}</span>
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
              className="row__action"
              onClick={() => {
                setShowFiles(false);
                setShowModel((value) => !value);
              }}
            >
              Modèle
            </button>
          </header>

          {agent.sessionPath === null ? (
            <Notice ton="avertissement">
              Aucun chemin de session exposé par Herdr pour cet agent. Le contenu n'est pas
              affichable — et il n'est pas reconstruit artificiellement.
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
          messages.length === 0 ? (
            <div className="messages__empty">
              <strong>Aucun message</strong>
              <p>
                Rien à afficher pour cet agent. Une session est créée par Pi au premier
                message&nbsp;: envoyez-en un pour la démarrer.
              </p>
              <p className="muted small">
                Si cet agent a déjà travaillé, son fichier de session n'est plus exposé par Herdr.
              </p>
            </div>
          ) : null}

          <div className="messages" ref={scrollerRef} onScroll={onScroll}>
            <ItemsView items={toItems(messages)} />
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
              onClose={onToggleFiles}
              onOpenFile={(path) => {
                setShowFiles(false);
                // ⚠️ Sans ce drapeau, la visionneuse n'a pas de retour : « Fermer »
                // ferme tout et on perd la liste qu'on parcourait.
                setFromFiles(true);
                setOpenFile(path);
              }}
            />
          ) : showModel ? (
            <ModelSheet
              agentName={agentName(agent)}
              kind={agent.agent ?? "pi"}
              paneId={agent.paneId}
              onClose={() => setShowModel(false)}
            />
          ) : null}

          <div className="composer">
            <textarea value={draft} onChange={onDraftChange} placeholder={placeholder} rows={1} />
            {/*
              Bouton d'envoi **rond, avec une flèche** — la forme standard d'iOS.

              ⚠️ Il est **éteint quand le champ est vide** : c'est le
              comportement d'iOS, et il dit avant l'appui qu'il n'y a rien à
              envoyer. Un bouton actif qui ne fait rien laisse croire à une panne.
              Le libellé disparaît de l'écran mais reste lu : `aria-label`.
            */}
            <button
              type="button"
              className="send"
              onClick={onSubmit}
              disabled={sending || draft.trim().length === 0}
              aria-label="Envoyer"
            >
              <span aria-hidden="true">↑</span>
            </button>
          </div>

          {lastSend !== null ? <p className="sendState">{describeSend(lastSend)}</p> : null}
        </section>
      </FileOpenerContext.Provider>
    </UrlOpenerContext.Provider>
  );
};
