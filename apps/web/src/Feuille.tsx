/**
 * La feuille — **une seule** coquille pour les quatre écrans superposés (U11).
 *
 * Elles étaient quatre copies du même bloc : un conteneur, un en-tête, un bouton
 * « Fermer ». Chacune avec ses propres défauts, et toutes sans les deux
 * comportements qui rendent une feuille utilisable au clavier :
 *
 * - `Échap` ne fermait rien, faute de gestionnaire ;
 * - le focus restait sur le bouton d'ouverture, **derrière** la feuille. Un
 *   lecteur d'écran annonçait le titre du bouton au lieu de la feuille, et
 *   `Tab` partait vers la page du dessous au lieu de circuler à l'intérieur.
 *
 * ⚠️ `<dialog open>` et non `showModal()` : le modal natif gère le piège et
 * `Échap` tout seul, mais il gèle le défilement de la page **et** son
 * historique d'onglet à Safari, ce qui casserait le retour à la conversation.
 * Le modal reste à U12, mesuré sur un iPhone réel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cibleSuivante, ciblesVisibles, toucheDeFermeture } from "./focus.ts";

interface Props {
  /** Nom accessible de la feuille — ce qu'un lecteur d'écran annonce. */
  readonly ariaLabel: string;
  /** Libellé du bouton de retour, à gauche du titre. Absent = pas de bouton. */
  readonly retourLibelle?: string | undefined;
  /** Action du bouton de retour. */
  readonly onRetour?: (() => void) | undefined;
  readonly children: ReactNode;
  readonly onClose: () => void;
  /** Fermeture pilotée par un passage vers une autre feuille. */
  readonly fermeture?: boolean;
  /** Titre, et information secondaire éventuelle. */
  readonly titre: ReactNode;
}

/**
 * Ce qu'un `Tab` peut atteindre, dans l'ordre du document.
 *
 * Sélecteur volontairement explicite plutôt qu'une recherche de propriétés :
 * `tabIndex` vaut `-1` sur les conteneurs, `-2` sur les éléments retirés du
 * parcours, et un calcul qui les confondrait laisserait le parcours s'arrêter
 * au milieu.
 */
const SIBLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export const Feuille = ({
  ariaLabel,
  children,
  onClose,
  fermeture = false,
  onRetour,
  retourLibelle,
  titre,
}: Props) => {
  const racine = useRef<HTMLDialogElement | null>(null);
  const [fermetureInterne, setFermetureInterne] = useState(false);
  const [phase, setPhase] = useState<"entree" | "ouverte" | "sortie">("entree");
  const fermetureFaite = useRef(false);
  const onCloseRef = useRef(onClose);
  const fermetureDemandee = fermetureInterne || fermeture;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /**
   * Où rendre le focus à la fermeture.
   *
   * Capturé à l'ouverture, pas cherché à la fermeture : entre les deux, l'élément
   * d'origine a pu disparaître — l'agent s'est fermé, la liste a changé. Rendre
   * le focus sur un `document.body` nu est pire que de ne rien faire.
   */
  const avantOuverture = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPhase("ouverte"));
    const ouverture = document.activeElement;
    avantOuverture.current = ouverture instanceof HTMLElement ? ouverture : null;
    // Le focus entre dans la feuille : sans cela, un lecteur d'écran annonce encore
    // le contrôle qui l'a ouverte.
    const element = racine.current;
    if (element !== null) {
      element.focus({ preventScroll: true });
    }
    return () => {
      window.cancelAnimationFrame(frame);
      const destination = avantOuverture.current;
      if (destination !== null && destination.isConnected) {
        destination.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    if (!fermetureDemandee) return undefined;
    setPhase("sortie");
    const duree = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240;
    const timer = window.setTimeout(() => {
      if (fermetureFaite.current) return;
      fermetureFaite.current = true;
      onCloseRef.current();
    }, duree);
    return () => window.clearTimeout(timer);
  }, [fermetureDemandee]);

  const fermer = useCallback(() => {
    setFermetureInterne(true);
  }, []);

  /**
   * `Échap` ferme, `Tab` reste dedans.
   *
   * Le cycle est calculé à chaque appui plutôt que mis en cache : la feuille
   * change de contenu pendant qu'elle est ouverte (un fichier s'ouvre, un
   * niveau de raisonnement apparaît), et une liste figée viserait des éléments
   * disparus.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDialogElement>) => {
      if (toucheDeFermeture(event)) {
        event.preventDefault();
        fermer();
        return;
      }
      if (event.key !== "Tab") return;
      const element = racine.current;
      if (element === null) return;
      const tous = [...element.querySelectorAll<HTMLElement>(SIBLE)];
      const cibles = ciblesVisibles(tous);
      const depart = document.activeElement;
      if (cibles.length === 0) {
        // Rien d'atteignable : on garde le focus ici plutôt que de le laisser
        // filer sur la page derrière.
        event.preventDefault();
        return;
      }
      const suivante = cibleSuivante(
        cibles,
        depart instanceof HTMLElement && cibles.includes(depart) ? depart : null,
        !event.shiftKey,
      );
      if (suivante === null) return;
      event.preventDefault();
      suivante.focus({ preventScroll: true });
    },
    [fermer],
  );

  return (
    <dialog
      aria-label={ariaLabel}
      aria-modal="true"
      className={`sheet sheet--${phase}`}
      // `tabIndex` négatif : la feuille reçoit le focus sans entrer dans le
      // parcours au `Tab`. Sans cela, le cycle s'arrêterait sur elle.
      onKeyDown={onKeyDown}
      open
      ref={racine}
      tabIndex={-1}
    >
      <header className="sheet__head">
        {retourLibelle === undefined || onRetour === undefined ? null : (
          <button type="button" className="ghost" onClick={onRetour}>
            {retourLibelle}
          </button>
        )}
        <span className="sheet__name">{titre}</span>
        <button type="button" className="ghost" onClick={fermer}>
          Fermer
        </button>
      </header>
      <div className="sheet__body">{children}</div>
    </dialog>
  );
};
