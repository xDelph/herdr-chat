/**
 * Arguments de lancement d'un agent — **le vocabulaire est celui de l'agent**.
 *
 * Chaque agent nomme et applique différemment sa commande de modèle et son niveau
 * de raisonnement, et Herdr ne fait que retransmettre `args` au binaire
 * (`argv` renvoyé par `agent.start`, vérifié par exécution). C'est donc ici,
 * et nulle part ailleurs, que se décide la forme des drapeaux :
 *
 * | kind    | modèle              | raisonnement                        |
 * |---------|---------------------|-------------------------------------|
 * | `pi`    | `--model <id>`      | `--thinking <niveau>`               |
 * | `claude`| `--model <alias>`   | `--effort <niveau>`                 |
 * | `codex` | `-m <id>`              | `--config model_reasoning_effort="<n>"` |
 * | `cursor`| `--model <id>`      | **aucun** : le niveau est dans le nom |
 *
 * ⚠️ Un `thinking` demandé alors que le modèle ne le supporte pas, ou que le
 * kind ne sait pas le transmettre, est **refusé** : mieux vaut un refus
 * explicite qu'un agent lancé avec une option qu'il ignore en silence.
 */
import { CATALOG_KINDS, catalogOf } from "./ModelCatalog.ts";
import { Effect } from "effect";

/** Kinds dont on sait construire des args de modèle/raisonnement. */
export const MODEL_AWARE_KINDS: ReadonlyArray<string> = CATALOG_KINDS;

/** Résultat de la construction : soit des args, soit une raison de refus. */
export type ArgsOutcome =
  | { readonly args: ReadonlyArray<string>; readonly error?: undefined }
  | { readonly args: ReadonlyArray<string>; readonly error: string };

/**
 * Construit les args de modèle et de raisonnement.
 *
 * `thinking` est refusé si le kind ne sait pas le transmettre, et si le modèle
 * choisi déclare explicitement une liste de niveaux qui ne le contient pas.
 */
export const buildModelArgs = (
  kind: string,
  model: string | undefined,
  thinking: string | undefined,
): Effect.Effect<ArgsOutcome> =>
  Effect.sync((): ArgsOutcome => {
    const hasModel = model !== undefined && model.trim().length > 0;
    const hasThinking = thinking !== undefined && thinking.trim().length > 0;
    if (!hasModel && !hasThinking) return { args: [] };

    const level = hasThinking ? (thinking ?? "").trim() : undefined;
    const target = hasModel ? (model ?? "").trim() : undefined;

    // Aucun modèle demandé, mais un raisonnement : on ne devine pas quel
    // modèle appliquer. Claude l'autorise (effort indépendant), les autres non.
    if (!hasModel) {
      if (kind === "claude" && level !== undefined) {
        return { args: ["--effort", level] };
      }
      return {
        args: [],
        error: `« ${kind} » exige un modèle pour choisir un niveau de raisonnement`,
      };
    }
    const modelId = target ?? "";

    switch (kind) {
      case "pi":
        return {
          args: ["--model", modelId, ...(level !== undefined ? ["--thinking", level] : [])],
        };

      case "claude":
        return {
          args: ["--model", modelId, ...(level !== undefined ? ["--effort", level] : [])],
        };

      case "codex":
        // Forme canonique du CLI : `-m/--model` et `--config key=value`.
        // Le niveau est **validé par modèle** en amont : un `ultra` demandé
        // sur un modèle qui ne le propose pas est refusé, pas transmis.
        return {
          args: [
            "-m",
            modelId,
            ...(level !== undefined ? ["--config", `model_reasoning_effort="${level}"`] : []),
          ],
        };

      case "cursor":
        // ⚠️ Cursor n'a **pas** de paramètre de niveau : il est encodé dans le
        // nom du modèle (`…-high`, `…-xhigh`). Envoyer un niveau ici
        // produirait une option inconnue, peut-être un refus.
        if (level !== undefined) {
          return {
            args: ["--model", modelId],
            error:
              "chez cursor le niveau de raisonnement fait partie du nom du modèle : choisissez le modèle qui l'inclut",
          };
        }
        return { args: ["--model", modelId] };

      default:
        return {
          args: [],
          error: `aucun mécanisme de lancement vérifié pour « ${kind} »`,
        };
    }
  });

/**
 * Vérifie qu'un niveau demandé est bien **supporté par le modèle choisi**.
 *
 * On ne s'appuie que sur ce que l'agent **déclare** : un `thinkingLevels`
 * vide signifie « je ne le sais pas », et on laisse alors passer plutôt que
 * de bloquer sur une absence d'information.
 */
export const checkThinkingSupported = (
  kind: string,
  model: string,
  thinking: string,
): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    if (thinking.trim().length === 0) return null;
    if (!MODEL_AWARE_KINDS.includes(kind)) {
      return `« ${kind} » : niveau de raisonnement non vérifié`;
    }
    const catalog = yield* catalogOf(kind);
    const found = catalog.models.find((candidate) => candidate.id === model);
    // Modèle absent du catalogue : on ne tranche pas à sa place.
    if (found === undefined) return null;
    if (found.thinkingLevels.length === 0) return null;
    if (found.thinkingLevels.includes(thinking.trim())) return null;
    return `« ${model} » ne propose pas le niveau « ${thinking.trim()} » (disponible : ${found.thinkingLevels.join(", ")})`;
  });
