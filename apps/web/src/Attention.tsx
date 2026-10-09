/**
 * File d'attention — l'écran d'accueil.
 *
 * **Pourquoi cette vue existe.** Ouvrir sur une liste de projets oblige à
 * chercher ce qui attend. La question utile en mobilité est *« qu'est-ce qui
 * m'attend ? »*. Un agent `blocked` attend une réponse : on affiche **ce qu'il
 * demande** et on permet d'y répondre sans quitter l'écran.
 *
 * **D'où vient la question.** Du dernier texte écrit par l'agent, lu dans le
 * fichier de session. Aucun résumé n'est inventé : si l'agent n'a rien dit, on
 * l'annonce au lieu de fabriquer une question plausible.
 */
import { useCallback, useEffect, useState } from "react";
import { lastAssistantText, toMessages } from "./blocks.ts";
import { fetchSession, sendPrompt } from "./api.ts";
import type { AgentView, SendResult } from "./api.ts";

/** Réponses proposées : les cas les plus fréquents quand un agent est bloqué. */
const QUICK_REPLIES = ["oui", "non", "continue", "stop"] as const;

interface Props {
  readonly agent: AgentView;
  readonly onOpen: (paneId: string) => void;
}

export const AttentionCard = ({ agent, onOpen }: Props) => {
  const [question, setQuestion] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        const session = await fetchSession(agent.paneId, { tail: 262_144 });
        if (cancelled) return;
        setQuestion(lastAssistantText(toMessages(session.entries)) ?? null);
        setState("ready");
      } catch {
        if (cancelled) return;
        // La question est indisponible : on le dit, on n'invente rien.
        setQuestion(null);
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.paneId]);

  const reply = useCallback(
    (text: string) => {
      void (async () => {
        setSending(true);
        try {
          setResult(await sendPrompt(agent.paneId, text));
        } finally {
          setSending(false);
        }
      })();
    },
    [agent.paneId],
  );

  return (
    <article className="attention">
      <header className="attention__head">
        <button type="button" className="attention__open" onClick={() => onOpen(agent.paneId)}>
          <strong>{agent.workspaceLabel ?? agent.paneId}</strong>
          <span className="muted small">
            {agent.agent ?? "agent"} · {agent.paneId}
          </span>
        </button>
        <span className="sa__status sa__status--blocked">attend</span>
      </header>

      {state === "loading" ? <p className="muted small">Lecture de la demande…</p> : null}

      {state === "error" ? (
        <p className="blk__hint">
          Demande illisible — la session de cet agent n'a pas pu être lue.
        </p>
      ) : null}

      {state === "ready" && question === null ? (
        <p className="blk__hint">
          L'agent est bloqué mais n'a rien écrit. Ouvrir la conversation pour voir le terminal.
        </p>
      ) : null}

      {question !== null ? <p className="attention__question">{question}</p> : null}

      <div className="attention__replies">
        {QUICK_REPLIES.map((text) => (
          <button
            key={text}
            type="button"
            className="chip"
            disabled={sending}
            onClick={() => reply(text)}
          >
            {text}
          </button>
        ))}
      </div>

      {result !== null ? (
        <p className="sendState">
          {result.kind === "sent" && result.confirmation === "confirmed"
            ? "envoyé (confirmé)"
            : null}
          {result.kind === "sent" && result.confirmation === "unknown"
            ? "envoi effectué, confirmation incertaine"
            : null}
          {result.kind === "suppressed" ? `double envoi supprimé — ${result.reason}` : null}
          {result.kind === "failed" ? `échec : ${result.message}` : null}
        </p>
      ) : null}
    </article>
  );
};
