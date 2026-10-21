/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
/**
 * Depuis ta dernière visite — marqueur de lecture par session.
 *
 * Stocké localement. Au retour, n'affiche que ce qui a bougé (badge « nouveau »).
 */
import { useEffect, useState } from "react";
import { motion } from "./v2/motion.tsx";

const STORAGE_KEY = "herdr-last-visit";

interface Props {
  readonly paneId: string;
  readonly lastMessageAt: string | null;
}

export const SinceLastVisit = ({ lastMessageAt, paneId }: Props) => {
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    const key = `${STORAGE_KEY}-${paneId}`;
    const last = localStorage.getItem(key);
    if (last !== null && lastMessageAt !== null && lastMessageAt > last) {
      setIsNew(true);
    }
    if (lastMessageAt !== null) {
      localStorage.setItem(key, lastMessageAt);
    }
  }, [lastMessageAt, paneId]);

  if (!isNew) return null;

  return (
    <motion.span
      animate={{ opacity: 1, scale: 1 }}
      className="badge badge--new"
      initial={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.2 }}
    >
      New
    </motion.span>
  );
};
