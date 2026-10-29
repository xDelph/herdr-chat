/**
 * La puce « 2 tâches de fond » de l'en-tête — ouvre la feuille des tâches.
 *
 * Le décompte vient de `/api/conversations` (`tachesDeFond`) : absent, la puce
 * n'existe pas (capacité absente ou aucune tâche) ; rien n'est deviné.
 */
import { memo } from "react";
import type { BackgroundTaskCount } from "@herdr-remote/shared";
import { nombreDeTaches } from "../taches.ts";
import { Icone } from "../ui/Icone.tsx";

export const PuceTaches = memo(
  ({
    compte,
    onOuvrir,
  }: {
    readonly compte: BackgroundTaskCount | undefined;
    readonly onOuvrir: () => void;
  }) => {
    if (compte === undefined || compte.total === 0) return null;
    const enCours = compte.enCours > 0;
    return (
      <button
        type="button"
        className={enCours ? "puce-taches puce-taches--en-cours" : "puce-taches"}
        onClick={onOuvrir}
        aria-label={`${enCours ? nombreDeTaches(compte.enCours) : nombreDeTaches(compte.total)} — voir le détail`}
      >
        {enCours ? <span className="spin" aria-hidden="true" /> : <Icone nom="brain" petite />}
        <span className="num">
          {enCours ? nombreDeTaches(compte.enCours) : nombreDeTaches(compte.total)}
        </span>
      </button>
    );
  },
);
PuceTaches.displayName = "PuceTaches";
