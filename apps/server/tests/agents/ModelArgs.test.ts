/**
 * Args de lancement — les règles qui **doivent** refuser.
 *
 * ⚠️ Ces tests ne vérifient pas « ça marche » : ils vérifient qu'une porte
 * sait **échouer**. Une porte qui n'a jamais refusé n'est pas une porte.
 */
import {
  MODEL_CATALOG_CACHE_MS,
  MODEL_CATALOG_STDERR_BYTES,
  MODEL_CATALOG_STDOUT_BYTES,
  MODEL_CATALOG_TIMEOUT_MS,
} from "@herdr-remote/shared";
import { catalogOf, clearCatalogCache } from "../../src/agents/ModelCatalog.ts";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { buildModelArgs } from "../../src/agents/ModelArgs.ts";
import type { ArgsOutcome } from "../../src/agents/ModelArgs.ts";

const build = async (
  kind: string,
  model: string | undefined,
  thinking: string | undefined,
): Promise<ArgsOutcome> => Effect.runPromise(buildModelArgs(kind, model, thinking));

describe("ModelArgs — le vocabulaire est celui de chaque agent", () => {
  test("pi : --model et --thinking", async () => {
    const r = await build("pi", "openrouter/anthropic/claude-opus-5", "high");
    expect(r.error).toBeUndefined();
    expect(r.args).toEqual(["--model", "openrouter/anthropic/claude-opus-5", "--thinking", "high"]);
  });

  test("claude : --effort, PAS --thinking", async () => {
    const r = await build("claude", "sonnet", "high");
    expect(r.args).toEqual(["--model", "sonnet", "--effort", "high"]);
    // ⚠️ `--thinking` serait refusé par claude : c'est une option inconnue.
    expect(r.args).not.toContain("--thinking");
  });

  test("codex : -m et --config, la forme du CLI", async () => {
    const r = await build("codex", "gpt-6-luna", "medium");
    expect(r.args).toEqual(["-m", "gpt-6-luna", "--config", 'model_reasoning_effort="medium"']);
  });

  test("cursor : pas de paramètre de niveau — il est dans le nom du modèle", async () => {
    const r = await build("cursor", "gpt-5.6-sol-high", undefined);
    expect(r.error).toBeUndefined();
    expect(r.args).toEqual(["--model", "gpt-5.6-sol-high"]);
  });

  test("cursor : exiger un niveau séparé est un REFUS explicite", async () => {
    const r = await build("cursor", "gpt-5.6-sol", "high");
    // On ne fabrique pas une option que l'agent n'a pas.
    expect(r.error).toBeDefined();
    expect(r.args.join(" ")).not.toContain("high");
  });
});

describe("ModelArgs — portes de refus", () => {
  test("un kind non mesuré est refusé, pas deviné", async () => {
    const r = await build("gemini", "quelconque", undefined);
    expect(r.error).toBeDefined();
    expect(r.args).toEqual([]);
  });

  test("un niveau sans modèle est refusé sauf chez claude", async () => {
    const pi = await build("pi", undefined, "high");
    expect(pi.error).toBeDefined();
    expect(pi.args).toEqual([]);

    // Claude accepte un effort indépendant du modèle.
    const claude = await build("claude", undefined, "high");
    expect(claude.error).toBeUndefined();
    expect(claude.args).toEqual(["--effort", "high"]);
  });

  test("aucun choix = aucun argument (les valeurs de l'agent restent les siennes)", async () => {
    // Les quatre agents sont indépendants : `Promise.all` les traite en parallèle
    // et garde l'ordre, donc l'échec reste rattaché au **nom** de l'agent.
    const kinds = ["pi", "claude", "codex", "cursor"] as const;
    const built = await Promise.all(
      kinds.map(async (kind) => ({ args: (await build(kind, undefined, undefined)).args, kind })),
    );
    for (const { args, kind } of built) {
      expect(`${kind} → ${JSON.stringify(args)}`).toBe(`${kind} → []`);
    }
    // Une chaîne vide n'est **pas** un choix : elle ne doit rien ajouter.
    const blank = await build("pi", "   ", "");
    expect(blank.args).toEqual([]);
  });
});

/**
 * B09 — le catalogue est borné, regroupé et mis en cache.
 *
 * Ce qui compte ici n'est pas la liste de modèles : c'est qu'une commande
 * dite, exécutée avec des bornes, ne peut pas faire tomber la requête.
 */
describe("B09 — bornes et regroupement", () => {
  test("le délai et les bornes viennent du contrat partagé", () => {
    expect(MODEL_CATALOG_TIMEOUT_MS).toBe(20_000);
    expect(MODEL_CATALOG_STDOUT_BYTES).toBe(2 * 1024 * 1024);
    expect(MODEL_CATALOG_STDERR_BYTES).toBe(64 * 1024);
    expect(MODEL_CATALOG_CACHE_MS).toBe(60_000);
  });

  test("un type sans mécanisme renvoie une raison, jamais une liste devinée", () => {
    const resultat = Effect.runSync(catalogOf("type-inconnu"));
    expect(resultat.models).toEqual([]);
    expect(resultat.source).toBe("aucune");
    expect(resultat.error).toContain("type-inconnu");
  });

  test("un échec n'est pas mis en cache comme un succès", async () => {
    clearCatalogCache();
    const premier = await Effect.runPromise(Effect.result(catalogOf("codex")));
    // Un catalogue en échec reste en échec : le cache ne doit pas le figer
    // pendant une minute entière après une coupure réseau.
    const echec = premier._tag === "Failure" || premier.success.error !== null;
    const deuxieme = await Effect.runPromise(Effect.result(catalogOf("codex")));
    if (echec) {
      expect(deuxieme._tag === "Failure" || deuxieme.success.error !== null).toBe(true);
    }
    clearCatalogCache();
  });
});
