/**
 * Galerie d'images, rendue **dans l'application**.
 *
 * Deux raisons de ne pas ouvrir un nouvel onglet :
 * 1. sur iPhone, un onglet ouvert depuis une PWA installée en sort, et il faut
 *    revenir à la main ;
 * 2. une capture qu'on veut comparer à une autre se regarde **à côté** de
 *    l'application, pas à sa place.
 *
 * Tap sur une image : superposition plein écran. Tap à nouveau : fermeture.
 */
import { useCallback, useState } from "react";
import { baseName, fileUrl } from "./api.ts";

interface Props {
  readonly paths: ReadonlyArray<string>;
  /** Titre de section, optionnel. */
  readonly title?: string;
}

export const Gallery = ({ paths, title = "Captures" }: Props) => {
  const [zoomed, setZoomed] = useState<string | null>(null);
  const close = useCallback(() => setZoomed(null), []);

  if (paths.length === 0) {
    return <p className="muted small">Aucune image.</p>;
  }

  return (
    <div className="gallery">
      {title.length > 0 ? <h2>{title}</h2> : null}
      <div className="gallery__grid">
        {paths.map((path) => (
          <button
            key={path}
            type="button"
            className="gallery__item"
            aria-label={`Agrandir ${baseName(path)}`}
            onClick={() => setZoomed(path)}
          >
            <img
              className="gallery__thumb"
              src={fileUrl(path)}
              alt={baseName(path)}
              loading="lazy"
            />
            <span className="gallery__caption">{baseName(path)}</span>
          </button>
        ))}
      </div>

      {zoomed !== null ? (
        // Superposition dans l'application, jamais un onglet.
        // Un vrai `button` plein écran plutôt qu'un `div` avec un rôle : le
        // clavier, le focus et les lecteurs d'écran fonctionnent sans effort.
        <button type="button" className="zoom" onClick={close}>
          <img className="zoom__image" src={fileUrl(zoomed)} alt={baseName(zoomed)} />
          <span className="zoom__hint">toucher pour fermer</span>
        </button>
      ) : null}
    </div>
  );
};
