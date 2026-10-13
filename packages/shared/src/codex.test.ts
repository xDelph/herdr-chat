/**
 * L'adaptateur codex → pi.
 *
 * ⚠️ Ces tests encodent une **mesure**, pas une supposition. Les charges utiles
 * sont recopiées de vraies lignes de `rollout-*.jsonl` sous `~/.codex/sessions/`
 * (2026-10-13, codex tel qu'installé sur cette machine). Si codex change de
 * format, un de ces tests tombe — c'est le but.
 */
import { describe, expect, test } from "bun:test";
import { ligneCodexVersPi } from "./codex.ts";

/** Enveloppe codex : `timestamp`, `ordinal`, `type`, `payload`. */
const item = (payload: Record<string, unknown>): unknown => ({
  ordinal: 11,
  payload: { type: "message", ...payload },
  timestamp: "2026-10-13T07:44:03.616Z",
  type: "response_item",
});

describe("codex → pi", () => {
  test("un message utilisateur devient un message pi", () => {
    const ligne = ligneCodexVersPi(
      item({ content: [{ text: "hello", text_elements: [], type: "input_text" }], role: "user" }),
    );
    expect(ligne?.type).toBe("message");
    expect(ligne?.timestamp).toBe("2026-10-13T07:44:03.616Z");
    expect(ligne?.message).toEqual({
      content: [{ text: "hello", type: "text" }],
      role: "user",
    });
  });

  test("un message assistant devient un message pi", () => {
    const ligne = ligneCodexVersPi(
      item({
        content: [{ text: "Hello! How can I help?", type: "output_text" }],
        role: "assistant",
      }),
    );
    expect(ligne?.message).toEqual({
      content: [{ text: "Hello! How can I help?", type: "text" }],
      role: "assistant",
    });
  });

  /**
   * ⚠️ Le piège qui remplirait le chat de consignes système. Mesuré : trois
   * messages `developer` dès l'ouverture d'une session. Ils ne font pas partie
   * de la conversation.
   */
  test("le rôle `developer` est ÉCARTÉ — c'est le prompt système", () => {
    expect(
      ligneCodexVersPi(
        item({
          content: [{ text: "You are a helpful agent…", type: "input_text" }],
          role: "developer",
        }),
      ),
    ).toBeUndefined();
  });

  /**
   * ⚠️ Le second piège : `event_msg`/`item_completed` porte la **même**
   * conversation. Le lire en plus de `response_item` afficherait chaque message
   * deux fois.
   */
  test("`event_msg` est écarté : response_item porte déjà le message", () => {
    expect(
      ligneCodexVersPi({
        ordinal: 9,
        payload: {
          item: { content: [{ text: "hello", type: "text" }], type: "UserMessage" },
          type: "item_completed",
        },
        timestamp: "2026-10-13T07:44:01.470Z",
        type: "event_msg",
      }),
    ).toBeUndefined();
  });

  /**
   * ⚠️ Le piège vicieux : codex range `AGENTS.md` en rôle `user`. Le filtre par
   * rôle ne peut donc pas l'attraper — c'est un vrai message de 8 367
   * caractères, indiscernable d'une demande utilisateur par sa forme générale.
   */
  test("le contexte projet injecté est écarté, malgré un rôle `user`", () => {
    expect(
      ligneCodexVersPi(
        item({
          content: [
            {
              text: "# AGENTS.md instructions for /tmp/projet\n\n<INSTRUCTIONS>\n…",
              type: "input_text",
            },
          ],
          role: "user",
        }),
      ),
    ).toBeUndefined();
  });

  test("le contexte injecté occupe PLUSIEURS blocs, et part en entier", () => {
    // Mesuré : `AGENTS.md` puis `<environment_context>`. Un test sur le seul
    // premier bloc laissait passer le second — et l'`AGENTS.md` avec lui.
    expect(
      ligneCodexVersPi(
        item({
          content: [
            {
              text: "# AGENTS.md instructions for /tmp/x\n\n<INSTRUCTIONS>\n…",
              type: "input_text",
            },
            {
              text: "<environment_context>\n  <cwd>/tmp/x</cwd>\n</environment_context>",
              type: "input_text",
            },
          ],
          role: "user",
        }),
      ),
    ).toBeUndefined();
  });

  test("un contexte injecté suivi d'une vraie demande n'efface pas la demande", () => {
    // Le contexte est un bloc, la demande en est un autre : on garde le message,
    // c'est la demande qui compte.
    const ligne = ligneCodexVersPi(
      item({
        content: [
          {
            text: "<environment_context>\n  <cwd>/tmp/x</cwd>\n</environment_context>",
            type: "input_text",
          },
          { text: "corrige le bug", type: "input_text" },
        ],
        role: "user",
      }),
    );
    expect(ligne?.message).toBeDefined();
  });

  test("un utilisateur qui PARLE de son AGENTS.md n'est pas effacé", () => {
    // La marque est exigée **en tête** et **avec** la balise. Sinon on
    // effacerait la demande au lieu du contexte.
    const parle = ligneCodexVersPi(
      item({
        content: [{ text: "Peux-tu relire mon AGENTS.md ?", type: "input_text" }],
        role: "user",
      }),
    );
    expect(parle?.message).toBeDefined();

    const enteteSansBalise = ligneCodexVersPi(
      item({
        content: [{ text: "# AGENTS.md instructions for X mais sans balise", type: "input_text" }],
        role: "user",
      }),
    );
    expect(enteteSansBalise?.message).toBeDefined();
  });

  test("un message sans texte ne fabrique pas de bulle vide", () => {
    expect(ligneCodexVersPi(item({ content: [], role: "user" }))).toBeUndefined();
    expect(
      ligneCodexVersPi(item({ content: [{ text: "", type: "input_text" }], role: "user" })),
    ).toBeUndefined();
  });

  test("les blocs sans texte sont ignorés, les autres survivent", () => {
    const ligne = ligneCodexVersPi(
      item({
        content: [
          { type: "image", url: "file:///x.png" },
          { text: "regarde ça", type: "input_text" },
        ],
        role: "user",
      }),
    );
    expect(ligne?.message).toEqual({
      content: [{ text: "regarde ça", type: "text" }],
      role: "user",
    });
  });

  test("rien de ce qui n'est pas un message ne lève", () => {
    for (const entree of [
      null,
      undefined,
      42,
      "texte",
      [],
      { type: "session_meta" },
      { type: "response_item" },
      { payload: { role: "user", type: "message" }, type: "response_item" },
      { payload: { content: [], type: "reasoning" }, type: "response_item" },
    ]) {
      expect(ligneCodexVersPi(entree)).toBeUndefined();
    }
  });

  test("une ligne pi n'est PAS prise pour du codex", () => {
    // L'adaptateur est essayé avant le décodeur pi : s'il attrapait les lignes
    // pi, il casserait tout ce qui marche déjà.
    expect(
      ligneCodexVersPi({
        message: { content: [{ text: "salut", type: "text" }], role: "user" },
        type: "message",
      }),
    ).toBeUndefined();
  });
});
