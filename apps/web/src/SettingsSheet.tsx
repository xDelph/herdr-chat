/**
 * Réglages — une feuille, plus un onglet (U17).
 *
 * ⚠️ **Pourquoi une feuille.** Les réglages se consultent rarement, et une
 * destination permanente dans une barre d'onglets coûte un geste à chaque
 * ouverture de l'application. Un engrenage dans l'en-tête les rend atteignables
 * en un geste **depuis n'importe quel écran**, sans occuper de place.
 *
 * Les informations sont celles qui permettent de diagnostiquer : version de
 * Herdr, chemin du socket, cohérence des dossiers de session. Aucune n'est
 * décorative — un écran de réglages qui ne dit que « tout va bien » n'aide
 * personne.
 */
import { useEffect, useState } from "react";
import type { Health } from "./api.ts";
import { Feuille } from "./Feuille.tsx";
import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  pushSupported,
} from "./notifications.ts";

interface Props {
  readonly health: Health | null;
  readonly onClose: () => void;
  /** Agents masqués faute de session lisible — comptés, jamais cachés en silence. */
  readonly sansSession: number;
}

export const SettingsSheet = ({ health, onClose, sansSession }: Props) => {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    pushSupported ? Notification.permission : "unsupported",
  );

  useEffect(() => {
    let active = true;
    if (pushSupported) {
      void (async () => {
        try {
          const subscription = await currentPushSubscription();
          if (active) setPushEnabled(subscription !== null);
        } catch (cause: unknown) {
          if (active) setPushError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    }
    return () => {
      active = false;
    };
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        setPushEnabled(false);
      } else {
        await enablePushNotifications();
        setPushEnabled(true);
      }
      setPermission(Notification.permission);
    } catch (cause) {
      setPushError(cause instanceof Error ? cause.message : String(cause));
      if (pushSupported) setPermission(Notification.permission);
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <Feuille ariaLabel="Settings" onClose={onClose} titre="Settings">
      <dl className="kv">
        <dt>Herdr reachable</dt>
        <dd>{health?.herdr.reachable === true ? "yes" : "no"}</dd>
        <dt>Version</dt>
        <dd>
          {health?.herdr.version === undefined
            ? "unknown"
            : `${health.herdr.version} · protocol ${String(health.herdr.protocol ?? "")}`}
        </dd>
        <dt>PWA build</dt>
        <dd>{__HERDR_PWA_BUILD_ID__}</dd>
        <dt>Socket</dt>
        <dd className="mono small">{health?.herdr.socket ?? "unknown"}</dd>
        <dt>Readable conversations</dt>
        <dd>
          {sansSession === 0
            ? "all"
            : `${String(sansSession)} agent(s) hidden — Herdr does not expose a readable session`}
        </dd>
      </dl>
      <section>
        <h3>Notifications</h3>
        <p className="muted small">
          {pushSupported
            ? `Browser permission: ${permission}. Get notified when an agent finishes working.`
            : "Push notifications are not supported in this browser. On iPhone, install Herdr from the Share menu first."}
        </p>
        <button
          disabled={!pushSupported || pushBusy}
          onClick={() => void togglePush()}
          type="button"
        >
          {pushBusy
            ? "Updating…"
            : pushEnabled
              ? "Turn off notifications"
              : "Turn on notifications"}
        </button>
        {pushError === null ? null : <p role="alert">{pushError}</p>}
      </section>
      <p className="muted small">
        Conversation content is read from Pi session files, not from Herdr. Arbitrary shell actions
        are not exposed.
      </p>
    </Feuille>
  );
};
