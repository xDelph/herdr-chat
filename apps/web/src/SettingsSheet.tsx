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
} from "./preferences.ts";

interface Props {
  readonly health: Health | null;
  readonly onClose: () => void;
  /** Agents masqués faute de session lisible — comptés, jamais cachés en silence. */
  readonly sansSession: number;
  /*
    ⚠️ **Le regroupement vient du parent, pas d'un état local.** Le thème et les
    marques sont poses en attribut sur `<html>` : le CSS fait le reste, et la
    feuille peut les garder pour elle. Le regroupement decide de la **structure**
    de la liste — l'ecran qui la construit doit donc le connaitre et se
    redessiner. Un reglage que le CSS applique peut vivre ici ; un reglage qui
    change l'arbre doit remonter.
  */
  readonly groupement: Groupement;
  readonly onGroupement: (suivant: Groupement) => void;
}

export const SettingsSheet = ({
  groupement,
  health,
  onClose,
  onGroupement,
  sansSession,
}: Props) => {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  /**
   * Le thème vit ici, et pas dans `App`.
   *
   * ⚠️ Rien d'autre que cette feuille n'en dépend : l'apparence est décidée par
   * l'attribut posé sur `<html>`, pas par un rendu React. Le remonter jusqu'à la
   * racine aurait fait re-rendre toute l'application — la liste des agents
   * comprise — pour changer une couleur.
   */
  const [theme, setTheme] = useState<Theme>(lireTheme);
  /**
   * Le rendu des marques suit exactement le même chemin que le thème : une
   * valeur validée, un attribut sur `<html>`, le CSS qui décide.
   */
  const [styleMarque, setStyleMarque] = useState<StyleMarque>(lireStyleMarque);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    pushSupported ? Notification.permission : "unsupported",
  );

  const choisirTheme = (suivant: Theme): void => {
    appliquerTheme(suivant);
    setTheme(suivant);
  };

  const choisirStyleMarque = (suivant: StyleMarque): void => {
    appliquerStyleMarque(suivant);
    setStyleMarque(suivant);
  };

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
        <h3>Appearance</h3>
        <p className="muted small">
          Recolours the interface. Status colours — finished, waiting, failed — keep their meaning
          in every theme.
        </p>
        {/*
          ⚠️ Un `<fieldset>` plutôt qu'un `role="group"` : la balise veut dire
          exactement cela, et un lecteur d'écran l'annonce sans qu'on ait à le lui
          dire. Le `<legend>` est masqué visuellement — le titre « Appearance »
          est juste au-dessus — mais il reste lu.
        */}
        <fieldset className="theme">
          <legend className="sr-only">Theme</legend>
          {THEMES.map((option) => (
            <button
              aria-pressed={theme === option}
              className="theme__choix"
              key={option}
              onClick={() => {
                choisirTheme(option);
              }}
              type="button"
            >
              <span aria-hidden="true" className={`theme__pastille theme__pastille--${option}`} />
              {THEME_LABEL[option]}
            </button>
          ))}
        </fieldset>
        {/*
          Le rendu des marques d'agents — les mêmes boutons, un autre réglage.

          ⚠️ **Ce n'est pas un réglage de thème**, donc il a son propre
          `<fieldset>` et son propre intitulé : mêler les deux dans un même
          groupe ferait croire qu'on choisit une couleur alors qu'on choisit une
          **convention d'affichage**. Le défaut est le logo tel que son éditeur
          le publie.
        */}
        <h4 className="theme__titre">Agent logos</h4>
        <p className="muted small">
          Standard shows each agent's own logo. Match theme draws them in the theme colour, which
          makes the list uniform but loses the marks' colours.
        </p>
        <fieldset className="theme">
          <legend className="sr-only">Agent logos</legend>
          {STYLES_MARQUE.map((option) => (
            <button
              aria-pressed={styleMarque === option}
              className="theme__choix"
              key={option}
              onClick={() => {
                choisirStyleMarque(option);
              }}
              type="button"
            >
              {STYLE_MARQUE_LABEL[option]}
            </button>
          ))}
        </fieldset>
        {/*
          Le regroupement de la liste.

          ⚠️ **Ce que le second choix fait perdre, et il faut le dire à
          l'écran.** « Needs attention » passe en tête parce qu'un agent bloqué
          attend une action ; groupées par projet, ces lignes se retrouvent
          dispersées. L'état reste écrit sur chaque ligne, mais ce n'est plus lui
          qui organise.
        */}
        <h4 className="theme__titre">Conversation list</h4>
        <p className="muted small">
          Both keep what needs attention and what is running on top. By workspace also gathers the
          rest — finished and idle agents — by project, which is easier once there are many.
        </p>
        <fieldset className="theme">
          <legend className="sr-only">Conversation list</legend>
          {GROUPEMENTS.map((option) => (
            <button
              aria-pressed={groupement === option}
              className="theme__choix"
              key={option}
              onClick={() => {
                onGroupement(option);
              }}
              type="button"
            >
              {GROUPEMENT_LABEL[option]}
            </button>
          ))}
        </fieldset>
      </section>
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
      {/*
        ⚠️ **Cette phrase a longtemps dit qu'on lisait « les fichiers de session
de Pi »**, ce qui était vrai au premier jour et faux depuis : cinq sources sont
        lues — des fichiers pour Pi, codex et Claude Code, des bases SQLite pour
        opencode et devin. Elle est donc écrite **en fonction de ce qui est vrai
        pour toutes** : chaque agent a son magasin, et Herdr indique lequel.

        ⚠️ Et la seconde phrase n'est pas un ornement : dire d'où vient le
        contenu sans dire ce qu'Herdr fait serait une demi-vérité. Le partage est
        net — contenu d'un côté, contrôle et état de l'autre — et il vaut mieux
        l'écrire ici que de laisser croire que Herdr sert le contenu.
      */}
      <p className="muted small">
        Conversation content comes from each agent's own session store — the file or database Herdr
        points to. Herdr itself provides only control and status. Arbitrary shell actions are not
        exposed.
      </p>
    </Feuille>
  );
};
