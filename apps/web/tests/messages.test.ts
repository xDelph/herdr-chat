/**
 * Tests d'extraction des messages.
 *
 * Le test central est **« décode une ligne brute »** : il reproduit le désordre
 * d'origine — passer une chaîne JSON là où un objet est attendu — et vérifie
 * qu'on obtient bien un message. Sans lui, la conversation restait vide en
 * silence, et le défaut n'était visible qu'en ouvrant l'application sur un
 * téléphone.
 */
import { describe, expect, test } from "bun:test";
import { contentToText, decodeRawLine, toBubbles } from "../src/messages.ts";
import { fusionnerEntrees } from "../src/messages.ts";

const userLine = JSON.stringify({
  id: "a1",
  message: { content: "Bonjour", role: "user", timestamp: 1_700_000_000_000 },
  parentId: null,
  timestamp: "2026-10-09T00:00:00.000Z",
  type: "message",
});

const assistantLine = JSON.stringify({
  id: "b2",
  message: {
    api: "openai-completions",
    content: [
      { text: "Voici la réponse.", type: "text" },
      { type: "toolCall", toolName: "bash" },
      { text: " Et la suite.", type: "text" },
    ],
    model: "space-bunny-free",
    provider: "opencode-go",
    role: "assistant",
  },
  parentId: "a1",
  timestamp: "2026-10-09T00:00:01.000Z",
  type: "message",
});

describe("decodeRawLine", () => {
  test("décode une ligne brute JSON — le désordre d'origine", () => {
    // ⚠️ C'est exactement ce que faisait le composant : passer la chaîne brute
    // au schéma. Vérifié ici que la fonction, elle, analyse PUIS décode.
    const line = decodeRawLine(userLine);
    expect(line).toBeDefined();
    expect(line?.message?.role).toBe("user");
    expect(line?.message?.content).toBe("Bonjour");
  });

  test("renvoie undefined sur une ligne illisible, sans lever", () => {
    expect(decodeRawLine("pas du json")).toBeUndefined();
  });

  test("renvoie undefined sur un JSON qui n'est pas une ligne de session", () => {
    expect(decodeRawLine('"une chaîne"')).toBeUndefined();
    expect(decodeRawLine("42")).toBeUndefined();
    expect(decodeRawLine("[1,2,3]")).toBeUndefined();
  });

  test("ignore les champs non déclarés sans échouer", () => {
    const line = decodeRawLine(assistantLine);
    expect(line?.message?.role).toBe("assistant");
  });
});

describe("contentToText", () => {
  test("chaîne simple", () => {
    expect(contentToText("Bonjour")).toBe("Bonjour");
  });

  test("blocs texte concaténés, blocs sans texte ignorés", () => {
    expect(
      contentToText([
        { text: "Voici la réponse.", type: "text" },
        { type: "toolCall" },
        { text: " Et la suite.", type: "text" },
      ]),
    ).toBe("Voici la réponse. Et la suite.");
  });

  test("contenu inattendu → chaîne vide, jamais une exception", () => {
    expect(contentToText(undefined)).toBe("");
    expect(contentToText(null)).toBe("");
    expect(contentToText(42)).toBe("");
    expect(contentToText({})).toBe("");
  });
});

