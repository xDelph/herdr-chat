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
  appliquerTheme,
  GROUPEMENT_LABEL,
  GROUPEMENTS,
  lireTheme,
  THEME_LABEL,
  THEMES,
  type Groupement,
  type Theme,
} from "../preferences.ts";
import { chrono } from "../libelles.ts";
import { Avis } from "../ui/atomes.tsx";
import { Feuille } from "../ui/Feuille.tsx";

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
        Ce navigateur ne prend pas en charge les notifications push. Sur iPhone, installez d'abord
        Herdr Chat sur l'écran d'accueil (menu Partager).
      </p>
    );
  }
  return (
    <>
      <div className="reglage">
        <span>
          {active === null ? "État inconnu" : active ? "Activées sur cet appareil" : "Désactivées"}
          <small className="discret"> · permission : {permission}</small>
        </span>
        <button
          type="button"
          className="bouton"
          disabled={occupe || active === null}
          onClick={() => void bascule()}
        >
          {occupe ? "…" : active === true ? "Désactiver" : "Activer"}
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
  return (
    <Feuille titre="Réglages" onClose={onClose}>
      <fieldset className="champ">
        <legend>Thème</legend>
        <fieldset className="seg seg--plein" aria-label="Thème">
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
        <p className="discret">Auto suit le réglage clair/sombre de l'appareil.</p>
      </fieldset>
      <fieldset className="champ">
        <legend>Liste</legend>
        <fieldset className="seg seg--plein" aria-label="Regroupement de la liste">
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
          Ce qui attend une décision et ce qui travaille restent en tête ; « Par projet » range le
          reste par projet.
        </p>
      </fieldset>
      <fieldset className="champ">
        <legend>Notifications</legend>
        <Notifications />
      </fieldset>
      <fieldset className="champ">
        <legend>Démon</legend>
        {erreurHealth === null ? null : <Avis ton="erreur">Santé illisible : {erreurHealth}</Avis>}
        <dl className="sante">
          <dt>Herdr</dt>
          <dd>
            {health === null
              ? "inconnu"
              : health.herdr.reachable
                ? `joignable${health.herdr.version === undefined ? "" : ` · ${health.herdr.version}`}${health.herdr.protocol === undefined ? "" : ` · protocole ${String(health.herdr.protocol)}`}`
                : "injoignable"}
          </dd>
          <dt>Socket</dt>
          <dd className="mono">{health?.herdr.socket ?? "inconnu"}</dd>
          <dt>Démon actif depuis</dt>
          <dd className="num">
            {health?.uptimeMs === undefined ? "inconnu" : chrono(health.uptimeMs)}
          </dd>
          <dt>Sessions</dt>
          <dd>
            {overview === null
              ? "inconnu"
              : overview.withoutSession === 0
                ? "toutes lisibles"
                : `${String(overview.withoutSession)} agent(s) sans session lisible`}
          </dd>
          <dt>Version de l'app</dt>
          <dd className="mono">{__HERDR_PWA_BUILD_ID__}</dd>
        </dl>
      </fieldset>
      <p className="discret">
        Le contenu des conversations vient du magasin de session de chaque agent (fichier ou base
        que Herdr désigne). Herdr ne fournit que le contrôle et l'état.
      </p>
    </Feuille>
  );
};
