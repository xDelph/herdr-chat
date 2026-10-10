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
import { baseName, isImagePath } from "./api.ts";

interface Props {
  readonly files: ReadonlyArray<string>;
}

export const FilesSheet = ({
  files,
  onClose,
  onOpenFile,
}: Props & { readonly onClose: () => void; readonly onOpenFile: (path: string) => void }) => {
  if (files.length === 0) return null;

  // Les images d'abord : ce sont elles qu'on ne pouvait pas voir.
  const sorted = [...files].toSorted((a, b) => Number(isImagePath(b)) - Number(isImagePath(a)));

  return (
    <div className="sheet">
      <header className="sheet__head">
        <strong>Fichiers touchés</strong>
        <span className="muted small">
          {files.length} fichier{files.length > 1 ? "s" : ""}
        </span>
        <button type="button" className="ghost" onClick={onClose}>
          Fermer
        </button>
      </header>
      <ul className="files__list">
        {sorted.map((path) => (
          <li key={path} className="file">
            {/* Ouvre la visionneuse **dans** l'application, jamais un onglet. */}
            <button type="button" className="file__open" onClick={() => onOpenFile(path)}>
              <span className="file__name">{baseName(path)}</span>
              <span className="file__path mono small">{path}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
