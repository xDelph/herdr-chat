/**
 * opencode → pi : la traduction qui rend la base SQLite lisible comme codex.
 *
 * ⚠️ **Pourquoi ce fichier existe, et ce qu'il remplace.** Le produit classait
 * opencode comme illisible : « sa session est dans une base ». C'était une
 * confusion entre *il n'y a pas de chemin* et *il n'y a pas de session* — la
 * même que pour codex, corrigée de la même façon. Mesure du 2026-10-16 sur
 * `opencode.db` : 1 931 lignes, dont **1 879 messages** (`user` 48 +
 * `assistant` 1 831).
 *
 * ⚠️ **Les fixtures ne sont pas inventées.** Elles sont recopiées de la base
 * réelle (formes, clés et valeurs), réduites au nécessaire. C'est ce qui a
 * permis de trancher trois questions qu'aucune lecture de schéma n'aurait
 * données :
 *
 * - la réflexion est **en clair** (`type: "reasoning"`, champ `text`), là où
 *   codex la chiffre ;
 * - un appel d'outil porte **son entrée et sa sortie dans la même partie**
 *   (`state.input` et `content`), là où pi les sépare en deux messages ;
 * - les images arrivent en **URI `data:` base64**, pas en chemin de fichier.
 */
import { describe, expect, test } from "bun:test";
import { ligneOpencodeVersPi } from "./opencode.ts";

/** Un appel d'outil, tel que la base le stocke. */
const appel = (surcharge: Record<string, unknown> = {}): Record<string, unknown> => ({
  content: [{ text: "apps/web/src/blocks.test.ts:497:  const items = toItems(", type: "text" }],
  executed: false,
  id: "call_00_ZxUOqClZd7UgED4sKyc23737",
  name: "shell",
  state: {
    input: { command: 'cd /projet\ngrep -n "toItems" apps/web/src/*.test.ts | head' },
    status: "completed",
  },
  time: { created: 1791840563534, completed: 1791840568048 },
  type: "tool",
  ...surcharge,
});

/** Un message assistant, tel que la base le stocke. */
const assistant = (content: ReadonlyArray<unknown>): Record<string, unknown> => ({
  agent: "build",
  content,
  cost: 0.0031,
  finish: "stop",
  model: { id: "deepseek-v4.1-flash", providerID: "opencode-go", variant: "high" },
  time: { completed: 1791874260493, created: 1791874249941, streamed: 1791874260425 },
  tokens: { input: 1200, output: 300 },
});

/** Les blocs d'un message traduit, sans assertion de type. */
const blocs = (traduit: unknown): ReadonlyArray<Record<string, unknown>> => {
  if (typeof traduit !== "object" || traduit === null) return [];
  const message = Reflect.get(traduit, "message");
  if (typeof message !== "object" || message === null) return [];
  const content = Reflect.get(message, "content");
  if (!Array.isArray(content)) return [];
  return content.filter(
    (bloc): bloc is Record<string, unknown> => typeof bloc === "object" && bloc !== null,
  );
};

const kinds = (traduit: unknown): ReadonlyArray<unknown> => blocs(traduit).map((b) => b["type"]);

describe("un message utilisateur devient un message pi", () => {
  test("le texte est repris tel quel", () => {
    const ligne = ligneOpencodeVersPi(
      "user",
      {
        text: "sur la ligne worked for xxx, enleve la parti Fichiers modifies",
        time: { created: 1791873812016 },
      },
      "msg_1",
    );

    expect(ligne?.message.role).toBe("user");
    expect(blocs(ligne)[0]).toEqual({
      text: "sur la ligne worked for xxx, enleve la parti Fichiers modifies",
      type: "text",
    });
  });

  test("l'horodatage Unix devient une chaîne ISO", () => {
    // ⚠️ opencode donne des millisecondes Unix, pi une chaîne ISO. La
    // normalisation vit à l'entrée : rien en aval ne connaît les deux formes.
    const ligne = ligneOpencodeVersPi(
      "user",
      { text: "bonjour", time: { created: 1791873812016 } },
      "msg_1",
    );

    expect(ligne?.timestamp).toBe(new Date(1791873812016).toISOString());
  });

  test("sans horodatage, le champ est ABSENT — on n'invente pas une date", () => {
    const ligne = ligneOpencodeVersPi("user", { text: "bonjour" }, "msg_1");

    expect(ligne?.timestamp).toBeUndefined();
    expect(Object.hasOwn(ligne ?? {}, "timestamp")).toBe(false);
  });

  test("un texte vide n'est pas un message", () => {
    expect(
      ligneOpencodeVersPi("user", { text: "   ", time: { created: 1 } }, "msg_1"),
    ).toBeUndefined();
  });
});

