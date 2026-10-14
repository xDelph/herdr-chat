/**
 * Tests d'analyse des blocs.
 *
 * Les fixtures viennent des **formes documentées** par Pi (`message-types.md`)
 * et des **outils réellement rencontrés** dans les sessions : `bash` (3 964
 * appels), `edit` (801), `read` (499), `write` (372), `subagent` (9).
 *
 * Ce fichier protège trois choses précises :
 * 1. chaque type de bloc produit un affichage typé ;
 * 2. un bloc inconnu n'emporte pas tout le message ;
 * 3. une suite d'appels d'outils est regroupée — mais **une erreur reste visible**.
 */
import { describe, expect, test } from "bun:test";
import {
  blockToText,
  commandeSansCd,
  contentToText,
  lastAssistantText,
  relativeWorkspacePath,
  toBlocks,
  toItems,
  toMessages,
} from "./blocks.ts";

describe("le `cd` d'entrée vers le projet", () => {
  const RACINE = "/Users/thomas/projets/demo";

  test("le `cd` vers le projet disparaît, la commande reste", () => {
    // Le motif de tous les jours : c'est la partie qui compte qui doit rester
    // visible, et elle seule.
    expect(commandeSansCd(`cd ${RACINE} && npm test`, RACINE)).toBe("npm test");
    expect(commandeSansCd(`cd ${RACINE} && bun run verify`, RACINE)).toBe("bun run verify");
  });

  test("les trois écritures du chemin sont reconnues", () => {
    expect(commandeSansCd(`cd "${RACINE}" && ls`, RACINE)).toBe("ls");
    expect(commandeSansCd(`cd '${RACINE}' && ls`, RACINE)).toBe("ls");
    expect(commandeSansCd(`cd ${RACINE}/ && ls`, RACINE)).toBe("ls");
  });

  test("`;` sépare aussi", () => {
    expect(commandeSansCd(`cd ${RACINE}; ls`, RACINE)).toBe("ls");
  });

  test("une commande étalée sur plusieurs lignes garde sa vraie première ligne", () => {
    // Très fréquent : le `cd` occupe la première ligne, la commande la seconde.
    expect(commandeSansCd(`cd ${RACINE} &&\nnpm test --silent`, RACINE)).toBe("npm test --silent");
  });

  test("un `cd` suivi d'un RETOUR À LA LIGNE est reconnu", () => {
    // ⚠️ La forme la plus fréquente des scripts : pas de `&&` du tout.
    expect(commandeSansCd(`cd ${RACINE}\ncat > /tmp/x.mjs <<'EOF'`, RACINE)).toBe(
      "cat > /tmp/x.mjs <<'EOF'",
    );
    expect(commandeSansCd(`cd ${RACINE}\necho bonjour`, RACINE)).toBe("echo bonjour");
  });

  test("un `cd` chaîné vers le projet part en entier", () => {
    expect(commandeSansCd(`cd ${RACINE} && cd ${RACINE} && ls`, RACINE)).toBe("ls");
  });

  /**
   * ⚠️ Le cas qui interdit de retirer plus large. `cd apps/web` **change** le
   * sens de la commande : la retirer ferait mentir la ligne sur ce qui a tourné.
   */
  test("un `cd` vers un SOUS-dossier est conservé", () => {
    const commande = `cd ${RACINE}/apps/web && npm test`;
    expect(commandeSansCd(commande, RACINE)).toBe(commande);
  });

  test("un `cd` vers un dossier SANS RAPPORT est conservé", () => {
    const commande = "cd /tmp/ailleurs && ls";
    expect(commandeSansCd(commande, RACINE)).toBe(commande);
  });

  test("un chemin qui commence pareil n'est pas confondu", () => {
    // `/Users/thomas/projets/demo-bis` n'est pas `/Users/thomas/projets/demo`.
    const commande = `cd ${RACINE}-bis && ls`;
    expect(commandeSansCd(commande, RACINE)).toBe(commande);
  });

  test("un `cd` seul est conservé : retirer tout donnerait une ligne vide", () => {
    const commande = `cd ${RACINE}`;
    expect(commandeSansCd(commande, RACINE)).toBe(commande);
  });

  test("sans dossier de travail connu, rien n'est touché", () => {
    const commande = `cd ${RACINE} && ls`;
    expect(commandeSansCd(commande, null)).toBe(commande);
    expect(commandeSansCd(commande, undefined)).toBe(commande);
    expect(commandeSansCd(commande, "")).toBe(commande);
  });

  test("une commande sans `cd` n'est jamais modifiée", () => {
    for (const commande of ["npm test", "ls -la", "echo cd", "grep -r 'cd /' ."]) {
      expect(commandeSansCd(commande, RACINE)).toBe(commande);
    }
  });
});

