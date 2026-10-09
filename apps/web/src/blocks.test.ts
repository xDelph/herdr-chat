/**
 * Tests d'analyse des blocs.
 *
 * Les fixtures viennent des **formes documentées** par Pi (`message-types.md`)
 * et des **outils réellement rencontrés** dans les sessions : `bash` (3 964
 * appels), `edit` (801), `read` (499), `write` (372).
 *
 * Ce fichier protège une chose précise : que chaque type de bloc produise un
 * affichage typé, et qu'un bloc inconnu n'emporte pas tout le message.
 */
import { describe, expect, test } from "bun:test";
import { blockToText, contentToText, toMessages, toBlocks } from "./blocks.ts";

const line = (message: unknown, type = "message") =>
  JSON.stringify({ id: "e1", message, parentId: null, type });

describe("toBlocks", () => {
  test("texte simple", () => {
    const blocks = toBlocks([{ text: "Bonjour", type: "text" }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ kind: "text", text: "Bonjour" });
  });

  test("réflexion, avec l'indicateur de masquage", () => {
    const blocks = toBlocks([{ thinking: "je réfléchis", type: "thinking" }]);
    expect(blocks[0]?.kind).toBe("thinking");
    if (blocks[0]?.kind === "thinking") {
      expect(blocks[0].thinking).toBe("je réfléchis");
      expect(blocks[0].redacted).toBe(false);
    }
  });

  test("réflexion masquée : conservée même sans texte visible", () => {
    const blocks = toBlocks([{ redacted: true, type: "thinking" }]);
    expect(blocks).toHaveLength(1);
    if (blocks[0]?.kind === "thinking") expect(blocks[0].redacted).toBe(true);
  });

  test("appel d'outil : arguments décodés en objet", () => {
    const blocks = toBlocks([
      { arguments: { command: "ls -la" }, id: "c1", name: "bash", type: "toolCall" },
    ]);
    expect(blocks[0]?.kind).toBe("toolCall");
    if (blocks[0]?.kind === "toolCall") {
      expect(blocks[0].name).toBe("bash");
      expect(blocks[0].arguments["command"]).toBe("ls -la");
    }
  });

  test("appel d'outil sans arguments ne casse pas", () => {
    const blocks = toBlocks([{ name: "gd", type: "toolCall" }]);
    expect(blocks[0]?.kind).toBe("toolCall");
    if (blocks[0]?.kind === "toolCall") expect(blocks[0].arguments).toEqual({});
  });

  test("image conservée avec son type MIME", () => {
    const blocks = toBlocks([{ data: "AAAA", mimeType: "image/png", type: "image" }]);
    expect(blocks[0]).toEqual({ data: "AAAA", kind: "image", mimeType: "image/png" });
  });

  test("bloc de type inconnu ignoré, les autres survivent", () => {
    const blocks = toBlocks([
      { text: "avant", type: "text" },
      { type: "futurTypeInconnu", payload: 1 },
      { text: "après", type: "text" },
    ]);
    expect(blocks).toHaveLength(2);
  });

  test("texte vide ignoré : pas de bloc blanc", () => {
    expect(toBlocks([{ text: "   \n ", type: "text" }])).toEqual([]);
  });

  test("contenu non-tableau → aucun bloc, jamais une exception", () => {
    expect(toBlocks(undefined)).toEqual([]);
    expect(toBlocks(42)).toEqual([]);
    expect(toBlocks({})).toEqual([]);
  });
});

describe("contentToText", () => {
  test("chaîne nue", () => {
    expect(contentToText("texte")).toBe("texte");
  });

  test("blocs concaténés, blocs sans texte ignorés", () => {
    expect(contentToText([{ text: "a", type: "text" }, { type: "toolCall" }, { text: "b" }])).toBe(
      "ab",
    );
  });
});

