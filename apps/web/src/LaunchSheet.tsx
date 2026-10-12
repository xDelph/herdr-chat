/**
 * Feuille de lancement : type d'agent, modèle, niveau de raisonnement (U06).
 *
 * **Un seul endroit pour les trois choix.** Avant, le type d'agent était une
 * liste déroulante dans la ligne du projet et le modèle un panonceau à côté ;
 * choisir les deux demandait deux gestes sur deux éléments d'une rangée de
 * 320 px. Le type et le modèle ne sont d'ailleurs pas indépendants : les
 * niveaux de raisonnement dépendent du modèle.
 *
 * ⚠️ **Rien ne part sans être vérifié.** Le bouton « Lancer » est inactif tant
 * que `verifierLancement` refuse le choix, et le refus est écrit en toutes
 * lettres. Avant, un modèle inexistant partait quand même et l'agent le
 * refusait au démarrage, sans que l'écran dise pourquoi.
 *
 * ⚠️ **Changer de modèle n'efface pas le niveau choisi.** L'effacer
 * silencieusement perdrait une intention de l'utilisateur ; l'avertir
 * proposerait un choix que l'agent refusera. Le niveau reste affiché, marqué
 * comme non accepté, et bloque l'envoi tant qu'il ne correspond pas.
 */
import { useCallback, useEffect, useState } from "react";
import type { InstalledKind, ModelCatalog } from "./api.ts";
import { fetchModelCatalog } from "./api.ts";
import {
  filtreUtile,
  levelLabel,
  MAX_MODELES_AFFICHES,
  modelesVisibles,
  verifierLancement,
} from "./launch.ts";
import type { LaunchChoice } from "./launch.ts";

interface Props {
  readonly kinds: ReadonlyArray<InstalledKind>;
  readonly launching: boolean;
  readonly onClose: () => void;
  readonly onLaunch: (workspaceId: string, kind: string, choice: LaunchChoice) => void;
  /** Nom du projet — la feuille dit où l'agent va démarrer. */
  readonly titre: string;
  readonly workspaceId: string;
}