describe("chemins du workspace", () => {
  test("les chemins internes sont relatifs et ceux hors du workspace restent explicites", () => {
    expect(relativeWorkspacePath("/repo/apps/web/src/App.tsx", "/repo")).toBe(
      "apps/web/src/App.tsx",
    );
    expect(relativeWorkspacePath("/other/file.ts", "/repo")).toBe("/other/file.ts");
    expect(relativeWorkspacePath("file.ts", null)).toBe("file.ts");
  });
});

// ---------------------------------------------------------------------------
// Fabriques
// ---------------------------------------------------------------------------

/** Ligne de session avec un message. */
const line = (message: unknown, type = "message") =>
  JSON.stringify({ id: "e1", message, parentId: null, type });

const toolCall = (id: string, name: string) =>
  JSON.stringify({
    id,
    message: { content: [{ arguments: {}, name, type: "toolCall" }], role: "assistant" },
    type: "message",
  });

const toolResult = (id: string, name: string, text = "ok", isError = false) =>
  JSON.stringify({
    id,
    message: { content: [{ text, type: "text" }], isError, role: "toolResult", toolName: name },
    type: "message",
  });

const assistantText = (id: string, text: string) =>
  JSON.stringify({
    id,
    message: { content: [{ text, type: "text" }], role: "assistant" },
    type: "message",
  });

/** Construit des messages affichables depuis des lignes brutes. */
const messages = (entries: { raw: string; type?: string }[]) =>
  toMessages(
    entries.map((entry, index) => ({
      id: `e${String(index)}`,
      raw: entry.raw,
      type: entry.type ?? "message",
    })),
  );

// ---------------------------------------------------------------------------

