/**
 * Choix du modèle et du niveau de raisonnement **au lancement**.
 *
 * ⚠️ Le moment compte : Herdr ne sait changer ni l'un ni l'autre sur un agent
 * déjà lancé (`docs/PROTOCOL.md` §2 — aucun `agent.set_model`). Chez `pi`, une
 * commande `/model` fonctionne, mais ce n'est **pas** vérifié pour les autres
 * agents : proposer la même chose partout serait un mensonge. Le lancement est
 * donc le seul point où la PWA agit pour les quatre.
 *
 * Le catalogue vient de l'agent lui-même (`pi --list-models`,
 * `codex debug models`…). Quand il est absent, on **le dit** au lieu de
 * laisser croire qu'il n'y a rien à choisir.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchModelCatalog } from "./api.ts";
import type { ModelCatalog } from "./api.ts";

/** Libellé lisible d'un niveau de raisonnement. */
export const levelLabel = (level: string): string => {
  switch (level) {
    case "off":
      return "désactivé";
    case "minimal":
      return "minimal";
    case "low":
      return "faible";
    case "medium":
      return "moyen";
    case "high":
      return "élevé";
    case "xhigh":
      return "très élevé";
    case "max":
      return "maximal";
    case "ultra":
      return "ultra";
    default:
      return level;
  }
};

interface Props {
  readonly kind: string;
  readonly onChange: (choice: { readonly model?: string; readonly thinking?: string }) => void;
}

export const LaunchOptions = ({ kind, onChange }: Props) => {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");

  useEffect(() => {
    let alive = true;
    setCatalog(null);
    setFailed(null);
    setModel("");
    setThinking("");
    setLoading(true);
    // `try`/`catch` plutôt que `.then()` : l'effet garde son `alive`, et
    // aucune promesse flottante ne doit outliver le changement de kind.
    const load = async () => {
      try {
        const value = await fetchModelCatalog(kind);
        if (alive) setCatalog(value);
      } catch (cause: unknown) {
        if (alive) setFailed(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [kind]);

  const selected = catalog?.models.find((candidate) => candidate.id === model);

  /**
   * Le raisonnement dépend **du modèle choisi**.
   *
   * Changer de modèle invalide le niveau : il faut choisir un niveau que le
   * nouveau modèle accepte, sinon on proposerait une combinaison refusée.
   */
  const onModel = useCallback(
    (value: string) => {
      setModel(value);
      const levels =
        catalog?.models.find((candidate) => candidate.id === value)?.thinkingLevels ?? [];
      if (thinking !== "" && !levels.includes(thinking)) setThinking("");
    },
    [catalog, thinking],
  );

  // La sélection remonte au parent : c'est lui qui lance.
  useEffect(() => {
    onChange({
      ...(model.length > 0 ? { model } : {}),
      ...(thinking.length > 0 ? { thinking } : {}),
    });
  }, [model, onChange, thinking]);

  if (loading) {
    return <p className="muted small">Lecture du catalogue de {kind}…</p>;
  }
  if (failed !== null) {
    return <p className="muted small">catalogue illisible : {failed}</p>;
  }
  if (catalog === null || catalog.models.length === 0) {
    return (
      <p className="muted small">
        {catalog?.error ?? `aucun catalogue de modèles vérifié pour ${kind}`} — l'agent démarrera
        avec ses propres valeurs.
      </p>
    );
  }

  const levels = selected?.thinkingLevels ?? [];
  const unfiltered = catalog.models.length > 80;

  return (
    <div className="launch__options">
      {unfiltered ? (
        <input
          type="search"
          className="launch__filter"
          placeholder={`filtrer ${String(catalog.models.length)} modèles…`}
          aria-label="Filtrer les modèles"
          list="model-catalog"
          onChange={(event) => {
            const value = event.target.value.trim();
            if (value.length > 0) setModel(value);
          }}
        />
      ) : null}

      <select
        className="launch__model"
        value={unfiltered && !catalog.models.some((m) => m.id === model) ? model : model}
        aria-label={`Modèle de l'agent ${kind}`}
        onChange={(event) => onModel(event.target.value)}
      >
        <option value="">modèle par défaut de l'agent</option>
        {catalog.models
          .filter((candidate) => !unfiltered || candidate.id.includes(model))
          .slice(0, 200)
          .map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label !== undefined
                ? `${candidate.label} · ${candidate.id}`
                : candidate.id}
            </option>
          ))}
      </select>

      {levels.length > 0 ? (
        <select
          className="launch__model"
          value={thinking}
          aria-label="Niveau de raisonnement"
          onChange={(event) => setThinking(event.target.value)}
        >
          <option value="">raisonnement par défaut</option>
          {levels.map((level) => (
            <option key={level} value={level}>
              raisonnement : {levelLabel(level)}
            </option>
          ))}
        </select>
      ) : selected !== undefined ? (
        <p className="muted small">ce modèle ne déclare aucun niveau de raisonnement</p>
      ) : null}
    </div>
  );
};
