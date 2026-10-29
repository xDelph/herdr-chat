/**
 * La visionneuse plein écran : l'image entière sur fond noir.
 *
 * - un appui sur l'image bascule entre « tient dans l'écran » et la taille
 *   réelle, qu'on parcourt du doigt ;
 * - le bouton fermer, Échap, ou un appui à côté de l'image ferment.
 *
 * ⚠️ **Modale pour de vrai** (`showModal`) : avec l'attribut `open` seul, le
 * reste de la page restait atteignable au clavier et au lecteur d'écran
 * derrière l'image. `showModal` rend le fond inerte et garde le focus dedans.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pleinEcran } from "../app/services.ts";
import { Icone } from "./Icone.tsx";

export const PleinEcran = () => {
  const image = useSyncExternalStore(pleinEcran.souscrire, pleinEcran.lit);
  const [reelle, setReelle] = useState(false);
  const fermer = useRef<HTMLButtonElement | null>(null);
  const boite = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    setReelle(false);
    const dialogue = boite.current;
    if (image === null || dialogue === null) return undefined;
    if (!dialogue.open) {
      // `showModal` absent (très vieux navigateur) : l'ouverture simple reste.
      if (typeof dialogue.showModal === "function") dialogue.showModal();
      else dialogue.setAttribute("open", "");
    }
    fermer.current?.focus();
    return () => {
      if (dialogue.open) dialogue.close();
    };
  }, [image]);

  if (image === null) return null;
  return (
    <dialog
      ref={boite}
      className={reelle ? "plein-ecran plein-ecran--reelle" : "plein-ecran"}
      aria-label={image.legende}
      // Échap : le navigateur annule la modale ; on ferme par le magasin.
      onCancel={(evenement) => {
        evenement.preventDefault();
        pleinEcran.ferme();
      }}
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