describe("toBlocks", () => {
  test("texte simple", () => {
    expect(toBlocks([{ text: "Bonjour", type: "text" }])).toEqual([
      { kind: "text", text: "Bonjour" },
    ]);
  });

  test("réflexion, avec l'indicateur de masquage", () => {
    const blocks = toBlocks([{ thinking: "je réfléchis", type: "thinking" }]);
    expect(blocks[0]?.kind).toBe("thinking");
    if (blocks[0]?.kind === "thinking") {
      expect(blocks[0].thinking).toBe("je réfléchis");
      expect(blocks[0].redacted).toBe(false);
    }
  });

  test("réflexion masquée : pas de bloc vide", () => {
    const blocks = toBlocks([{ redacted: true, type: "thinking" }]);
    expect(blocks).toHaveLength(0);
  });

  test("appel d'outil : arguments décodés en objet", () => {
    const blocks = toBlocks([
      { arguments: { command: "ls -la" }, id: "c1", name: "bash", type: "toolCall" },
    ]);
    if (blocks[0]?.kind === "toolCall") {
      expect(blocks[0].name).toBe("bash");
      expect(blocks[0].arguments["command"]).toBe("ls -la");
    } else {
      throw new Error("bloc toolCall attendu");
    }
  });

  test("appel d'outil sans arguments ne casse pas", () => {
    const blocks = toBlocks([{ name: "gd", type: "toolCall" }]);
    if (blocks[0]?.kind === "toolCall") expect(blocks[0].arguments).toEqual({});
  });

  test("image conservée avec son type MIME", () => {
    expect(toBlocks([{ data: "AAAA", mimeType: "image/png", type: "image" }])).toEqual([
      { data: "AAAA", kind: "image", mimeType: "image/png" },
    ]);
  });

  test("bloc de type inconnu ignoré, les autres survivent", () => {
    const blocks = toBlocks([
      { text: "avant", type: "text" },
      { payload: 1, type: "futurTypeInconnu" },
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
    const result = toMessages([
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

    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe("assistant");
    expect(result[0]?.blocks).toHaveLength(2);
    expect(result[0]?.meta["model"]).toBe("space-bunny-free");
    expect(result[0]?.meta["tokens"]).toBe("4567");
    expect(result[0]?.meta["cost"]).toBe("0.0123");
  });

  test("résultat d'outil en échec porte l'indicateur d'erreur", () => {
    const result = toMessages([
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

    const block = result[0]?.blocks[0];
    if (block?.kind === "toolResult") {
      expect(block.isError).toBe(true);
      expect(block.toolName).toBe("bash");
      expect(block.text).toBe("commande introuvable");
    } else {
      throw new Error("bloc toolResult attendu");
    }
  });

  test("exécution shell directe : commande, sortie, code de retour", () => {
    const result = toMessages([
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

    expect(result[0]?.role).toBe("bashExecution");
    const block = result[0]?.blocks[0];
    if (block?.kind === "bashExecution") {
      expect(block.command).toBe("git status");
      expect(block.output).toBe("rien à valider");
      expect(block.exitCode).toBe(0);
    } else {
      throw new Error("bloc bashExecution attendu");
    }
  });

  test("les entrées qui ne portent rien sont ignorées", () => {
    expect(
      toMessages([
        { raw: '{"type":"session","version":3}', type: "session" },
        { raw: '{"type":"model_change"}', type: "model_change" },
        { raw: '{"type":"custom","customType":"x"}', type: "custom" },
      ]),
    ).toEqual([]);
  });

  test("un compactage devient un point de reprise, pas un message", () => {
    const result = toMessages([
      {
        id: "c1",
        raw: JSON.stringify({
          firstKeptEntryId: "abc123",
          summary: "Résumé de la conversation précédente.",
          tokensBefore: 50_000,
          type: "compaction",
        }),
        type: "compaction",
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe("compaction");
    const block = result[0]?.blocks[0];
    if (block?.kind === "compaction") {
      expect(block.tokensBefore).toBe(50_000);
      expect(block.firstKeptEntryId).toBe("abc123");
      expect(block.summary).toContain("Résumé");
    } else {
      throw new Error("bloc compaction attendu");
    }
  });

  test("un compactage sans résumé ne casse pas", () => {
    expect(
      toMessages([{ id: "c2", raw: JSON.stringify({ type: "compaction" }), type: "compaction" }]),
    ).toHaveLength(1);
  });

  test("un résultat de sous-agent produit une carte structurée", () => {
    const result = toMessages([
      {
        id: "sa1",
        raw: line({
          content: [{ text: "sortie brute", type: "text" }],
          details: {
            mode: "parallel",
            results: [
              {
                agent: "worker",
                digest: {
                  filesChanged: ["src/a.ts"],
                  questions: "none",
                  status: "ok",
                  summary: "Fichier créé.",
                  verified: "Relu sur disque.",
                },
                exitCode: 0,
                id: "sa-1",
                model: "modele-x",
                status: "failed",
                stopReason: "stop",
              },
            ],
          },
          isError: false,
          role: "toolResult",
          toolName: "subagent",
        }),
        type: "message",
      },
    ]);

    const block = result[0]?.blocks[0];
    if (block?.kind === "subagent") {
      expect(block.mode).toBe("parallel");
      expect(block.results).toHaveLength(1);
      // Les DEUX statuts sont conservés : ils divergent et sont tous deux vrais.
      expect(block.results[0]?.status).toBe("failed");
      expect(block.results[0]?.digest?.status).toBe("ok");
      expect(block.results[0]?.digest?.filesChanged).toEqual(["src/a.ts"]);
    } else {
      throw new Error("bloc subagent attendu");
    }
  });

  test("un appel d'outil nommé rend le message affichable", () => {
    expect(
      toMessages([
        {
          id: "m",
          raw: line({
            content: [{ arguments: {}, name: "bash", type: "toolCall" }],
            role: "assistant",
          }),
          type: "message",
        },
      ]),
    ).toHaveLength(1);
  });

  test("Codex wrapper JS is hidden when it only launches a shell command", () => {
    const entry = JSON.stringify({
      id: "codex:1:item",
      message: {
        content: [
          {
            arguments: 'const r = await tools.exec_command({cmd:"bun run build"});',
            name: "exec",
            type: "toolCall",
          },
        ],
        role: "assistant",
      },
      type: "message",
    });
    expect(toMessages([{ id: "codex:1:item", raw: entry, type: "message" }])).toEqual([]);
  });

  test("un appel d'outil SANS nom est écarté — il n'y a rien à afficher", () => {
    expect(
      toMessages([
        {
          id: "m",
          raw: line({ content: [{ type: "toolCall" }], role: "assistant" }),
          type: "message",
        },
      ]),
    ).toEqual([]);
  });

  test("message au contenu vide est écarté", () => {
    expect(
      toMessages([
        {
          id: "m",
          raw: line({ content: [{ text: "", type: "text" }], role: "assistant" }),
          type: "message",
        },
      ]),
    ).toEqual([]);
  });

  test("une ligne illisible n'empêche pas les autres", () => {
    const result = toMessages([
      { raw: "{ tronqué", type: "message" },
      { id: "ok", raw: line({ content: "bonjour", role: "user" }), type: "message" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe("user");
  });
});

describe("toItems — regroupement des appels d'outils", () => {
  test("pendant un tour actif, la progression reste dans le bloc de travail", () => {
    const items = toItems(
      messages([
        { raw: assistantText("progress", "I found the issue.") },
        { raw: toolCall("run", "bash") },
        { raw: toolResult("result", "bash") },
      ]),
      true,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("tools");
    if (items[0]?.kind === "tools")
      expect(items[0].messages[0]?.text).toContain("I found the issue.");
  });

  test("une suite d'outils devient un seul groupe", () => {
    const items = toItems(
      messages([
        { raw: toolCall("1", "bash") },
        { raw: toolResult("2", "bash") },
        { raw: toolCall("3", "edit") },
        { raw: toolResult("4", "edit") },
      ]),
    );

    expect(items).toHaveLength(1);
    if (items[0]?.kind === "tools") {
      expect(items[0].callCount).toBe(4);
      expect(items[0].tools.map((tool) => tool.name)).toContain("bash");
      expect(items[0].tools.map((tool) => tool.name)).toContain("edit");
    } else {
      throw new Error("groupe attendu");
    }
  });

  test("tout le travail d'un tour est UN seul groupe, la réponse reste dehors", () => {
    /*
      ⚠️ **L'ancienne règle groupait les messages « tout-outils » consécutifs.**
      Un tour réel est `text + thinking + toolCall` (565 messages sur 1080
      mesurés) : il n'était donc presque jamais groupé, et le travail d'un tour
      se retrouvait éparpillé en lignes isolées, avec un en-tête « A travaillé »
      après son propre contenu et un ou deux sous-blocs.

      Ici : trois messages de travail, puis une réponse. Le groupe vient
      **d'abord**, la réponse ensuite, hors du bloc.
    */
    const items = toItems(
      messages([
        { raw: toolCall("1", "bash") },
        { raw: toolResult("2", "bash") },
        { raw: toolCall("4", "bash") },
        { raw: toolResult("5", "bash") },
        { raw: assistantText("6", "J'ai fini.") },
      ]),
    );

    expect(items.map((item) => item.kind)).toEqual(["tools", "single"]);
    if (items[0]?.kind === "tools") expect(items[0].messages).toHaveLength(4);
    if (items[1]?.kind === "single") expect(items[1].message.text).toContain("J'ai fini");
  });

  test("un message d'utilisateur ferme le tour", () => {
    // C'est la frontière du travail : ce qui suit est un autre tour, donc un
    // autre bloc.
    const items = toItems(
      messages([
        { raw: toolCall("1", "bash") },
        { raw: line({ content: [{ text: "fais ceci", type: "text" }], role: "user" }) },
        { raw: toolCall("2", "bash") },
      ]),
    );

    expect(items.map((item) => item.kind)).toEqual(["tools", "single", "tools"]);
  });

  test("une suite d'outils seule forme bien un groupe", () => {
    // Elle n'a pas de prose : il n'y a donc pas de réponse à sortir du bloc.
    const items = toItems(messages([{ raw: toolResult("1", "bash") }]));
    expect(items[0]?.kind).toBe("tools");
  });

  test("un échec ne condamne pas le travail entier", () => {
    /*
      ⚠️ Le groupe portait un drapeau `hasError` qui allumait un badge « échec »
      sur tout le travail. C'était faux : une commande qui échoue au milieu de
      vingt n'invalide pas le travail. L'échec se marque **sur sa ligne** —
      c'est `lignesDeTravail` qui s'en charge, et c'est testé là-bas.
    */
    const items = toItems(
      messages([
        { raw: toolCall("1", "bash") },
        { raw: toolResult("2", "bash", "boom", true) },
        { raw: toolCall("3", "bash") },
        { raw: toolResult("4", "bash") },
      ]),
    );

    expect(items[0]?.kind).toBe("tools");
    expect("hasError" in (items[0] ?? {})).toBe(false);
  });

  test("les textes de l'assistant restent toujours visibles", () => {
    const items = toItems(messages([{ raw: assistantText("1", "Une décision importante.") }]));
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("single");
  });
});

describe("lastAssistantText — la demande d'un agent bloqué", () => {
  test("renvoie le dernier texte écrit par l'agent", () => {
    const result = messages([
      { raw: assistantText("1", "premier") },
      { raw: assistantText("2", "Je dois changer l'API. Puis-je continuer ?") },
    ]);
    expect(lastAssistantText(result)).toBe("Je dois changer l'API. Puis-je continuer ?");
  });

  test("ignore les tours sans texte (appels d'outils seuls)", () => {
    const result = messages([
      { raw: assistantText("1", "Ma question.") },
      { raw: toolCall("2", "bash") },
    ]);
    expect(lastAssistantText(result)).toBe("Ma question.");
  });

  test("renvoie undefined quand l'agent n'a rien dit — on n'invente pas", () => {
    expect(lastAssistantText(messages([{ raw: toolCall("1", "bash") }]))).toBeUndefined();
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
    expect(
      blockToText({ kind: "compaction", firstKeptEntryId: null, summary: "s", tokensBefore: 1 }),
    ).toBe("s");
  });
});
