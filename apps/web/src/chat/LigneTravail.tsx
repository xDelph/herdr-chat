/**
 * La ligne « au travail » : chrono · jetons · action en cours.
 *
 * ⚠️ **Le seul composant qui bat à la seconde.** L'horloge vivait dans l'écran
 * de conversation et redessinait tout le fil chaque seconde pendant le travail.
 * Elle vit ici, dans une ligne de trente caractères.
 *
 * ⚠️ La durée part de la demande telle que la session la date (ou du passage à
 * `working` observé sur le flux) — jamais d'un instant inventé. Sans l'un ni
 * l'autre, pas de chronomètre.
 */
import { memo } from "react";
import { relativeWorkspacePath, commandeSansCd } from "../blocks.ts";
import { chrono, jetons } from "../libelles.ts";
import type { TourEnCours } from "../transcript.ts";
import { useMaintenant } from "../app/hooks.ts";

export const LigneTravail = memo(
  ({
    tour,
    debutObserve,
    cwd,
  }: {
    readonly tour: TourEnCours;
    readonly debutObserve: number | undefined;
    readonly cwd: string | null;
  }) => {
    const debut = tour.debutMs ?? debutObserve ?? null;
    const maintenant = useMaintenant(debut === null ? null : 1_000);
    const action = tour.derniereAction;
    const cible =
      action?.cible === null || action?.cible === undefined
        ? null
        : action.estFichier
          ? relativeWorkspacePath(action.cible, cwd)
          : commandeSansCd(action.cible, cwd);
    return (
      <output className="travail">
        <span className="spin" aria-hidden="true" />
        {debut === null ? (
          <span>Working</span>
        ) : (
          <span className="num">{chrono(maintenant - debut)}</span>
        )}
        {tour.jetons === null ? null : (
          <>
            <span className="travail__sep" aria-hidden="true">
              ·
            </span>
            <span className="num">{jetons(tour.jetons)} tokens</span>
          </>
        )}
        {action === null ? null : (
          <>
            <span className="travail__sep" aria-hidden="true">
              ·
            </span>
            <span className="travail__action">
              {action.singulier}
              {cible === null ? null : <span className="mono"> {cible}</span>}
            </span>
          </>
        )}
      </output>
    );
  },
);
LigneTravail.displayName = "LigneTravail";
