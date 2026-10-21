/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
/**
 * Carte sous-agent — révèle l'angle mort.
 *
 * Affiche pour chaque sous-agent : agent, modèle, statut, fichiers modifiés,
 * résumé, auto-vérification, questions ouvertes. Les deux statuts divergents
 * (`status` et `digest.status`) sont affichés tels quels — masquer l'un des
 * deux serait mentir sur l'état réel.
 *
 * ⚠️ Le transcript complet n'existe pas localement : on affiche le résumé
 * structuré, jamais la conversation.
 */
import { motion } from "./v2/motion.tsx";
import { Notice } from "./Notice.tsx";
import type { SubagentResult } from "./blocks.ts";

interface Props {
  readonly result: SubagentResult;
}

export const SubagentCard = ({ result }: Props) => (
  <motion.div
    animate={{ opacity: 1, y: 0 }}
    className="subagent-card"
    initial={{ opacity: 0, y: 8 }}
    transition={{ duration: 0.2 }}
  >
    <div className="subagent-card__head">
      <strong>{result.agent}</strong>
      {result.model !== null ? <span className="muted small">{result.model}</span> : null}
      <span
        className={`dot dot--${result.status === "completed" ? "done" : result.status === "failed" ? "err" : "idle"}`}
      />
      <span className="small">{result.status}</span>
      {result.exitCode !== null ? (
        <span className="muted small">exit {result.exitCode}</span>
      ) : null}
    </div>
    {result.digest !== null ? (
      <div className="subagent-card__body">
        {result.digest.summary !== null ? (
          <p className="subagent-card__summary">{result.digest.summary}</p>
        ) : null}
        {result.digest.verified !== null ? (
          <p className="subagent-card__verified">
            <strong>Verified:</strong> {result.digest.verified}
          </p>
        ) : null}
        {result.digest.filesChanged.length > 0 ? (
          <p className="subagent-card__files">
            <strong>Files:</strong> {result.digest.filesChanged.join(", ")}
          </p>
        ) : null}
        {result.digest.questions !== null && result.digest.questions !== "none" ? (
          <p className="subagent-card__questions">
            <strong>Questions:</strong> {result.digest.questions}
          </p>
        ) : null}
        {result.digest.status !== null && result.digest.status !== result.status ? (
          <p className="muted small">
            digest status: {result.digest.status} (differs from agent status)
          </p>
        ) : null}
      </div>
    ) : null}
    {result.errorMessage !== null ? <Notice ton="erreur">{result.errorMessage}</Notice> : null}
  </motion.div>
);
