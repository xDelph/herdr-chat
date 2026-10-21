/**
 * Changement du modèle et du niveau de pensée d'un agent, depuis le téléphone.
 *
 * **Pourquoi.** Pi règle son modèle et sa pensée par des commandes
 * `/model …` et `/thinking …` tapées dans son éditeur. Depuis l'iPhone, les
 * taper à la main dans le composeur marche, mais personne ne les connaît
 * par cœur — et une faute de frappe part dans la conversation comme un
 * message ordinaire.
 *
 * **Mécanisme.**
 *
 * La feuille envoie la commande exacte **par le même chemin qu'un prompt**
 * (`POST /api/agents/:paneId/prompt`) : confirmation par Herdr, suppression
 * des doubles envois, événement de journal. Aucune capacité Herdr nouvelle
 * n'est invoquée.
 *
 * **Vérifié par exécution** (pane jetable, `scripts/test-agent.sh`) :
 *   - `/thinking low` envoyé via `agent.prompt` → la barre d'état de Pi passe
 *     de `high` à `low` ;
 *   - `/model openrouter/deepseek/deepseek-v4-flash` → le modèle affiché
 *     change dans la barre d'état de Pi.
 *
 * La confirmation affichée ici est celle de **la transmission** : l'agent
 * exécute la commande chez lui, on ne prétend pas contrôler son résultat.
 */
import { useEffect, useState } from "react";
import { fetchModelCatalog, reportError, sendPrompt } from "./api.ts";
import type { SendResult } from "./api.ts";
import type { ModelCatalogResponse } from "@herdr-remote/shared";
import type { AgentModel } from "@herdr-remote/shared";
import { Feuille } from "./Feuille.tsx";
import { Notice } from "./Notice.tsx";
import { expliquerEnvoi, expliquerEchec, expliquerSuppression } from "./etats-envoi.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Libellé lisible d'un niveau de pensée. */
export const thinkingLabel = (level: string): string => {
  switch (level) {
    case "off":
      return "off";
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "extra high";
    case "max":
      return "maximum";
    default:
      return level;
  }
};

/**
 * Libellé d'un état d'envoi — utilisé par le composeur **et** par la feuille
 * modèle, pour qu'il n'existe qu'une seule formulation.
 */
/**
 * Un envoi, rendu selon son état réel (U08).
 *
 * ⚠️ Avant, les trois échecs se réduisaient à `échec : …`. `attente`,
 * `erreur` et `inconnu` se corrigent différemment — renvoyer, corriger, ne rien
 * faire — et un préfixe commun les rendait indiscernables sur une capture
 * d'écran. Les textes et les actions viennent de `etats-envoi.ts`.
 */
export const describeSend = (result: SendResult): string => {
  if (result.kind === "sent") return expliquerEnvoi(result.confirmation).texte;
  if (result.kind === "suppressed") return expliquerSuppression(result.reason).texte;
  return expliquerEchec(result.state, result.message).texte;
};

interface Props {
  readonly agentName: string;
  /** Type d'agent (`pi`, `claude`…) : c'est lui qui décide du catalogue. */
  readonly kind: string;
  readonly paneId: string;
  readonly currentModel: string | undefined;
  readonly currentProvider: string | undefined;
  readonly currentThinking: string | undefined;
  readonly onClose: () => void;
}

const providerOf = (modelId: string): string | null => {
  const separator = modelId.indexOf("/");
  return separator < 0 ? null : modelId.slice(0, separator);
};

const currentModelInCatalog = (
  models: ReadonlyArray<AgentModel>,
  kind: string,
  model: string | undefined,
  provider: string | undefined,
): string | null => {
  if (model === undefined) return null;
  if (models.some((candidate) => candidate.id === model)) return model;
  if (kind !== "pi") return null;
  if (provider !== undefined) {
    const qualified = `${provider}/${model}`;
    if (models.some((candidate) => candidate.id === qualified)) return qualified;
  }
  const suffixMatches = models.filter((candidate) => candidate.id.endsWith(`/${model}`));
  return suffixMatches.length === 1 ? (suffixMatches[0]?.id ?? null) : null;
};

