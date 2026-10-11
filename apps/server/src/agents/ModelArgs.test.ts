/**
 * Args de lancement — les règles qui **doivent** refuser.
 *
 * ⚠️ Ces tests ne vérifient pas « ça marche » : ils vérifient qu'une porte
 * sait **échouer**. Une porte qui n'a jamais refusé n'est pas une porte.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { buildModelArgs } from "./ModelArgs.ts";
import type { ArgsOutcome } from "./ModelArgs.ts";

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
    for (const kind of ["pi", "claude", "codex", "cursor"]) {
      const r = await build(kind, undefined, undefined);
      expect(r.args).toEqual([]);
    }
    // Une chaîne vide n'est **pas** un choix : elle ne doit rien ajouter.
    const blank = await build("pi", "   ", "");
    expect(blank.args).toEqual([]);
  });
});
