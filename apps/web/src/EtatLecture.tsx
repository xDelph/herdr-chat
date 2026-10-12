/**
 * Bandeau d'état de lecture — un rendu, six états (U10).
 *
 * ⚠️ `pret` ne rend **rien**. Un état qui occupe de la place même quand tout va
 * bien habitue l'œil à l'ignorer, et le jour où un bandeau rouge apparaît il
 * passe inaperçu.
 *
 * Chaque état porte ce qui permet d'agir : la cause, et le moment de la
 * dernière lecture réussie. « Hors ligne » sans horodatage dit la moitié du
 * problème — et l'autre moitié, c'est de savoir si ce qu'on lit est vieux.
 */
import { heureLue } from "./etats.ts";
import { Notice } from "./Notice.tsx";
import type { EtatLecture } from "./etats.ts";

interface Props {
  readonly etat: EtatLecture;
  /** Phrase affichée quand la lecture réussit et qu'il n'y a rien à montrer. */
  readonly libelleVide: string;
  readonly onReessayer: () => void;
}

export const BandeauEtat = ({ etat, libelleVide, onReessayer }: Props) => {
  switch (etat.phase) {
    case "pret":
      return null;

    case "chargement":
      return <Notice>Lecture…</Notice>;

    case "vide":
      // Jamais en rouge : un parc sans agent n'est pas une panne.
      return <Notice>{libelleVide}</Notice>;

    case "erreur":
      return (
        <Notice ton="erreur">
          <p>{etat.cause}</p>
          <Bouton onReessayer={onReessayer}>Réessayer</Bouton>
        </Notice>
      );

    case "hors-ligne":
      return (
        <Notice ton="avertissement">
          <p>
            Connexion perdue. Dernière lecture réussie{" "}
            {heureLue(etat.dernierSucces) ?? "à une heure inconnue"}.
          </p>
          <Bouton onReessayer={onReessayer}>Réessayer</Bouton>
        </Notice>
      );

    case "reconnexion":
      return (
        <Notice ton="avertissement">
          Flux temps réel interrompu — reconnexion en cours. L'affichage se met à jour à la lecture
          suivante.
        </Notice>
      );
  }

  /*
    Atteint seulement si un état échappe à l'union fermée — donc jamais, en
    théorie. On affiche quand même quelque chose : un état qu'on ne sait pas
    nommer ne doit pas disparaître en silence, il doit se voir.
  */
  return <Notice ton="erreur">état de lecture inconnu — rechargez la page</Notice>;
};

/**
 * Bouton de nouvelle tentative.
 *
 * 44 px de haut : c'est le geste qu'on fait en secouant le téléphone quand rien
 * ne répond, donc la cible doit être la plus large possible.
 */
const Bouton = ({
  children,
  onReessayer,
}: {
  readonly children: string;
  readonly onReessayer: () => void;
}) => (
  <button type="button" className="ghost" onClick={onReessayer}>
    {children}
  </button>
);
