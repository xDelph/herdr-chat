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
import type { Health } from "./api.ts";
import { Feuille } from "./Feuille.tsx";

interface Props {
  readonly health: Health | null;
  readonly onClose: () => void;
  /** Agents masqués faute de session lisible — comptés, jamais cachés en silence. */
  readonly sansSession: number;
}

export const SettingsSheet = ({ health, onClose, sansSession }: Props) => (
  <Feuille ariaLabel="Réglages" onClose={onClose} titre="Réglages">
    <dl className="kv">
      <dt>Herdr joignable</dt>
      <dd>{health?.herdr.reachable === true ? "oui" : "non"}</dd>
      <dt>Version</dt>
      <dd>
        {health?.herdr.version === undefined
          ? "inconnue"
          : `${health.herdr.version} · protocole ${String(health.herdr.protocol ?? "")}`}
      </dd>
      <dt>Socket</dt>
      <dd className="mono small">{health?.herdr.socket ?? "inconnu"}</dd>
      <dt>Conversations lisibles</dt>
      <dd>
        {sansSession === 0
          ? "toutes"
          : `${String(sansSession)} agent(s) masqué(s) — Herdr n'expose pas de session lisible`}
      </dd>
    </dl>
    <p className="muted small">
      Le contenu des conversations est lu dans les fichiers de session Pi, jamais depuis Herdr.
      Aucune action shell arbitraire n'est exposée.
    </p>
  </Feuille>
);
