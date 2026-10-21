/**
 * Marqueur de compaction — point de reprise dans l'historique.
 *
 * Sur une session longue, savoir où le contexte a été résumé évite de relire
 * dans le vide — et explique pourquoi un agent a « oublié » quelque chose.
 */
/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
import { motion } from "./v2/motion.tsx";

interface Props {
  readonly summary: string;
  readonly tokensBefore: number | null;
}

export const CompactionMarker = ({ summary, tokensBefore }: Props) => (
  <motion.div
    animate={{ opacity: 1 }}
    className="compaction-marker"
    initial={{ opacity: 0 }}
    transition={{ duration: 0.3 }}
  >
    <span className="compaction-marker__label">Context compacted</span>
    {tokensBefore !== null ? (
      <span className="muted small">({tokensBefore.toLocaleString()} tokens before)</span>
    ) : null}
    <p className="compaction-marker__summary">{summary}</p>
  </motion.div>
);
