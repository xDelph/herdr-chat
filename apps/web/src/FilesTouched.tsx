/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
/**
 * Fichiers touchés par un agent — avec leurs diffs.
 *
 * Affiche ce qui a changé, pas le fichier entier. Agrégation depuis les appels
 * `edit`/`write` de la session.
 */
import { motion } from "./v2/motion.tsx";
import type { RenderedMessage } from "./blocks.ts";
import { touchedFilesOf } from "./blocks.ts";

interface Props {
  readonly messages: ReadonlyArray<RenderedMessage>;
  readonly onOpenFile: (path: string) => void;
}

export const FilesTouched = ({ messages, onOpenFile }: Props) => {
  const files = touchedFilesOf(messages);
  if (files.length === 0) return null;

  const sorted = [...files].toSorted((a, b) => b.added + b.removed - (a.added + a.removed));

  return (
    <div className="files-touched">
      <h3 className="section__label">Files touched ({files.length})</h3>
      <ul className="files__list">
        {sorted.map((file) => (
          <motion.li
            animate={{ opacity: 1, x: 0 }}
            className="file"
            exit={{ opacity: 0, x: -8 }}
            initial={{ opacity: 0, x: 8 }}
            key={file.path}
            transition={{ duration: 0.15 }}
          >
            <div className="file__head">
              <span className="file__name">{file.path}</span>
              <span className="file__stats small">
                <span className="stat stat--add">+{file.added}</span>
                <span className="stat stat--del">−{file.removed}</span>
              </span>
            </div>
            <button type="button" className="blk__toggle" onClick={() => onOpenFile(file.path)}>
              Open full file
            </button>
          </motion.li>
        ))}
      </ul>
    </div>
  );
};
