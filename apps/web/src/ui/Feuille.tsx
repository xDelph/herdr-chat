/**
 * Feuille du bas — un vrai `<dialog>` modal.
 *
 * ⚠️ **Pourquoi `<dialog>` et plus un piège à focus maison.** La revue du
 * 2026-10-17 l'a relevé : l'ancienne feuille annonçait `aria-modal` sans rendre
 * le fond inerte, et le cycle de tabulation était refait à la main. `showModal`
 * fait les trois correctement — fond inerte, Échap, retour du focus — et le
 * navigateur le teste mieux que nous.
 *
 * Fermeture : Échap (`cancel`), appui sur le voile (clic hors de la feuille),
 * ou le bouton « Close ».
 */
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { ouvreDialogue } from "../dialogue.ts";
import { SousLeCorps } from "./portail.tsx";
import { Icone } from "./Icone.tsx";

export const Feuille = ({
  titre,
  onClose,
  children,
  retour,
  large = false,
}: {
  readonly titre: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Bouton de retour à gauche du titre (visionneuse → fichiers). */
  readonly retour?: { readonly libelle: string; readonly action: () => void } | undefined;
  readonly large?: boolean;
}) => {
  const ref = useRef<HTMLDialogElement | null>(null);
  const fermer = useRef(onClose);
  useLayoutEffect(() => {
    fermer.current = onClose;
  });
  const idTitre = useId();

  useEffect(() => {
    const dialogue = ref.current;
    if (dialogue === null) return undefined;
    ouvreDialogue(dialogue);
    const surAnnulation = (evenement: Event) => {
      evenement.preventDefault();
      fermer.current();
    };
    // Un clic dont la cible est le <dialog> lui-même tombe sur le voile.
    const surClic = (evenement: MouseEvent) => {
      if (evenement.target === dialogue) fermer.current();
    };
    dialogue.addEventListener("cancel", surAnnulation);
    dialogue.addEventListener("click", surClic);
    return () => {
      dialogue.removeEventListener("cancel", surAnnulation);
      dialogue.removeEventListener("click", surClic);
      if (dialogue.open) dialogue.close();
    };
  }, []);

  return (
    <SousLeCorps>
      <dialog
        ref={ref}
        className={large ? "feuille feuille--large" : "feuille"}
        aria-labelledby={idTitre}
      >
        <div className="feuille__corps">
          <div className="feuille__poignee" aria-hidden="true" />
          <header className="feuille__tete">
            {retour === undefined ? null : (
              <button
                type="button"
                className="bouton-icone"
                onClick={retour.action}
                aria-label={retour.libelle}
              >
                <Icone nom="back" />
              </button>
            )}
            <h2 id={idTitre}>{titre}</h2>
            <button type="button" className="bouton-icone" onClick={onClose} aria-label="Close">
              <Icone nom="x" />
            </button>
          </header>
          <div className="feuille__contenu">{children}</div>
        </div>
      </dialog>
    </SousLeCorps>
  );
};
