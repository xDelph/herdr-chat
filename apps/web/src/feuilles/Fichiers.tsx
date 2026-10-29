/**
 * Les fichiers touchés par la session, avec leurs diffs.
 *
 * ⚠️ **Lu dans la session, pas dans le dépôt.** Ce sont les écritures que
 * l'agent a déclarées ; l'état réel du fichier peut différer (une autre main,
 * un `git checkout`). La feuille le dit.
 */
import { useState } from "react";
import { relativeWorkspacePath, type TouchedFile } from "../blocks.ts";
import { Diff } from "../chat/Outils.tsx";
import { Feuille } from "../ui/Feuille.tsx";
import { Icone } from "../ui/Icone.tsx";

const Fichier = ({
  fichier,
  cwd,
  onOuvrir,
}: {
  readonly fichier: TouchedFile;
  readonly cwd: string | null;
  readonly onOuvrir: (chemin: string) => void;
}) => {
  const [ouvert, setOuvert] = useState(false);
  return (
    <li className="fichier">
      <div className="fichier__ligne">
        <button
          type="button"
          className="fichier__nom"
          aria-expanded={ouvert}
          onClick={() => setOuvert((valeur) => !valeur)}
        >
          <Icone nom={ouvert ? "down" : "chev"} petite />
          <span className="mono">{relativeWorkspacePath(fichier.path, cwd)}</span>
          <span className="fichier__delta num">
            <span className="plus">+{fichier.added}</span>{" "}
            <span className="moins">−{fichier.removed}</span>
          </span>
        </button>
        <button
          type="button"
          className="bouton-icone"
          aria-label={`Open ${fichier.path}`}
          onClick={() => onOuvrir(fichier.path)}
        >
          <Icone nom="file" petite />
        </button>
      </div>
      {ouvert ? (
        fichier.edits.length > 0 ? (
          <Diff editions={fichier.edits.slice(0, 6)} />
        ) : (
          <p className="discret">Full rewrite — open the file to read it.</p>
        )
      ) : null}
    </li>
  );
};

export const Fichiers = ({
  fichiers,
  cwd,
  onClose,
  onOuvrir,
}: {
  readonly fichiers: ReadonlyArray<TouchedFile>;
  readonly cwd: string | null;
  readonly onClose: () => void;
  readonly onOuvrir: (chemin: string) => void;
}) => (
  <Feuille titre="Changed files" onClose={onClose}>
    {fichiers.length === 0 ? (
      <p className="discret">No writes in the loaded part of the session.</p>
    ) : (
      <ul className="fichiers">
        {fichiers.map((fichier) => (
          <Fichier key={fichier.path} fichier={fichier} cwd={cwd} onOuvrir={onOuvrir} />
        ))}
      </ul>
    )}
    <p className="discret">
      Based on the tools declared in the loaded session — not a read of the repository.
    </p>
  </Feuille>
);