describe("toBubbles", () => {
  test("produit une bulle par message textuel", () => {
    const bubbles = toBubbles([
      { id: "a1", raw: userLine, type: "message" },
      { id: "b2", raw: assistantLine, type: "message" },
    ]);

    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]?.role).toBe("user");
    expect(bubbles[0]?.text).toBe("Bonjour");
    expect(bubbles[1]?.role).toBe("assistant");
    expect(bubbles[1]?.text).toBe("Voici la réponse. Et la suite.");
  });

  test("c'est le test qui aurait attrapé la conversation vide", () => {
    const bubbles = toBubbles([{ id: "a1", raw: userLine, type: "message" }]);
    expect(bubbles.length).toBeGreaterThan(0);
  });

  test("ignore les entrées qui ne sont pas des messages", () => {
    const bubbles = toBubbles([
      { id: "s", raw: '{"type":"session","version":3}', type: "session" },
      {
        id: "m",
        raw: '{"type":"model_change","provider":"x","modelId":"y"}',
        type: "model_change",
      },
    ]);
    expect(bubbles).toEqual([]);
  });

  test("ignore les messages sans texte plutôt que d'afficher un bloc vide", () => {
    const empty = JSON.stringify({ message: { content: "", role: "system" }, type: "message" });
    const blank = JSON.stringify({
      message: { content: [{ type: "toolCall" }], role: "assistant" },
      type: "message",
    });
    expect(toBubbles([{ raw: empty, type: "message" }])).toEqual([]);
    expect(toBubbles([{ raw: blank, type: "message" }])).toEqual([]);
  });

  test("une ligne illisible n'empêche pas les autres de s'afficher", () => {
    const bubbles = toBubbles([
      { id: "x", raw: "{ tronqué", type: "message" },
      { id: "a1", raw: userLine, type: "message" },
    ]);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.text).toBe("Bonjour");
  });

  test("produit un identifiant stable quand la ligne n'en a pas", () => {
    const first = toBubbles([{ raw: userLine, type: "message" }]);
    const second = toBubbles([{ raw: userLine, type: "message" }]);
    expect(first[0]?.id).toBe(second[0]?.id);
  });
});

/** Une entrée d'affichage minimale : un identifiant, et de quoi le distinguer. */
const entree = (id: string | undefined, texte: string) => ({ id, texte });

describe("fusion d'une page incrémentale", () => {
  test("une entrée nouvelle s'ajoute à la fin", () => {
    const fusion = fusionnerEntrees([entree("a", "un")], [entree("b", "deux")]);

    expect(fusion.map((item) => item.texte)).toEqual(["un", "deux"]);
  });

  test("une entrée DÉJÀ affichée est remplacée, pas dupliquée", () => {
    // ⚠️ Le défaut que ce test encadre : opencode réécrit la ligne d'un message
    // pendant qu'il le compose. Le serveur relit donc la ligne du curseur à
    // chaque tour — sans remplacement, la même réponse s'afficherait autant de
    // fois qu'il y a de rafraîchissements.
    const fusion = fusionnerEntrees([entree("a", "début")], [entree("a", "début et suite")]);

    expect(fusion.length).toBe(1);
    expect(fusion[0]?.texte).toBe("début et suite");
  });

  test("le remplacement garde la position", () => {
    const fusion = fusionnerEntrees(
      [entree("a", "un"), entree("b", "deux"), entree("c", "trois")],
      [entree("b", "deux corrigé")],
    );

    expect(fusion.map((item) => item.texte)).toEqual(["un", "deux corrigé", "trois"]);
  });

  test("un mélange : les unes remplacées, les autres ajoutées", () => {
    const fusion = fusionnerEntrees(
      [entree("a", "un")],
      [entree("a", "un bis"), entree("b", "deux")],
    );

    expect(fusion.map((item) => item.texte)).toEqual(["un bis", "deux"]);
  });

  test("rejouer la même page ne change RIEN — la fusion est idempotente", () => {
    // C'est ce qui rend une reprise après coupure sûre : rejouer une page déjà
    // vue ne peut pas faire grossir l'affichage.
    const page = [entree("a", "un"), entree("b", "deux")];
    const une = fusionnerEntrees([], page);
    const deux = fusionnerEntrees(une, page);

    expect(deux).toEqual(une);
  });

  test("une entrée sans identifiant n'est JAMAIS dédupliquée", () => {
    // ⚠️ Les confondre sous une clé `undefined` effacerait des messages réels —
    // un défaut bien pire que le doublon qu'on cherche à éviter.
    const fusion = fusionnerEntrees([entree(undefined, "un")], [entree(undefined, "deux")]);

    expect(fusion.map((item) => item.texte)).toEqual(["un", "deux"]);
  });

  test("une page vide ne touche à rien", () => {
    const affichees = [entree("a", "un")];

    expect(fusionnerEntrees(affichees, [])).toEqual(affichees);
  });
});
