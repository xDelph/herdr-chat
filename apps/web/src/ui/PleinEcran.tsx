/**
 * La visionneuse plein écran : l'image entière sur fond noir.
 *
 * - un appui sur l'image bascule entre « tient dans l'écran » et la taille
 *   réelle, qu'on parcourt du doigt ;
 * - le bouton fermer, Échap, ou un appui à côté de l'image ferment.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pleinEcran } from "../app/services.ts";
import { Icone } from "./Icone.tsx";

export const PleinEcran = () => {
  const image = useSyncExternalStore(pleinEcran.souscrire, pleinEcran.lit);
  const [reelle, setReelle] = useState(false);
  const fermer = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setReelle(false);
    if (image === null) return undefined;
    fermer.current?.focus();
    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") pleinEcran.ferme();
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [image]);

  if (image === null) return null;
  return (
    <dialog
      open
      className={reelle ? "plein-ecran plein-ecran--reelle" : "plein-ecran"}
      aria-modal="true"
      aria-label={image.legende}
    >
      {/* L'appui à côté de l'image ferme ; l'image, elle, bascule le zoom. */}
      <button
        type="button"
        className="plein-ecran__fond"
        aria-label="Fermer l'image"
        tabIndex={-1}
        onClick={() => pleinEcran.ferme()}
      />
      <div className="plein-ecran__cadre">
        <button
          type="button"
          className="plein-ecran__image"
          onClick={() => setReelle((valeur) => !valeur)}
          aria-label={reelle ? "Ajuster à l'écran" : "Taille réelle"}
        >
          <img src={image.source} alt={image.legende} />
        </button>
      </div>
      <button
        type="button"
        ref={fermer}
        className="plein-ecran__fermer"
        aria-label="Fermer"
        onClick={() => pleinEcran.ferme()}
      >
        <Icone nom="x" />
      </button>
    </dialog>
  );
};