describe("toMessages", () => {
  test("message assistant avec texte et appel d'outil", () => {
    const messages = toMessages([
      {
        id: "m1",
        raw: line({
          content: [
            { text: "Je regarde.", type: "text" },
            { arguments: { command: "ls" }, name: "bash", type: "toolCall" },
          ],
          model: "space-bunny-free",
          role: "assistant",
          usage: { cost: { total: 0.0123 }, totalTokens: 4567 },
        }),
        type: "message",
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.blocks).toHaveLength(2);
    expect(messages[0]?.meta["model"]).toBe("space-bunny-free");
    expect(messages[0]?.meta["tokens"]).toBe("4567");
    expect(messages[0]?.meta["cost"]).toBe("0.0123");
  });

  test("résultat d'outil en échec porte l'indicateur d'erreur", () => {
    const messages = toMessages([
      {
        id: "m2",
        raw: line({
          content: [{ text: "commande introuvable", type: "text" }],
          isError: true,
          role: "toolResult",
          toolName: "bash",
        }),
        type: "message",
      },
    ]);

    const block = messages[0]?.blocks[0];
    expect(block?.kind).toBe("toolResult");
    if (block?.kind === "toolResult") {
      expect(block.isError).toBe(true);
      expect(block.toolName).toBe("bash");
      expect(block.text).toBe("commande introuvable");
    }
  });

  test("exécution shell directe : commande, sortie, code de retour", () => {
    const messages = toMessages([
      {
        id: "m3",
        raw: line({
          cancelled: false,
          command: "git status",
          exitCode: 0,
          output: "rien à valider",
          role: "bashExecution",
        }),
        type: "message",
      },
    ]);

    expect(messages[0]?.role).toBe("bashExecution");
    const block = messages[0]?.blocks[0];
    if (block?.kind === "bashExecution") {
      expect(block.command).toBe("git status");
      expect(block.output).toBe("rien à valider");
      expect(block.exitCode).toBe(0);
    } else {
      throw new Error("bloc bashExecution attendu");
    }
  });

  test("les entrées non-message sont ignorées", () => {
    const messages = toMessages([
      { raw: '{"type":"session","version":3}', type: "session" },
      { raw: '{"type":"model_change"}', type: "model_change" },
      { raw: '{"type":"compaction"}', type: "compaction" },
    ]);
    expect(messages).toEqual([]);
  });

  test("un appel d'outil nommé rend le message affichable", () => {
    const messages = toMessages([
      {
        id: "m",
        raw: line({
          content: [{ arguments: {}, name: "bash", type: "toolCall" }],
          role: "assistant",
        }),
        type: "message",
      },
    ]);
    expect(messages).toHaveLength(1);
  });

  test("un appel d'outil SANS nom est écarté — il n'y a rien à afficher", () => {
    // `name` est requis pour identifier l'outil. Sans lui, aucun rendu typé
    // n'est possible : le bloc est ignoré, pas rendu en JSON à deviner.
    const messages = toMessages([
      {
        id: "m",
        raw: line({ content: [{ type: "toolCall" }], role: "assistant" }),
        type: "message",
      },
    ]);
    expect(messages).toEqual([]);
  });

  test("message au contenu vide est écarté", () => {
    const empty = toMessages([
      {
        id: "m",
        raw: line({ content: [{ text: "", type: "text" }], role: "assistant" }),
        type: "message",
      },
    ]);
    expect(empty).toEqual([]);
  });

  test("une ligne illisible n'empêche pas les autres", () => {
    const messages = toMessages([
      { raw: "{ tronqué", type: "message" },
      { id: "ok", raw: line({ content: "bonjour", role: "user" }), type: "message" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
  });
});

describe("blockToText", () => {
  test("produit un texte cherchable pour chaque type", () => {
    expect(blockToText({ kind: "text", text: "abc" })).toBe("abc");
    expect(blockToText({ kind: "thinking", redacted: false, thinking: "réflexion" })).toBe(
      "réflexion",
    );
    expect(blockToText({ data: "x", kind: "image", mimeType: "image/png" })).toBe("[image]");
    expect(blockToText({ arguments: {}, id: "i", kind: "toolCall", name: "bash" })).toBe("[bash]");
  });
});
