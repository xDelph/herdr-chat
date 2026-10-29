/**
 * Réglages : thème, regroupement, notifications, santé du démon.
 *
 * Les informations de santé sont celles qui servent à diagnostiquer — version,
 * socket, agents sans session lisible. Une capacité absente (push non pris en
 * charge) est dite absente.
 */
import { useEffect, useState } from "react";
import type { Health, Overview } from "../api.ts";
import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  pushSupported,
} from "../notifications.ts";
import {
  appliquerStyleMarque,
  appliquerTheme,
  GROUPEMENT_LABEL,
  GROUPEMENTS,
  lireStyleMarque,
  lireTheme,
  STYLE_MARQUE_LABEL,
  STYLES_MARQUE,
  THEME_LABEL,
  THEMES,
  type Groupement,
  type StyleMarque,
  type Theme,
} from "../preferences.ts";
import { dureeLongue, versionDeLApp } from "../libelles.ts";
import { Avis } from "../ui/atomes.tsx";
import { Feuille } from "../ui/Feuille.tsx";

/** La permission du navigateur, en mots — jamais `granted/denied/default` bruts. */
export const LIBELLE_PERMISSION: Record<NotificationPermission | "non-pris-en-charge", string> = {
  default: "not requested yet",
  denied: "denied (re-enable it in the browser settings)",
  granted: "granted",
  "non-pris-en-charge": "not supported",
};

const Notifications = () => {
  const [active, setActive] = useState<boolean | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "non-pris-en-charge">(
    pushSupported ? Notification.permission : "non-pris-en-charge",
  );

  useEffect(() => {
    if (!pushSupported) return undefined;
    let vivant = true;
    void (async () => {
      try {
        const abonnement = await currentPushSubscription();
        if (vivant) setActive(abonnement !== null);
      } catch (cause) {
        if (vivant) setErreur(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      vivant = false;
    };
  }, []);

  const bascule = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      if (active === true) {
        await disablePushNotifications();
        setActive(false);
      } else {
        await enablePushNotifications();
        setActive(true);
      }
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (pushSupported) setPermission(Notification.permission);
      setOccupe(false);
    }
  };

  if (!pushSupported) {
    return (
      <p className="discret">
        This browser does not support push notifications. On iPhone, first add Herdr Chat to the
        Home Screen (Share menu).
      </p>
    );
  }
  return (
    <>
      <div className="reglage">
        <span>
          {active === null ? "Unknown state" : active ? "On for this device" : "Off"}
          <small className="discret"> · permission: {LIBELLE_PERMISSION[permission]}</small>
        </span>
        <button
          type="button"
          className="bouton"
          disabled={occupe || active === null}
          onClick={() => void bascule()}
        >
          {occupe ? "…" : active === true ? "Turn off" : "Turn on"}
        </button>
      </div>
      {erreur === null ? null : (
        <Avis ton="erreur" annonce="alerte">
          {erreur}
        </Avis>
      )}
    </>
  );
};

export const Reglages = ({
  health,
  erreurHealth,
  overview,
  groupement,
  onGroupement,
  onClose,
}: {
  readonly health: Health | null;
  readonly erreurHealth: string | null;
  readonly overview: Overview | null;
  readonly groupement: Groupement;
  readonly onGroupement: (suivant: Groupement) => void;
  readonly onClose: () => void;
}) => {
  const [theme, setTheme] = useState<Theme>(lireTheme);
  const [marques, setMarques] = useState<StyleMarque>(lireStyleMarque);
  return (
    <Feuille titre="Settings" onClose={onClose}>
      <fieldset className="champ">
        <legend>Theme</legend>
        <fieldset className="seg seg--plein" aria-label="Theme">
          {THEMES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={theme === option}
              onClick={() => {
                appliquerTheme(option);
                setTheme(option);
              }}
            >
              {THEME_LABEL[option]}
            </button>
          ))}
        </fieldset>
        <p className="discret">Auto follows the device's light/dark setting.</p>
      </fieldset>
      <fieldset className="champ">
        <legend>Agent logos</legend>
        <fieldset className="seg seg--plein" aria-label="Agent logos">
          {STYLES_MARQUE.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={marques === option}
              onClick={() => {
                appliquerStyleMarque(option);
                setMarques(option);
              }}
            >
              {STYLE_MARQUE_LABEL[option]}
            </button>
          ))}
        </fieldset>
        <p className="discret">
          Standard keeps each brand's colors; “Theme color” draws them in the theme's ink.
        </p>
      </fieldset>
      <fieldset className="champ">
        <legend>List</legend>
        <fieldset className="seg seg--plein" aria-label="List grouping">
          {GROUPEMENTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={groupement === option}
              onClick={() => onGroupement(option)}
            >
              {GROUPEMENT_LABEL[option]}
            </button>
          ))}
        </fieldset>
        <p className="discret">
          Agents that need you or are working stay on top; “By project” groups the rest by project.
        </p>
      </fieldset>
      <fieldset className="champ">
        <legend>Notifications</legend>
        <Notifications />
      </fieldset>
      <fieldset className="champ">
        <legend>Daemon</legend>
        {erreurHealth === null ? null : <Avis ton="erreur">Unreadable health: {erreurHealth}</Avis>}
        <dl className="sante">
          <dt>Herdr</dt>
          <dd>
            {health === null
              ? "unknown"
              : health.herdr.reachable
                ? `reachable${health.herdr.version === undefined ? "" : ` · ${health.herdr.version}`}${health.herdr.protocol === undefined ? "" : ` · protocol ${String(health.herdr.protocol)}`}`
                : "unreachable"}
          </dd>
          <dt>Socket</dt>
          <dd className="mono">{health?.herdr.socket ?? "unknown"}</dd>
          <dt>Daemon uptime</dt>
          <dd className="num">
            {health?.uptimeMs === undefined ? "unknown" : dureeLongue(health.uptimeMs)}
          </dd>
          <dt>Sessions</dt>
          <dd>
            {overview === null
              ? "unknown"
              : overview.withoutSession === 0
                ? "all readable"
                : `${String(overview.withoutSession)} agent(s) without a readable session`}
          </dd>
          <dt>App version</dt>
          <dd title={__HERDR_PWA_BUILD_ID__}>
            {versionDeLApp(__HERDR_PWA_VERSION__, __HERDR_PWA_BUILD_ID__)}
          </dd>
        </dl>
      </fieldset>
      <p className="discret">
        Conversation content comes from each agent's session store (the file or database Herdr
        points to). Herdr only provides control and state.
      </p>
    </Feuille>
  );
};
