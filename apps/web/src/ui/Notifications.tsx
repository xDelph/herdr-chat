/**
 * Les notifications d'écran, **en haut**, sous la barre d'état — là où une
 * application mobile annonce l'issue d'un geste. Une erreur porte sa cause et
 * reste jusqu'à ce qu'on la ferme ; le reste part seul.
 */
import { useSyncExternalStore } from "react";
import { notifications } from "../app/services.ts";
import { Icone } from "./Icone.tsx";

export const Notifications = () => {
  const liste = useSyncExternalStore(notifications.souscrire, notifications.liste);
  if (liste.length === 0) return null;
  return (
    <div className="notifs">
      {liste.map((notification) => (
        <div
          key={notification.id}
          className={`notif notif--${notification.ton}`}
          role={notification.ton === "erreur" ? "alert" : "status"}
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