export const LaunchSheet = ({ kinds, launching, onClose, onLaunch, titre, workspaceId }: Props) => {
  const [kind, setKind] = useState<string>(kinds[0]?.kind ?? "pi");
  const [filtre, setFiltre] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [chargement, setChargement] = useState(true);
  const [echec, setEchec] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCatalog(null);
    setEchec(null);
    setChargement(true);
    const charger = async () => {
      try {
        const value = await fetchModelCatalog(kind);
        if (alive) setCatalog(value);
      } catch (cause: unknown) {
        if (alive) setEchec(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (alive) setChargement(false);
      }
    };
    void charger();
    return () => {
      alive = false;
    };
  }, [kind]);

  /**
   * Changer de type remet tout à zéro.
   *
   * Un modèle de `pi` n'existe pas chez `codex`, et un niveau se vérifie
   * contre les niveaux **du modèle**. Garder l'ancien choix produirait un refus
   * qui ne s'explique pas, puisque le contrôle correspondant n'est même plus
   * affiché.
   */
  const onKind = useCallback((value: string) => {
    setKind(value);
    setFiltre("");
    setModel("");
    setThinking("");
  }, []);

  /**
   * Le verdict porte sur un catalogue **connu comme lisible**.
   *
   * Après un échec de lecture, `catalog` est `null` : sans cette distinction,
   * un chargement encore en cours serait indistinguishable d'un échec, et le
   * refus afficherait « modèle absent du catalogue » au lieu de la cause.
   */
  const verdict = verifierLancement({
    catalog: echec !== null ? null : catalog,
    kind,
    model,
    thinking,
  });

  const choisi = catalog?.models.find((candidat) => candidat.id === model);
  const niveaux = choisi?.thinkingLevels ?? [];
  const niveauAccepte = thinking.length === 0 || niveaux.includes(thinking);
  const visibles = catalog === null ? [] : modelesVisibles(catalog, filtre);

  const lancer = useCallback(() => {
    if (!verdict.envoyable || launching) return;
    onLaunch(workspaceId, kind, verdict.choix);
  }, [kind, launching, onLaunch, verdict, workspaceId]);

  return (
    // `<dialog open>` et non un `div` avec `role` : la feuille est un dialogue,
    // et sa sémantique doit venir de la balise. Elle n'est pas **modale** — le
    // focus circule encore derrière — donc aucun `aria-modal`, qui mentirait.
    // Le piégeage du focus appartient à U11.
    <dialog open className="sheet" aria-label="Lancer un agent">
      <header className="sheet__head">
        <strong className="sheet__name">Nouvel agent dans {titre}</strong>
        <button type="button" className="ghost" onClick={onClose}>
          Fermer
        </button>
      </header>

      <label className="launch__label" htmlFor="launch-kind">
        Type d'agent
      </label>
      <select
        id="launch-kind"
        className="launch__model"
        value={kind}
        onChange={(event) => onKind(event.currentTarget.value)}
      >
        {kinds.map((candidat) => (
          <option key={candidat.kind} value={candidat.kind}>
            {candidat.label}
          </option>
        ))}
      </select>

      {chargement ? <p className="muted small">Lecture du catalogue de {kind}…</p> : null}

      {echec !== null ? (
        <p className="notice notice--error">
          catalogue illisible pour {kind} : {echec}
        </p>
      ) : null}

      {chargement || echec !== null ? null : catalog === null || catalog.models.length === 0 ? (
        /*
            Aucune liste, et on ne la comble pas : la raison vient du serveur et
            est affichée telle quelle. L'agent peut quand même démarrer avec ses
            propres valeurs — c'est un choix proposé, pas une absence.
          */
        <p className="muted small">
          {catalog?.error ?? `aucun catalogue de modèles vérifié pour ${kind}`} — l'agent démarrera
          avec ses propres valeurs.
        </p>
      ) : (
        <>
          <label className="launch__label" htmlFor="launch-filtre">
            Rechercher un modèle
          </label>
          {filtreUtile(catalog) ? (
            <input
              id="launch-filtre"
              type="search"
              className="launch__filter"
              placeholder={`filtrer ${String(catalog.models.length)} modèles…`}
              onChange={(event) => setFiltre(event.currentTarget.value)}
            />
          ) : null}

          <label className="launch__label" htmlFor="launch-model">
            Modèle
          </label>
          {/*
              Le filtre réduit la liste, il ne la choisit pas. C'était le défaut :
              le champ de recherche écrivait dans l'état du modèle, donc taper
              « gpt » lançait un agent demandé « gpt ».
            */}
          <select
            id="launch-model"
            className="launch__model"
            value={model}
            onChange={(event) => setModel(event.currentTarget.value)}
          >
            <option value="">modèle par défaut de l'agent</option>
            {visibles.slice(0, MAX_MODELES_AFFICHES).map((candidat) => (
              <option key={candidat.id} value={candidat.id}>
                {candidat.label === undefined ? candidat.id : `${candidat.label} · ${candidat.id}`}
              </option>
            ))}
          </select>
          {filtre.length > 0 && visibles.length === 0 ? (
            <p className="muted small">aucun modèle ne contient « {filtre} »</p>
          ) : null}

          {choisi === undefined ? null : (
            <>
              <label className="launch__label" htmlFor="launch-thinking">
                Niveau de raisonnement
              </label>
              {niveaux.length === 0 ? (
                <p className="muted small">ce modèle ne déclare aucun niveau de raisonnement</p>
              ) : (
                <select
                  id="launch-thinking"
                  className="launch__model"
                  value={thinking}
                  onChange={(event) => setThinking(event.currentTarget.value)}
                >
                  <option value="">raisonnement par défaut</option>
                  {/*
                      Un niveau devenu incompatible reste **visible**, marqué et
                      non sélectionnable. Le masquer ferait croire que rien n'est
                      choisi, et le refus en bas n'aurait plus rien à expliquer.
                    */}
                  {niveauAccepte ? null : (
                    <option value={thinking} disabled>
                      {thinking} — non accepté par {choisi.id}
                    </option>
                  )}
                  {niveaux.map((niveau) => (
                    <option key={niveau} value={niveau}>
                      raisonnement : {levelLabel(niveau)}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </>
      )}

      {verdict.envoyable ? null : <p className="notice notice--error">{verdict.raison}</p>}

      <div className="launch__actions">
        <button
          type="button"
          className="row__action row__action--primary"
          disabled={!verdict.envoyable || launching || kinds.length === 0}
          onClick={lancer}
        >
          {launching ? "Lancement…" : "Lancer"}
        </button>
        <p className="muted small">
          Herdr ne sait changer ni le modèle ni le raisonnement après le démarrage : ce sont les
          seuls moments où l'application agit pour tous les agents.
        </p>
      </div>
    </dialog>
  );
};
