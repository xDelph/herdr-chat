/**
 * Claude Code → pi : le tri se fait sur le **type de ligne**, jamais sur le rôle.
 *
 * ⚠️ **Les fixtures sont recopiées de sessions réelles** (Claude Code 2.1.301,
 * 2026-10-16). Elles portent ce qu'aucune lecture de schéma n'aurait donné : la
 * session contient **treize types de lignes**, et l'un d'eux — `api-request-blob`
 * — porte un `message` de rôle `user` dont le contenu est le prompt système.
 *
 * Un adaptateur qui trierait sur `message.role` — la lecture évidente, et celle
 * qui vient naturellement quand on a déjà écrit trois adaptateurs — prendrait ce
 * blob pour une demande de l'utilisateur. Chaque conversation s'ouvrirait alors
 * sur les `CLAUDE.md` et les `<system-reminder>`, et **la vraie demande serait
 * noyée dessous** : exactement le défaut que codex a dû corriger.
 */
import { describe, expect, test } from "bun:test";
import { ligneClaudeVersPi } from "./claude.ts";

const blocs = (ligne: unknown): ReadonlyArray<Record<string, unknown>> => {
  if (typeof ligne !== "object" || ligne === null) return [];
  const message = Reflect.get(ligne, "message");
  if (typeof message !== "object" || message === null) return [];
  const content = Reflect.get(message, "content");
  if (!Array.isArray(content)) return [];
  return content.filter(
    (bloc): bloc is Record<string, unknown> => typeof bloc === "object" && bloc !== null,
  );
};

const types = (ligne: unknown): ReadonlyArray<unknown> => blocs(ligne).map((b) => b["type"]);

/** Une ligne `user` telle que la base la stocke, réduite au nécessaire. */
const ligneUser = (content: unknown): unknown => ({
  message: { content, role: "user" },
  timestamp: "2026-10-16T18:00:00.000Z",
  type: "user",
  uuid: "u-1",
});

describe("les quatre formes utiles de la conversation", () => {
  test("une demande en chaîne nue", () => {
    const ligne = ligneClaudeVersPi(ligneUser("hello"));

    expect(ligne?.message.role).toBe("user");
    expect(blocs(ligne)[0]).toEqual({ text: "hello", type: "text" });
  });

  test("une demande en blocs de texte", () => {
    const ligne = ligneClaudeVersPi(
      ligneUser([{ text: "[Request interrupted by user]", type: "text" }]),
    );

    expect(ligne?.message.role).toBe("user");
    expect(blocs(ligne)[0]?.["text"]).toBe("[Request interrupted by user]");
  });

  test("un assistant : texte PUIS appel d'outil, dans l'ordre", () => {
    const ligne = ligneClaudeVersPi({
      message: {
        content: [
          { text: "Hello! How can I help you today?", type: "text" },
          {
            id: "call_s8d2p83e",
            input: { command: "ls -R ./projects" },
            name: "Bash",
            type: "tool_use",
          },
        ],
        role: "assistant",
      },
      timestamp: "2026-10-16T18:00:01.000Z",
      type: "assistant",
      uuid: "a-1",
    });

    expect(types(ligne)).toEqual(["text", "toolCall"]);
    expect(blocs(ligne)[1]).toEqual({
      arguments: { command: "ls -R ./projects" },
      id: "call_s8d2p83e",
      name: "Bash",
      type: "toolCall",
    });
  });

  test("un résultat d'outil devient une entrée `toolResult`, pas un message d'utilisateur", () => {
    // ⚠️ Il arrive dans un message de rôle `user` — c'est la forme de l'API — mais
    // ce n'est pas une demande : c'est la réponse à l'appel du dessus.
    const ligne = ligneClaudeVersPi(
      ligneUser([
        {
          content: "[rtk] warning: output exceeds 10 MiB\ncrates/\ndocs/",
          tool_use_id: "call_s8d2p83e",
          type: "tool_result",
        },
      ]),
    );

    expect(ligne?.message.role).toBe("toolResult");
    expect(blocs(ligne)[0]?.["text"]).toContain("crates/");
  });

  test("un résultat en échec porte l'indicateur", () => {
    const ligne = ligneClaudeVersPi(
      ligneUser([{ content: "boom", is_error: true, tool_use_id: "call_1", type: "tool_result" }]),
    );

    expect(ligne?.message.isError).toBe(true);
  });

  test("un résultat dont le contenu est une LISTE de blocs est concaténé", () => {
    const ligne = ligneClaudeVersPi(
      ligneUser([
        { content: [{ text: "un" }, { text: "deux" }], tool_use_id: "call_1", type: "tool_result" },
      ]),
    );

    expect(blocs(ligne)[0]?.["text"]).toBe("undeux");
  });
});

