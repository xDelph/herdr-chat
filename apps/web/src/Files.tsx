/**
 * Fichiers touchés par un agent, ouvrables depuis le téléphone.
 *
 * **Pourquoi.** Un agent produit des captures, des rapports, des images. Ils
 * vivent sur le Mac et étaient **inaccessibles** : le backend ne servait que le
 * build de la PWA. Un sous-agent a même passé une tâche entière à *décrire* une
 * capture d'écran, faute de pouvoir la montrer.
 *
 * Les chemins viennent des appels `edit` / `write` de la session. Le serveur
 * vérifie qu'ils sont bien sous un dossier de projet — un chemin hors de là est
 * refusé, pas servi.
 */
import { baseName } from "./api.ts";
import type { TouchedFile } from "./blocks.ts";
import { relativeWorkspacePath } from "./blocks.ts";
import { Feuille } from "./Feuille.tsx";

interface Props {
  readonly files: ReadonlyArray<TouchedFile>;
  readonly fermeture?: boolean;
  readonly cwd: string | null | undefined;
}

/** Diff compact, tel qu'il a été appliqué. */
const DiffView = ({ file }: { file: TouchedFile }) => (
  <>
    {file.edits.slice(0, 6).map((edit, index) => (
      <div key={`${file.path}-${String(index)}`} className="diff">
        {edit.oldText.split("\n").map((line, lineIndex) => (
          <div key={`o${String(lineIndex)}`} className="diff__line diff__line--del">
            <span className="diff__sign">−</span>
            {line}
          </div>
        ))}
        {edit.newText.split("\n").map((line, lineIndex) => (
          <div key={`n${String(lineIndex)}`} className="diff__line diff__line--add">
            <span className="diff__sign">+</span>
            {line}
          </div>
        ))}
      </div>
    ))}
    {file.edits.length > 6 ? (
      <p className="blk__hint">{file.edits.length - 6} additional edit(s)</p>
    ) : null}
    {file.edits.length === 0 ? (
      <p className="blk__hint">Full file write — open the file to view its contents</p>
    ) : null}
  </>
);

export const FilesSheet = ({
  files,
  cwd,
  onClose,
  onOpenFile,
  fermeture,
}: Props & {
  readonly onClose: () => void;
  readonly onOpenFile: (path: string) => void;
}) => {
  if (files.length === 0) return null;

  // Les modifications les plus lourdes d'abord.
  const sorted = [...files].toSorted((a, b) => b.added + b.removed - (a.added + a.removed));

  return (
    <Feuille
      ariaLabel="Files changed"
      onClose={onClose}
      {...(fermeture === undefined ? {} : { fermeture })}
      titre={
        <>
          Files changed
          <span className="muted small">
            {files.length} file{files.length > 1 ? "s" : ""}
          </span>
        </>
      }
    >
      <ul className="files__list">
        {sorted.map((file) => (
          <li key={file.path} className="file">
            {/*
              Le **diff** d'abord : c'est ce qui a changé, et c'est la question
              qu'on se pose devant une liste de fichiers modifiés. Le fichier
              entier reste accessible, mais en second.
            */}
            <details className="file__details">
              <summary className="file__head">
                <span className="file__name">
                  {relativeWorkspacePath(file.path, cwd) || baseName(file.path)}
                </span>
                <span className="file__stats small">
                  <span className="stat stat--add">+{file.added}</span>
                  <span className="stat stat--del">−{file.removed}</span>
                </span>
              </summary>
              <DiffView file={file} />
              <button type="button" className="blk__toggle" onClick={() => onOpenFile(file.path)}>
                Open full file
              </button>
            </details>
          </li>
        ))}
      </ul>
    </Feuille>
  );
};