describe("un message assistant porte ses blocs, dans l'ordre", () => {
  test("texte, réflexion et appel d'outil sont distingués", () => {
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([
        { text: "Je fais le regroupement par période de travail.", type: "text" },
        {
          state: { reasoningField: "reasoning_content" },
          text: "Existing tests:",
          type: "reasoning",
        },
        appel(),
      ]),
      "msg_2",
    );

    expect(kinds(ligne)).toEqual(["text", "thinking", "toolCall", "toolResult"]);
  });

  test("la réflexion est publiée EN CLAIR — contrairement à codex", () => {
    // ⚠️ Codex chiffre sa réflexion et n'a rien à montrer : il émet un bloc
    // masqué. opencode écrit le texte. Les confondre perdrait la réflexion.
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([
        {
          state: { reasoningField: "reasoning_content" },
          text: "Existing tests:",
          type: "reasoning",
        },
      ]),
      "msg_2",
    );

    expect(blocs(ligne)[0]).toEqual({
      redacted: false,
      thinking: "Existing tests:",
      type: "thinking",
    });
  });

  test("l'appel garde sa commande en arguments, décodée", () => {
    const ligne = ligneOpencodeVersPi("assistant", assistant([appel()]), "msg_2");
    const bloc = blocs(ligne)[0];

    expect(bloc?.["type"]).toBe("toolCall");
    expect(bloc?.["name"]).toBe("shell");
    expect(bloc?.["id"]).toBe("call_00_ZxUOqClZd7UgED4sKyc23737");
    expect(bloc?.["arguments"]).toEqual({
      command: 'cd /projet\ngrep -n "toItems" apps/web/src/*.test.ts | head',
    });
  });

  test("la sortie suit son appel, dans le MÊME message", () => {
    // ⚠️ opencode met l'entrée et la sortie dans la même partie ; pi les sépare.
    // Le regroupement rattache un résultat au **dernier appel publié** — il faut
    // donc que le résultat vienne juste après, et pas dans un autre message.
    const ligne = ligneOpencodeVersPi("assistant", assistant([appel()]), "msg_2");
    const [appelBloc, resultat] = blocs(ligne);

    expect(appelBloc?.["type"]).toBe("toolCall");
    expect(resultat?.["type"]).toBe("toolResult");
    expect(resultat?.["text"]).toBe("apps/web/src/blocks.test.ts:497:  const items = toItems(");
    expect(resultat?.["toolName"]).toBe("shell");
  });

  test("un appel en échec porte l'indicateur, depuis `status`", () => {
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([
        appel({
          content: [{ text: "String to replace not found in file.", type: "text" }],
          name: "edit",
          state: { input: { filePath: "/projet/a.ts" }, status: "error" },
        }),
      ]),
      "msg_2",
    );

    expect(blocs(ligne)[1]?.["isError"]).toBe(true);
  });

  test("un appel sans sortie ne fabrique pas de ligne de résultat", () => {
    // `status: "running"` : l'appel est parti, rien n'est revenu. Une ligne de
    // résultat vide serait un mensonge sur un travail en cours.
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([appel({ content: [], state: { input: { command: "ls" }, status: "running" } })]),
      "msg_2",
    );

    expect(kinds(ligne)).toEqual(["toolCall"]);
  });
});

describe("les images de résultat sont reprises, pas interprétées", () => {
  test("une URI `data:` base64 devient un bloc image", () => {
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([
        appel({
          content: [
            { text: "Image read successfully", type: "text" },
            { type: "file", uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg" },
          ],
          name: "read",
          state: { input: { path: "/tmp/v4.png" }, status: "completed" },
        }),
      ]),
      "msg_2",
    );

    expect(blocs(ligne)[1]?.["images"]).toEqual([
      { data: "iVBORw0KGgoAAAANSUhEUg", mimeType: "image/png" },
    ]);
  });

  test("une sortie qui n'est pas un `data:` base64 est écartée", () => {
    // Un chemin de fichier n'est pas une image : le rendre serait deviner.
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([
        appel({
          content: [{ type: "file", uri: "/tmp/v4.png" }],
          name: "read",
          state: { input: { path: "/tmp/v4.png" }, status: "completed" },
        }),
      ]),
      "msg_2",
    );

    expect(kinds(ligne)).toEqual(["toolCall"]);
  });

  test("le type MIME vient de l'URI, jamais supposé", () => {
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([{ type: "file", uri: "data:image/webp;base64,UklGRg" }]),
      "msg_2",
    );

    expect(blocs(ligne)[0]).toEqual({ data: "UklGRg", mimeType: "image/webp", type: "image" });
  });
});

