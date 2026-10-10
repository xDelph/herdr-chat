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
import { useState } from "react";
import { baseName, fileUrl, isImagePath, isTextPath } from "./api.ts";

interface Props {
  readonly files: ReadonlyArray<string>;
}

/** Affiche un fichier : image en ligne, texte en ligne, le reste téléchargeable. */
const FilePreview = ({ path }: { path: string }) => {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (isImagePath(path)) {
    return failed ? (
      <p className="blk__hint">
        Image indisponible — le fichier a peut-être été supprimé ou déplacé.
      </p>
    ) : (
      <a href={fileUrl(path)} rel="noreferrer" target="_blank">
        <img
          className="file__image"
          src={fileUrl(path)}
          alt={baseName(path)}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </a>
    );
  }

  if (!isTextPath(path)) {
    return (
      <a className="file__download" href={fileUrl(path)} download>
        télécharger
      </a>
    );
  }

  return (
    <>
      <button type="button" className="blk__toggle" onClick={() => setOpen((value) => !value)}>
        {open ? "masquer" : "voir"}
      </button>
      {open ? (
        // `src` plutôt que `fetch` : le navigateur affiche le texte brut, et le
        // serveur décide seul du type — un type inconnu est téléchargé.
        // `sandbox` vide : le contenu est rendu sans script, sans formulaire,
        // sans origine. Une sortie d'outil n'est pas une page de confiance.
        <iframe className="file__text" sandbox="" src={fileUrl(path)} title={baseName(path)} />
      ) : null}
    </>
  );
};

export const FilesPanel = ({ files }: Props) => {
  const [open, setOpen] = useState(false);

  if (files.length === 0) return null;

  // Les images d'abord : ce sont elles qu'on ne pouvait pas voir.
  const sorted = [...files].toSorted((a, b) => Number(isImagePath(b)) - Number(isImagePath(a)));

  return (
    <details className="files" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="blk__tag">fichiers</span>
        <span className="blk__hint">{files.length} touché(s)</span>
      </summary>
      <ul className="files__list">
        {sorted.map((path) => (
          <li key={path} className="file">
            <div className="file__head">
              <span className="file__name">{baseName(path)}</span>
              <span className="file__path mono small">{path}</span>
            </div>
            <FilePreview path={path} />
          </li>
        ))}
      </ul>
    </details>
  );
};
