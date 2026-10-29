/**
 * Les notifications d'écran, **en haut**, sous la barre d'état — là où une
 * application mobile annonce l'issue d'un geste. Une erreur porte sa cause et
 * reste jusqu'à ce qu'on la ferme ; le reste part seul.
 */
import { useSyncExternalStore } from "react";
import { notifications } from "../app/services.ts";
import { Icone } from "./Icone.tsx";

export const Notifications = () => {
  const liste = useSyncExternalStore(
    notifications.souscrire,
    notifications.liste,
    notifications.liste,
  );
  /*
    ⚠️ Le conteneur existe TOUJOURS, vide au départ : une région vivante
    insérée avec son texte n'est pas annoncée par VoiceOver. Le texte arrive
    ensuite dans une région déjà là ; une erreur reste une alerte.
  */
  return (
    <div className="notifs" aria-live="polite">
      {liste.map((notification) => (
        <div
          key={notification.id}
          className={`notif notif--${notification.ton}`}
          role={notification.ton === "erreur" ? "alert" : undefined}
        >
          <p className="notif__texte">{notification.texte}</p>
          <button
            type="button"
            className="notif__fermer"
            aria-label="Fermer la notification"
            onClick={() => notifications.ferme(notification.id)}
          >
            <Icone nom="x" />
          </button>
        </div>
      ))}
    </div>
  );
};