export const ModelSheet = ({
  agentName,
  currentModel,
  currentProvider,
  currentThinking,
  kind,
  paneId,
  onClose,
}: Props) => {
  /** Catalogue mesuré de cet agent, son absence comprise. */
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  /** `undefined` garde la valeur courante présélectionnée ; `null` = choix effacé. */
  const [modeleChoisi, setModeleChoisi] = useState<string | null | undefined>(undefined);
  const [fournisseurChoisi, setFournisseurChoisi] = useState<string | null | undefined>(undefined);
  const [penseeChoisie, setPenseeChoisie] = useState<string | null | undefined>(undefined);
  /** Réduit les options du menu quand le catalogue est volumineux. */
  const [filter, setFilter] = useState("");
  const [resultats, setResultats] = useState<
    ReadonlyArray<{ readonly command: string; readonly result: SendResult }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [modeleTransmis, setModeleTransmis] = useState<string | undefined>(undefined);
  const [penseeTransmise, setPenseeTransmise] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchModelCatalog(kind);
        if (!cancelled) setCatalog(result);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (!cancelled) {
          setCatalogError(message);
          reportError("failed to read the model catalog", { kind, message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);
  const modeleActuel =
    catalog === null
      ? null
      : currentModelInCatalog(catalog.models, kind, currentModel, currentProvider);
  const modelId = modeleChoisi === undefined ? modeleActuel : modeleChoisi;
  const modele = catalog?.models.find((candidate) => candidate.id === modelId) ?? null;
  const providerActuel =
    currentProvider ?? (modeleActuel === null ? null : providerOf(modeleActuel));
  const provider = fournisseurChoisi === undefined ? providerActuel : fournisseurChoisi;
  const providers =
    kind === "pi" && catalog !== null
      ? [
          ...new Set(
            catalog.models
              .map((candidate) => providerOf(candidate.id))
              .filter((value) => value !== null),
          ),
        ]
      : [];
  const modelesVisibles =
    catalog?.models.filter((candidate) => {
      const appartient =
        kind !== "pi" || provider === null || providerOf(candidate.id) === provider;
      return appartient && candidate.id.toLowerCase().includes(filter.trim().toLowerCase());
    }) ?? [];
  const pensee = penseeChoisie === undefined ? (currentThinking ?? null) : penseeChoisie;
  const modeleBase = modeleTransmis ?? modeleActuel;
  const penseeBase = penseeTransmise ?? currentThinking ?? null;
  const modeleChange = modele !== null && modele.id !== modeleBase;
  const penseeChange = pensee !== null && pensee !== penseeBase;
  const changementsDisponibles = modeleChange || penseeChange;

  const choisirFournisseur = (value: string) => {
    setFournisseurChoisi(value);
    setModeleChoisi(null);
    setPenseeChoisie(null);
    setFilter("");
  };

  const choisirModele = (value: string) => {
    const suivant = catalog?.models.find((candidate) => candidate.id === value) ?? null;
    setModeleChoisi(value);
    setFournisseurChoisi(kind === "pi" ? providerOf(value) : null);
    setPenseeChoisie((precedent) => {
      const conserve = precedent === undefined ? currentThinking : precedent;
      return conserve !== undefined &&
        conserve !== null &&
        suivant?.thinkingLevels.includes(conserve)
        ? conserve
        : null;
    });
  };

  const appliquer = async () => {
    if (busy || modele === null) return;
    const commands: Array<{
      readonly command: string;
      readonly type: "model" | "thinking";
      readonly value: string;
    }> = [];
    if (modeleChange)
      commands.push({
        command: `/model ${modele.id}`,
        type: "model",
        value: modele.id,
      });
    if (penseeChange && pensee !== null) {
      commands.push({
        command: `/thinking ${pensee}`,
        type: "thinking",
        value: pensee,
      });
    }
    if (commands.length === 0) return;

    setBusy(true);
    const sent: Array<{
      readonly command: string;
      readonly result: SendResult;
    }> = [];
    const transmettre = async (index: number): Promise<void> => {
      const entry = commands[index];
      if (entry === undefined) return;
      const { command, type, value } = entry;
      let result: SendResult;
      try {
        result = await sendPrompt(paneId, command);
      } catch (cause) {
        result = {
          kind: "failed",
          message: cause instanceof Error ? cause.message : String(cause),
          state: "inconnu",
        };
      }
      sent.push({ command, result });
      setResultats([...sent]);
      if (result.kind !== "sent") return;
      if (type === "model") setModeleTransmis(value);
      else setPenseeTransmise(value);
      await transmettre(index + 1);
    };
    try {
      // Sequential by design: a failed model command stops the thinking command.
      await transmettre(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Feuille
      ariaLabel={`Model and thinking for ${agentName}`}
      onClose={onClose}
      titre={`Model · ${agentName}`}
    >
      {resultats.length > 0 ? (
        <div className="model__results" aria-live="polite">
          {resultats.map(({ command, result }) => (
            <p className="sendState" key={command}>
              <code>{command}</code> — {busy ? "Sending…" : describeSend(result)}
            </p>
          ))}
        </div>
      ) : null}

      <p className="muted small">
        Your choices are prepared here. Nothing is sent until you tap “Apply”.
      </p>

      {catalogError !== null ? (
        <Notice ton="erreur">
          Catalogue illisible pour <code>{kind}</code> — {catalogError}
        </Notice>
      ) : catalog === null ? (
        <p className="muted small">Loading model catalog…</p>
      ) : catalog.models.length === 0 ? (
        <Notice ton="avertissement">{catalog.error ?? `No verified catalog for ${kind}.`}</Notice>
      ) : (
        <>
          {kind === "pi" ? (
            <section className="model__step" aria-labelledby="model-provider-title">
              <h3 id="model-provider-title" className="model__title">
                1 · Provider
              </h3>
              <div className="model__providers">
                {providers.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={
                      provider === candidate
                        ? "model__provider model__provider--on"
                        : "model__provider"
                    }
                    aria-pressed={provider === candidate}
                    disabled={busy}
                    onClick={() => choisirFournisseur(candidate)}
                  >
                    {candidate}
                    <span className="muted small">
                      {catalog.models.filter((model) => providerOf(model.id) === candidate).length}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {kind !== "pi" || provider !== null ? (
            <section className="model__step" aria-labelledby="model-choice-title">
              <h3 id="model-choice-title" className="model__title">
                {kind === "pi" ? "2 · Model" : "Model"}
              </h3>
              <input
                type="search"
                className="model__search"
                value={filter}
                placeholder={`Filter ${String(modelesVisibles.length)} models`}
                aria-label="Filter models"
                onChange={(event) => setFilter(event.target.value)}
              />
              <label className="model__label" htmlFor="model-choice">
                Model
              </label>
              <select
                id="model-choice"
                className="model__select"
                value={modelId ?? ""}
                disabled={busy}
                onChange={(event) => choisirModele(event.currentTarget.value)}
              >
                <option value="">Choose a model…</option>
                {modelesVisibles.map((candidate) => {
                  const label =
                    kind === "pi" && provider !== null
                      ? candidate.id.slice(provider.length + 1)
                      : (candidate.label ?? candidate.id);
                  return (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.id === modeleActuel ? `${label} · Current` : label}
                    </option>
                  );
                })}
              </select>
              {modeleActuel === null ? (
                <p className="muted small">Current model is not declared in the session.</p>
              ) : (
                <p className="muted small">
                  Current model: <code>{modeleActuel}</code>
                </p>
              )}
              {modelesVisibles.length === 0 ? (
                <p className="muted small">No models match this filter.</p>
              ) : null}
            </section>
          ) : (
            <p className="muted small">Choose a provider to see its models.</p>
          )}
        </>
      )}

      {modele !== null && modele.thinkingLevels.length > 0 ? (
        <section className="model__step" aria-labelledby="thinking-title">
          <h3 id="thinking-title" className="model__title">
            {kind === "pi" ? "3 · Thinking" : "Thinking level"}
          </h3>
          <p className="muted small">
            {currentThinking === undefined
              ? "Current thinking level unknown."
              : `Current: ${thinkingLabel(currentThinking)}.`}
          </p>
          <div className="model__chips">
            {modele.thinkingLevels.map((level) => {
              const selected = pensee === level;
              return (
                <button
                  key={level}
                  type="button"
                  className={selected ? "model__chip model__chip--on" : "model__chip"}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => setPenseeChoisie(level)}
                >
                  {thinkingLabel(level)}
                </button>
              );
            })}
          </div>
        </section>
      ) : modele !== null ? (
        <p className="muted small">This model does not declare a separate thinking level.</p>
      ) : null}

      <div className="model__actions">
        <button
          type="button"
          className="row__action row__action--primary"
          disabled={busy || modele === null || !changementsDisponibles}
          onClick={() => void appliquer()}
        >
          {busy ? "Sending…" : "Apply changes"}
        </button>
        <p className="muted small">
          Confirmation means the command reached the agent; it does not confirm the setting was
          applied.
        </p>
      </div>
    </Feuille>
  );
};
