/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
/**
 * Recherche dans toutes les sessions — côté serveur.
 *
 * Les sessions font jusqu'à 12 Mo : la recherche se fait côté serveur, pas
 * côté client. Résultats avec lien vers la conversation et le message.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "./v2/motion.tsx";

interface SearchResult {
  readonly paneId: string;
  readonly snippet: string;
  readonly title: string | null;
}

interface Props {
  readonly onOpen: (paneId: string) => void;
  readonly onSearch: (query: string) => Promise<ReadonlyArray<SearchResult>>;
}

export const SearchBar = ({ onOpen, onSearch }: Props) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<SearchResult>>([]);
  const [loading, setLoading] = useState(false);

  const search = async (q: string) => {
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const r = await onSearch(q.trim());
      setResults(r);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-bar">
      <input
        type="search"
        placeholder="Search conversations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void search(query);
        }}
      />
      {loading ? <span className="muted small">Searching…</span> : null}
      <AnimatePresence>
        {results.length > 0 ? (
          <motion.ul
            animate={{ opacity: 1, y: 0 }}
            className="search-results"
            initial={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
          >
            {results.map((r) => (
              <motion.li
                animate={{ opacity: 1, x: 0 }}
                initial={{ opacity: 0, x: 8 }}
                key={r.paneId}
                transition={{ duration: 0.15 }}
              >
                <button type="button" onClick={() => onOpen(r.paneId)}>
                  <strong>{r.title ?? r.paneId}</strong>
                  <span className="muted small">{r.snippet}</span>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
};
