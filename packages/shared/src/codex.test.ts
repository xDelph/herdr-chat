/**
 * L'adaptateur codex → pi.
 *
 * ⚠️ Ces tests encodent une **mesure**, pas une supposition. Les charges utiles
 * sont recopiées de vraies lignes de `rollout-*.jsonl` sous `~/.codex/sessions/`
 * (2026-10-13, codex tel qu'installé sur cette machine). Si codex change de
 * format, un de ces tests tombe — c'est le but.
 */
import { describe, expect, test } from "bun:test";
import { ligneCodexVersPi, reglageCodexVersPi } from "./codex.ts";

/** Enveloppe codex : `timestamp`, `ordinal`, `type`, `payload`. */
const item = (payload: Record<string, unknown>): unknown => ({
  ordinal: 11,
  payload: { type: "message", ...payload },
  timestamp: "2026-10-13T07:44:03.616Z",
  type: "response_item",
});

describe("codex → pi", () => {
  test("Codex UserMessage events restore the user's prompt", () => {
    const line = ligneCodexVersPi({
      ordinal: 45,
      payload: {
        type: "item_completed",
        item: {
          type: "UserMessage",
          id: "user_1",
          content: [{ type: "text", text: "Show the earlier messages" }],
        },
      },
      timestamp: "2026-10-13T07:44:03.616Z",
      type: "event_msg",
    });
    expect(line?.message).toMatchObject({
      content: [{ text: "Show the earlier messages", type: "text" }],
      role: "user",
    });
  });

  test("a Codex command execution preserves the real command and output", () => {
    const line = ligneCodexVersPi({
      ordinal: 42,
      payload: {
        type: "item_completed",
        item: {
          type: "CommandExecution",
          id: "cmd_1",
          command: ["/bin/zsh", "-lc", "bun run build"],
          aggregated_output: "Build complete",
          exit_code: 0,
          status: "completed",
        },
      },
      timestamp: "2026-10-13T07:44:03.616Z",
      type: "event_msg",
    });
    expect(line?.message).toMatchObject({
      command: "bun run build",
      output: "Build complete",
      exitCode: 0,
      role: "bashExecution",
    });
  });

  test("Codex file changes become file edit tool calls", () => {
    const line = ligneCodexVersPi({
      ordinal: 43,
      payload: {
        type: "item_completed",
        item: {
          type: "FileChange",
          id: "edit_1",
          changes: {
            "src/app.ts": { type: "update", unified_diff: "@@ -1 +1 @@\n-old\n+new\n" },
          },
        },
      },
      timestamp: "2026-10-13T07:44:03.616Z",
      type: "event_msg",
    });
    expect(line?.message.content).toMatchObject([
      {
        arguments: { path: "src/app.ts", edits: [{ oldText: "old", newText: "new" }] },
        name: "edit",
        type: "toolCall",
      },
    ]);
  });

  test("Codex progress messages retain their commentary phase", () => {
    const line = ligneCodexVersPi({
      ordinal: 44,
      payload: {
        type: "item_completed",
        item: {
          type: "AgentMessage",
          id: "msg_1",
          phase: "commentary",
          content: [{ type: "Text", text: "I found the issue." }],
        },
      },
      timestamp: "2026-10-13T07:44:03.616Z",
      type: "event_msg",
    });
    expect(line?.message).toMatchObject({
      content: [{ text: "I found the issue.", type: "text" }],
      phase: "commentary",
      role: "assistant",
    });
  });

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

  test("a UserMessage without readable content is skipped", () => {
    expect(
      ligneCodexVersPi({
        ordinal: 9,
        payload: { item: { content: [], type: "UserMessage" }, type: "item_completed" },
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

  test("un appel d'outil devient un appel pi, arguments décodés", () => {
    const ligne = ligneCodexVersPi(
      item({
        arguments: '{"code":"await cua.getState();","title":"Check"}',
        call_id: "call_1",
        name: "js",
        type: "function_call",
      }),
    );
    expect(ligne?.message).toEqual({
      content: [
        {
          arguments: { code: "await cua.getState();", title: "Check" },
          id: "call_1",
          name: "js",
          type: "toolCall",
        },
      ],
      role: "assistant",
    });
  });

  test("un `custom_tool_call` garde son script BRUT — ce n'est pas du JSON", () => {
    // L'inventer en objet serait pire que de l'afficher tel quel.
    const ligne = ligneCodexVersPi(
      item({
        input: 'const r = await tools.exec_command({cmd:"ls"});',
        name: "exec",
        type: "custom_tool_call",
      }),
    );
    expect(ligne?.message).toEqual({
      content: [
        {
          arguments: 'const r = await tools.exec_command({cmd:"ls"});',
          name: "exec",
          type: "toolCall",
        },
      ],
      role: "assistant",
    });
  });

  test("une sortie d'outil en LISTE de blocs est concaténée", () => {
    // Mesuré : `output` est une liste pour `function_call_output`, une chaîne
    // ailleurs. Les deux formes vivent dans le même fichier.
    const enListe = ligneCodexVersPi(
      item({
        call_id: "call_1",
        output: [
          { text: "Wall time: 0.8s", type: "input_text" },
          { text: "## Output", type: "input_text" },
        ],
        type: "function_call_output",
      }),
    );
    expect(enListe?.message).toMatchObject({
      content: [{ text: "Wall time: 0.8s## Output", type: "text" }],
      role: "toolResult",
      toolName: "outil",
    });
  });

  test("une sortie d'outil en chaîne simple passe aussi", () => {
    const ligne = ligneCodexVersPi(item({ output: "ok", type: "custom_tool_call_output" }));
    expect(ligne?.message.content).toEqual([{ text: "ok", type: "text" }]);
  });

  test("la réflexion de codex est MASQUÉE, jamais inventée", () => {
    // `encrypted_content` est chiffré et `summary` est vide : il n'y a rien à
    // lire. Le dire masqué est fidèle ; fabriquer un raisonnement ne le serait pas.
    const ligne = ligneCodexVersPi(
      item({ encrypted_content: "gAAAA…", summary: [], type: "reasoning" }),
    );
    expect(ligne?.message.content).toEqual([{ redacted: true, type: "thinking" }]);
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
      // ⚠️ `reasoning` n'est plus dans cette liste : il est désormais traduit en
      // réflexion masquée. Un type **inconnu** reste, lui, écarté.
      { payload: { content: [], type: "type_inexistant" }, type: "response_item" },
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

/**
 * Les réglages codex — traduits en **ligne pi**, comme le reste.
 *
 * ⚠️ **Pourquoi codex a besoin de ça et pas les autres.** Mesure du 2026-10-16 :
 * pi, opencode, devin et claude écrivent le modèle **sur chaque message** ;
 * codex, lui, le met dans des événements — `turn_context` (32 fois dans une
 * session réelle) et `thread_settings_applied` (30 fois). Sans cette
 * traduction, un agent codex n'annonçait jamais son modèle.
 *
 * ⚠️ Ce qui compte, c'est que la ligne produite soit **du pi** : `reglagesOf` la
 * lit sans rien savoir de codex.
 */
describe("codex — les réglages deviennent des lignes pi", () => {
  test("`turn_context` donne le modèle ET le niveau", () => {
    // Mesure : ce payload porte `model` et `effort` — et **pas** de
    // `model_provider_id`, qui est lu sur l'autre forme.
    const reglage = reglageCodexVersPi({
      ordinal: 7,
      payload: { effort: "medium", model: "gpt-6-luna", turn_id: "t1" },
      timestamp: "2026-10-16T12:34:07.088Z",
      type: "turn_context",
    });

    expect(reglage).toEqual({
      modelId: "gpt-6-luna",
      thinkingLevel: "medium",
      type: "model_change",
    });
  });

  test("`thread_settings_applied` donne le modèle, le fournisseur et le niveau", () => {
    const reglage = reglageCodexVersPi({
      payload: {
        thread_settings: {
          model: "gpt-6-luna",
          model_provider_id: "openai",
          reasoning_effort: "medium",
        },
        type: "thread_settings_applied",
      },
      type: "event_msg",
    });

    expect(reglage).toEqual({
      modelId: "gpt-6-luna",
      provider: "openai",
      thinkingLevel: "medium",
      type: "model_change",
    });
  });

  test("un événement sans modèle ne produit RIEN", () => {
    /*
      ⚠️ Une ligne `model_change` sans `modelId` ferait croire à un changement
      constaté : `reglagesOf` la lirait, ne trouverait rien, et passerait à la
      suivante — mais l'entrée existerait, et `parseEntry` la garderait.
    */
    expect(reglageCodexVersPi({ payload: { model: "" }, type: "turn_context" })).toBeUndefined();
    expect(
      reglageCodexVersPi({ payload: { thread_settings: {} }, type: "event_msg" }),
    ).toBeUndefined();
  });

  test("un substitut entre chevrons n'est pas un modèle", () => {
    expect(
      reglageCodexVersPi({ payload: { model: "<synthetic>" }, type: "turn_context" }),
    ).toBeUndefined();
  });

  test("les autres lignes ne sont pas des réglages", () => {
    expect(reglageCodexVersPi({ payload: { model: "x" }, type: "response_item" })).toBeUndefined();
    expect(reglageCodexVersPi({ type: "turn_context" })).toBeUndefined();
    expect(reglageCodexVersPi(null)).toBeUndefined();
  });

  test("un `model_change` de pi n'est pas pris pour du codex", () => {
    // La traduction part de la forme codex ; une ligne pi déjà traduite
    // repasserait par ce chemin au second démarrage si on ne le refusait pas.
    expect(reglageCodexVersPi({ modelId: "x", type: "model_change" })).toBeUndefined();
  });
});
