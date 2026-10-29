/**
 * La liste des tâches de fond d'une conversation, lue **quand il y en a** :
 * le décompte de `/api/conversations` décide (aucune requête pour un agent
 * sans tâches), et une liste relue quand ce décompte change.
 *
 * Sert à titrer les cartes de rapport (description, état) quand la notification
 * de fin n'est pas dans la fenêtre lue du fil.
 */
import { useEffect, useState } from "react";
import type { BackgroundTaskCount } from "@herdr-remote/shared";
import { reportError } from "../api.ts";
import { fetchTaches, type BackgroundTask } from "../taches.ts";

export const useListeTaches = (
  paneId: string,
  compte: BackgroundTaskCount | undefined,
): ReadonlyArray<BackgroundTask> => {
  const [taches, setTaches] = useState<ReadonlyArray<BackgroundTask>>([]);
  const total = compte?.total ?? 0;
  const enCours = compte?.enCours ?? 0;
  useEffect(() => {
    if (total === 0) return undefined;
    let vivant = true;
    const lit = async () => {
      try {
        const reponse = await fetchTaches(paneId);
        if (vivant) setTaches(reponse.tasks);
      } catch (cause) {
        // Une liste illisible n'empêche pas de lire le fil : les cartes gardent
        // ce que leurs propres messages disent. La cause est journalisée, et la
        // feuille des tâches, elle, l'affiche.
        reportError("unreadable background tasks", String(cause));
      }
    };
    void lit();
    return () => {
      vivant = false;
    };
  }, [paneId, total, enCours]);
  return taches;
};
