/**
 * File d'attention — l'écran d'accueil transformé.
 *
 * Pour chaque agent `blocked`, affiche ce qu'il demande (dernier message
 * assistant) + réponses rapides (oui/non/continue) + champ libre.
 *
 * ⚠️ Les réponses rapides envoient via `agent.prompt` — aucun nouveau
 * mécanisme Herdr.
 */
import { useState } from "react";
/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
import { motion, AnimatePresence } from "./v2/motion.tsx";
import type { ConversationSummary } from "@herdr-remote/shared";

interface Props {
  readonly conversations: ReadonlyArray<ConversationSummary>;
  readonly onOpen: (paneId: string) => void;
  readonly onReply: (paneId: string, text: string) => void;
}

const QUICK_REPLIES = ["yes", "no", "continue"] as const;

export const AttentionQueue = ({ conversations, onOpen, onReply }: Props) => {
  const blocked = conversations.filter((c) => c.status === "blocked");
  if (blocked.length === 0) return null;

  return (
    <div className="attention-queue">
      <h3 className="section__label">Needs attention ({blocked.length})</h3>
      <AnimatePresence>
        {blocked.map((conv) => (
          <AttentionItem key={conv.paneId} conv={conv} onOpen={onOpen} onReply={onReply} />
        ))}
      </AnimatePresence>
    </div>
  );
};

const AttentionItem = ({
  conv,
  onOpen,
  onReply,
}: {
  conv: ConversationSummary;
  onOpen: (paneId: string) => void;
  onReply: (paneId: string, text: string) => void;
}) => {
  const [custom, setCustom] = useState("");

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="attention-item"
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
    >
      <button type="button" className="attention-item__title" onClick={() => onOpen(conv.paneId)}>
        {conv.title ?? conv.paneId}
      </button>
      {conv.lastPrompt !== undefined ? (
        <p className="attention-item__question">{conv.lastPrompt}</p>
      ) : null}
      <div className="attention-item__replies">
        {QUICK_REPLIES.map((reply) => (
          <button
            key={reply}
            type="button"
            className="attention-item__reply"
            onClick={() => onReply(conv.paneId, reply)}
          >
            {reply}
          </button>
        ))}
      </div>
      <div className="attention-item__custom">
        <input
          type="text"
          placeholder="Custom reply…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && custom.trim().length > 0) {
              onReply(conv.paneId, custom.trim());
              setCustom("");
            }
          }}
        />
      </div>
    </motion.div>
  );
};