describe("le piège : le blob de requête n'est PAS une demande", () => {
  test("`api-request-blob` est écarté, malgré son rôle `user`", () => {
    // ⚠️ LE test de ce fichier. Ce type n'est pas de la conversation, et son
    // contenu est le prompt système injecté.
    const ligne = ligneClaudeVersPi({
      hash: "abc",
      message: {
        content: [
          {
            text: "<system-reminder>\nContents of /Users/…/.claude/CLAUDE.md (user's private global instructions…",
            type: "text",
          },
        ],
        role: "user",
      },
      sessionId: "8919757f-70ae-489f-80fc-b9ecf3aab49b",
      type: "api-request-blob",
    });

    expect(ligne).toBeUndefined();
  });

  test("`api-request-blob` en chaîne simple est écarté aussi", () => {
    const ligne = ligneClaudeVersPi({
      message: {
        content: "# Environment\nYou have been invoked in the following environment:",
        role: "system",
      },
      type: "api-request-blob",
    });

    expect(ligne).toBeUndefined();
  });

  test("une VRAIE ligne `user` qui ne porte qu'un rappel est écartée", () => {
    // Deuxième ligne de défense : la marque, pas la taille.
    const ligne = ligneClaudeVersPi(
      ligneUser([{ text: "<system-reminder>\nAttribution for git commits…", type: "text" }]),
    );

    expect(ligne).toBeUndefined();
  });

  test("un utilisateur qui PARLE de ses rappels n'est pas effacé", () => {
    // ⚠️ Reconnaître le contexte à sa **marque en tête**, jamais à sa présence :
    // une demande qui mentionne `<system-reminder>` au milieu reste une demande.
    const ligne = ligneClaudeVersPi(
      ligneUser([
        { text: "pourquoi <system-reminder> apparaît-il dans mes sessions ?", type: "text" },
      ]),
    );

    expect(ligne).toBeDefined();
  });
});

describe("les onze autres types de lignes sont de la comptabilité", () => {
  test.each([
    "system",
    "attachment",
    "last-prompt",
    "mode",
    "permission-mode",
    "atis-latch",
    "file-history-snapshot",
    "api-request-shape",
    "api-request",
    "ai-title",
  ])("`%s` est écarté", (type) => {
    expect(
      ligneClaudeVersPi({ message: { content: "peu importe", role: "user" }, type }),
    ).toBeUndefined();
  });

  test("un type inconnu ne lève pas", () => {
    expect(ligneClaudeVersPi({ type: "inventé" })).toBeUndefined();
    expect(ligneClaudeVersPi("pas un objet")).toBeUndefined();
    expect(ligneClaudeVersPi(null)).toBeUndefined();
  });
});

describe("rien n'est inventé quand la source ne dit rien", () => {
  test("un contenu vide n'est pas un message", () => {
    expect(ligneClaudeVersPi(ligneUser("   "))).toBeUndefined();
    expect(ligneClaudeVersPi(ligneUser([]))).toBeUndefined();
    expect(ligneClaudeVersPi(ligneUser([{ text: "", type: "text" }]))).toBeUndefined();
  });

  test("un assistant sans bloc n'est pas un message", () => {
    expect(
      ligneClaudeVersPi({ message: { content: [], role: "assistant" }, type: "assistant" }),
    ).toBeUndefined();
  });

  test("l'horodatage et l'identité viennent de la ligne", () => {
    const ligne = ligneClaudeVersPi(ligneUser("hello"));

    expect(ligne?.timestamp).toBe("2026-10-16T18:00:00.000Z");
    expect(ligne?.id).toBe("claude:u-1");
  });

  test("sans horodatage, le champ est ABSENT", () => {
    const ligne = ligneClaudeVersPi({ message: { content: "hello", role: "user" }, type: "user" });

    expect(ligne?.timestamp).toBeUndefined();
  });

  test("un `input` qui n'est pas un objet ne casse pas l'appel", () => {
    const ligne = ligneClaudeVersPi({
      message: {
        content: [{ id: "c1", input: "ls", name: "Bash", type: "tool_use" }],
        role: "assistant",
      },
      type: "assistant",
    });

    expect(blocs(ligne)[0]?.["arguments"]).toEqual({});
  });
});
