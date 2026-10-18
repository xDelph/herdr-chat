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
import { ligneClaudeVersPi } from "../src/claude.ts";

/** Une reponse claude portant un modele, pour les tests du modele. */
const avecModele = (message: Record<string, unknown>): unknown => ({
  message: { content: [{ text: "ok", type: "text" }], role: "assistant", ...message },
  timestamp: "2026-10-16T18:00:00.000Z",
  type: "assistant",
  uuid: "a-1",
});

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
    // ⚠️ La fixture est une **vraie demande** relevée dans le corpus. Elle valait
    // auparavant `[Request interrupted by user]` — un marqueur de l'application,
    // désormais refusé : le test vérifiait la bonne règle sur le mauvais exemple.
    const ligne = ligneClaudeVersPi(
      ligneUser([{ text: "analyze ./projects/perso/pixel please", type: "text" }]),
    );

    expect(ligne?.message.role).toBe("user");
    expect(blocs(ligne)[0]?.["text"]).toBe("analyze ./projects/perso/pixel please");
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

/**
 * Ce que l'application écrit **en rôle `user`** n'est pas une demande.
 *
 * ⚠️ Relevé du 2026-10-16 sur 132 sessions réelles : sur 320 lignes `user`
 * portant du texte, **50 (15 %)** appartiennent à cette famille. Toutes les
 * fixtures ci-dessous sont recopiées telles quelles — c'est cette mesure, et non
 * une lecture du format, qui a donné la liste.
 *
 * Le cas qui a fait mal : la ligne de la liste annonçait
 * `[Request interrupted by user]` comme « la dernière demande de l'utilisateur ».
 */
describe("ce que l'application écrit n'est pas une demande", () => {
  test.each([
    ["12 ×", "[Request interrupted by user]"],
    [
      "10 ×",
      "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these",
    ],
    ["10 ×", "<local-command-stdout>Login successful</local-command-stdout>"],
    [
      "5 ×",
      "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion",
    ],
    [
      "3 ×",
      "<task-notification>\n<task-id>b5u96vt20</task-id>\n<output-file>/private/tmp/x</output-file>",
    ],
  ])("`%s` %s` est écarté", (_combien, texte) => {
    expect(ligneClaudeVersPi(ligneUser(texte))).toBeUndefined();
    expect(ligneClaudeVersPi(ligneUser([{ text: texte, type: "text" }]))).toBeUndefined();
  });

  /*
    ⚠️ La **sortie** d'une commande est de la comptabilité, la commande ne l'est
    pas : l'utilisateur a bel et bien agi. On rend donc le texte utile — ce qu'il
    a tape — plutôt que les balises qui l'enveloppent.
  */
  test("une commande à barre oblique est rendue, pas escamotée", () => {
    const ligne = ligneClaudeVersPi(
      ligneUser(
        "<command-name>/login</command-name>\n            <command-message>login</command-message>\n            <command-args></command-args>",
      ),
    );

    expect(blocs(ligne)[0]?.["text"]).toBe("/login");
  });

  test("ses arguments suivent, quand il y en a (même gabarit que la ligne réelle)", () => {
    const ligne = ligneClaudeVersPi(
      ligneUser("<command-name>/clear</command-name>\n<command-args>les onglets</command-args>"),
    );

    expect(blocs(ligne)[0]?.["text"]).toBe("/clear les onglets");
  });

  test("un utilisateur qui PARLE d'une interruption n'est pas effacé", () => {
    // La marque ne vaut que **en tête** : ici elle est au milieu du texte.
    const ligne = ligneClaudeVersPi(
      ligneUser("explique-moi ce que veut dire [Request interrupted by user]"),
    );

    expect(ligne).toBeDefined();
  });

  test("un bloc utile survit à côté d'un bloc qui ne l'est pas", () => {
    const ligne = ligneClaudeVersPi(
      ligneUser([
        { text: "<local-command-stdout>ok</local-command-stdout>\n", type: "text" },
        { text: "et maintenant, la vraie demande", type: "text" },
      ]),
    );

    expect(blocs(ligne).map((bloc) => bloc["text"])).toEqual(["et maintenant, la vraie demande"]);
  });
});

/**
 * Le modèle, porté par le message lui-même.
 *
 * ⚠️ **Le défaut que cette section verrouille.** L'en-tête affichait « model not
 * declared » sur un agent claude qui venait d'écrire son modèle noir sur blanc :
 * la session ne contient **aucun** `model_change`, contrairement à pi, et le
 * lecteur ne cherchait que là. Mesure du 2026-10-16 : chaque réponse assistant
 * de l'API porte `model` (`claude-sonnet-4-6`).
 */
describe("claude — le modèle est sur le message", () => {
  test("le modèle de la réponse est repris tel quel", () => {
    const ligne = ligneClaudeVersPi(avecModele({ model: "claude-sonnet-4-6" }));

    expect(ligne?.message.model).toBe("claude-sonnet-4-6");
  });

  test("un substitut n'est PAS un modèle", () => {
    // Mesuré : Claude Code écrit `<synthetic>` sur les messages qu'il fabrique
    // lui-même. L'afficher remplacerait « inconnu » par une valeur qui a l'air
    // d'un modèle.
    const ligne = ligneClaudeVersPi(avecModele({ model: "<synthetic>" }));

    expect(ligne?.message.model).toBeUndefined();
    expect(ligne?.message.role).toBe("assistant");
  });

  test("sans modèle déclaré, le champ reste ABSENT — pas inventé", () => {
    expect(ligneClaudeVersPi(avecModele({}))?.message.model).toBeUndefined();
  });

  test("le fournisseur et le niveau n'existent pas dans cette source", () => {
    // ⚠️ L'API ne les donne pas : on ne les fabrique pas, même si les autres
    // sources les portent. La ligne de liste saura s'en passer.
    const ligne = ligneClaudeVersPi(avecModele({ model: "claude-sonnet-4-6" }));

    expect(ligne?.message.provider).toBeUndefined();
    expect(ligne?.message.thinkingLevel).toBeUndefined();
  });
});