describe("ce qui n'est PAS de la conversation est refusé, explicitement", () => {
  test("`idle` n'est pas un message : c'est la fin d'un tour", () => {
    expect(
      ligneOpencodeVersPi(
        "idle",
        { outcome: "succeeded", time: { created: 1791874260495 } },
        "msg_3",
      ),
    ).toBeUndefined();
  });

  test("`system` est de la configuration — le traduire remplirait le fil", () => {
    // C'est le défaut exact que codex a dû corriger pour son rôle `developer`.
    expect(
      ligneOpencodeVersPi(
        "system",
        {
          description: "Instructions updated: core/date",
          metadata: { instructionSources: ["core/date"], notice: "instructions" },
          text: "Today's date is now: Tue Oct 13 2026",
          time: { created: 1791873812014 },
        },
        "msg_4",
      ),
    ).toBeUndefined();
  });

  test("`synthetic` est refusé : sa commande est encodée dans une balise", () => {
    // Deux occurrences mesurées. La commande n'est pas un champ : la
    // reconstituer serait une déduction, pas une traduction.
    expect(
      ligneOpencodeVersPi(
        "synthetic",
        {
          metadata: {
            exit: 0,
            jobID: "sh_12c5da78d0018j5TPx7p2JvIt2",
            source: "shell",
            state: "completed",
          },
          text: '<shell id="sh_12c5da78d0018j5TPx7p2JvIt2" state="completed" command="bun run verify">',
          time: { created: 1791745703852 },
        },
        "msg_5",
      ),
    ).toBeUndefined();
  });

  test("`compaction` n'a pas la forme de pi, donc il est refusé", () => {
    // pi attend `firstKeptEntryId` et `tokensBefore`, qu'opencode ne porte pas.
    expect(
      ligneOpencodeVersPi(
        "compaction",
        {
          model: { id: "space-bunny-free" },
          reason: "auto",
          status: "completed",
          summary: "## Objective",
        },
        "msg_6",
      ),
    ).toBeUndefined();
  });

  test("un type inconnu ne lève pas", () => {
    expect(ligneOpencodeVersPi("quelque-chose", { time: { created: 1 } }, "msg_7")).toBeUndefined();
  });

  test("un `data` qui n'est pas un objet ne lève pas", () => {
    expect(ligneOpencodeVersPi("assistant", "pas un objet", "msg_8")).toBeUndefined();
    expect(ligneOpencodeVersPi("assistant", null, "msg_8")).toBeUndefined();
    expect(ligneOpencodeVersPi("assistant", [1, 2], "msg_8")).toBeUndefined();
  });
});

describe("rien n'est inventé quand la source ne dit rien", () => {
  test("un message sans bloc n'est pas un message", () => {
    expect(ligneOpencodeVersPi("assistant", assistant([]), "msg_9")).toBeUndefined();
    expect(
      ligneOpencodeVersPi("assistant", assistant([{ text: "", type: "text" }]), "msg_9"),
    ).toBeUndefined();
  });

  test("des parties de type inconnu sont écartées, les autres survivent", () => {
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([{ type: "oracle-internal" }, { text: "voilà", type: "text" }]),
      "msg_10",
    );

    expect(kinds(ligne)).toEqual(["text"]);
  });

  test("un argument qui n'est pas un objet est conservé, pas jeté", () => {
    // `Block.arguments` exige un objet : jeter la valeur perdrait la commande.
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([appel({ state: { input: "ls -la", status: "running" } })]),
      "msg_11",
    );

    expect(blocs(ligne)[0]?.["arguments"]).toEqual({ valeur: "ls -la" });
  });

  test("un appel sans identifiant reste identifiable", () => {
    const ligne = ligneOpencodeVersPi(
      "assistant",
      assistant([appel({ content: [], id: undefined, state: { status: "running" } })]),
      "msg_12",
    );

    expect(blocs(ligne)[0]?.["id"]).toBe("appel");
  });
});

describe("l'identité d'un message est stable", () => {
  test("elle vient de la clé de la ligne, pas du contenu", () => {
    // ⚠️ C'est ce qui évite un remontage de l'affichage à chaque
    // rafraîchissement : deux lectures de la même ligne donnent le même id.
    const a = ligneOpencodeVersPi("assistant", assistant([appel()]), "msg_ABC");
    const b = ligneOpencodeVersPi("assistant", assistant([appel()]), "msg_ABC");

    expect(a?.id).toBe("opencode:msg_ABC");
    expect(a?.id).toBe(b?.id);
  });

  test("deux lignes différentes ne se confondent pas", () => {
    const a = ligneOpencodeVersPi("assistant", assistant([appel()]), "msg_1");
    const b = ligneOpencodeVersPi("assistant", assistant([appel()]), "msg_2");

    expect(a?.id).not.toBe(b?.id);
  });

  test("le type pi est `message`, comme pour pi et codex", () => {
    const ligne = ligneOpencodeVersPi("assistant", assistant([appel()]), "msg_1");

    expect(ligne?.type).toBe("message");
  });
});
