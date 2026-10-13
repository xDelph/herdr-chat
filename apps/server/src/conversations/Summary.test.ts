/**
 * Lignes de conversation (B10).
 *
 * Le contrat est ici, pas dans le composant : le serveur produit, le client
 * décode, et les deux lisent la même définition. Ce fichier verrouille les
 * règles du tableau « Règles déjà tranchées » — en particulier l'absence
 * **volontaire** de tout compteur de non-lus, qu'aucune source ne permet.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationSummary } from "@herdr-remote/shared";
import { Option, Schema } from "effect";
import { defaultRead, summaryOf, titleOf, type RawPane } from "./Summary.ts";

let dir = "";

const pane = (over: Partial<RawPane> = {}): RawPane => ({
  agentStatus: "idle",
  paneId: "w1:p1",
  sessionPath: null,
  tabLabel: null,
  title: null,
  workspaceId: "w1",
  workspaceLabel: null,
  ...over,
});

/**
 * Une ligne de session **telle qu'elle existe**, avec un horodatage ISO :
 * `Number("2026-…")` vaut `NaN`, et c'est ce que l'ancien code calculait.
 */
const ligne = (role: string, content: unknown, at = "2026-10-09T15:08:21.784Z"): string =>
  JSON.stringify({ message: { content, role }, timestamp: at, type: "message" });

/** Une ligne de **changement** de réglage, telle que la session l'écrit. */
const changement = (type: string, cle: string, valeur: string): string =>
  JSON.stringify({ [cle]: valeur, timestamp: "2026-10-09T16:17:28.362Z", type });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "herdr-summary-"));
});

afterAll(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("titre — premier non vide de la cascade", () => {
  test("le titre Herdr gagne quand il existe", () => {
    expect(
      titleOf(pane({ tabLabel: "onglet", title: "Titre Herdr", workspaceLabel: "Projet" })),
    ).toBe("Titre Herdr");
  });

  test("sans titre Herdr, c'est le libellé d'onglet", () => {
    expect(titleOf(pane({ tabLabel: "ongo", workspaceLabel: "Projet" }))).toBe("ongo");
  });

  test("un libellé d'onglet purement numérique est traité comme ABSENT", () => {
    // Herdr nomme les onglets « 1 », « 2 »… : le numéro n'apprend rien et
    // serait trompeur. Le libellé de projet prend le relais.
    expect(titleOf(pane({ tabLabel: "3", workspaceLabel: "Projet" }))).toBe("Projet");
  });

  test("sans titre ni onglet, c'est le libellé de projet", () => {
    expect(titleOf(pane({ workspaceLabel: "herdr-pwa" }))).toBe("herdr-pwa");
  });

  test("aucun libellé : le paneId, qui est exact", () => {
    expect(titleOf(pane())).toBe("w1:p1");
  });

  test("un titre fait d'espaces est traité comme absent", () => {
    expect(titleOf(pane({ tabLabel: "onglet", title: "   " }))).toBe("onglet");
  });
});

describe("aperçu et horodatage — jamais inventés", () => {
  test("session absente : ni aperçu, ni horodatage, et les champs sont ABSENTS", () => {
    const line = Effect.runSync(summaryOf(pane(), () => Effect.succeed(neverRead())));
    // L'absence doit être **visible** : un `preview: null` se lirait comme
    // « on sait qu'il n'y a pas d'aperçu », ce qui est différent.
    expect("preview" in line).toBe(false);
    expect("timestamp" in line).toBe(false);
    expect(line.sessionState).toBe("absent");
  });

  test("session illisible : `error`, et pas un aperçu vide", () => {
    const line = Effect.runSync(
      summaryOf(pane({ sessionPath: "/inexistant.jsonl" }), () => Effect.fail(new Error("EACCES"))),
    );
    expect(line.sessionState).toBe("error");
    expect("preview" in line).toBe(false);
  });

  /**
   * ⚠️ Le cas d'un agent **bloqué**. Mesuré sur un agent codex en attente
   * d'approbation : dans la fenêtre lue, il n'avait rien *dit* — que des appels
   * d'outils. Sans repli, sa ligne dans « À traiter » restait **vide** : on
   * voyait qu'il fallait agir, sans voir sur quoi.
   */
  test("un agent qui n'a rien dit montre son dernier appel d'outil", async () => {
    const path = join(dir, "outil.jsonl");
    await writeFile(
      path,
      [
        ligne("user", "ouvre le navigateur"),
        JSON.stringify({
          message: {
            content: [
              {
                arguments: {
                  code: "await cua.getState();",
                  title: "Inspect available browser window",
                },
                name: "js",
                type: "toolCall",
              },
            ],
            role: "assistant",
          },
          timestamp: "2026-10-09T15:09:00.000Z",
          type: "message",
        }),
      ].join("\n") + "\n",
    );
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.preview).toBe("js · Inspect available browser window");
  });

  test("sans rien à montrer, l'aperçu reste ABSENT — on n'invente pas", async () => {
    const path = join(dir, "muet.jsonl");
    await writeFile(path, ligne("assistant", [{ text: "  " }]));
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect("preview" in line).toBe(false);
  });

  test("session existante et vide : `available`, pas `absent`", () => {
    const vide = Effect.runSync(
      summaryOf(pane({ sessionPath: "/x" }), () => Effect.succeed(neverRead())),
    );
    // Le fichier existe : dire « absent » ferait croire qu'il n'a pas encore
    // été créé, et l'interface afficherait un état d'attente faux.
    expect(vide.sessionState).toBe("available");
  });

  test("le dernier message texte devient l'aperçu", async () => {
    /*
      ⚠️ **La forme réelle d'une ligne Pi**, relevée sur une session de la
      machine : `{ type: "message", message: { role, content } }`. Les fixtures
      de test utilisaient `{ type: "assistant", content }` — une forme qui
      n'existe nulle part. C'est pour ça que le défaut est passé : le test
      validait le code contre un format imaginaire.
    */
    const path = join(dir, "a.jsonl");
    await writeFile(
      path,
      [
        ligne("user", "question"),
        ligne("assistant", [{ text: "première réponse" }]),
        ligne("assistant", [{ text: "dernière réponse" }]),
        "",
      ].join("\n"),
    );
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.preview).toBe("dernière réponse");
  });

  test("un assistant qui n'a écrit que des outils n'invente pas d'aperçu", async () => {
    const path = join(dir, "outils.jsonl");
    await writeFile(path, [ligne("assistant", [{ toolCall: { name: "bash" } }]), ""].join("\n"));
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    // Un aperçu composé de JSON d'outils n'apprendrait rien dans une liste.
    expect("preview" in line).toBe(false);
  });

  test("un JSON illisible donne une ligne sans aperçu, pas une exception", async () => {
    const path = join(dir, "corrompu.jsonl");
    await writeFile(path, "{ ceci n'est pas du json\n");
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect("preview" in line).toBe(false);
  });
});

describe("contrat — le payload est validé", () => {
  test("une ligne bien formée passe le schéma partagé", () => {
    const line = Effect.runSync(summaryOf(pane(), () => Effect.succeed(neverRead())));
    const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(ConversationSummary)(line));
    expect(decoded).toBeDefined();
  });

  test("un champ « non lu » n'existe pas dans le schéma", () => {
    // Herdr n'expose aucun compteur exploitable (son `revision` vaut 0). Un
    // tel champ serait une invention — donc il doit être **absent**.
    const line = Effect.runSync(summaryOf(pane(), () => Effect.succeed(neverRead())));
    expect(Object.keys(line).toSorted()).toEqual([
      "paneId",
      "sessionState",
      "status",
      "title",
      "workspaceId",
    ]);
  });
});

/** Une session relue sans rien dedans. */
const neverRead = () => ({
  entries: [],
  hasMore: false,
  identity: { dev: 1, ino: 1 },
  offset: 0,
  pending: "",
});

describe("U16 — la ligne de liste montre ce qu'on a demandé", () => {
  test("la dernière demande de l'utilisateur, pas la réponse de l'agent", async () => {
    const path = join(dir, "demande.jsonl");
    await writeFile(
      path,
      [
        ligne("user", [{ text: "ancienne demande" }]),
        ligne("assistant", [{ text: "réponse" }]),
        ligne("user", [{ text: "corrige le curseur opaque" }]),
        "",
      ].join("\n"),
    );
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    // ⚠️ La réponse et la demande sont deux choses différentes : une liste
    // montre ce qu'on a demandé, qu'on reconnaît d'un coup d'œil.
    expect(line.lastPrompt).toBe("corrige le curseur opaque");
    expect(line.preview).toBe("réponse");
  });

  test("sans demande de l'utilisateur, le champ est ABSENT", async () => {
    const path = join(dir, "sans-demande.jsonl");
    await writeFile(path, [ligne("assistant", [{ text: "rien demandé" }]), ""].join("\n"));
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect("lastPrompt" in line).toBe(false);
  });
});

describe("U16 — modèle et raisonnement en vigueur", () => {
  test("le dernier `model_change` et le dernier `thinking_level_change`", async () => {
    const path = join(dir, "reglages.jsonl");
    await writeFile(
      path,
      [
        changement("model_change", "modelId", "ancien-modele"),
        changement("thinking_level_change", "thinkingLevel", "low"),
        changement("model_change", "modelId", "deepseek-v4.1-flash"),
        changement("thinking_level_change", "thinkingLevel", "high"),
        "",
      ].join("\n"),
    );
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    // Ce sont des **changements**, pas un état : on remonte au dernier de chaque.
    expect(line.model).toBe("deepseek-v4.1-flash");
    expect(line.thinking).toBe("high");
  });

  test("sans changement déclaré, les champs sont ABSENTS", async () => {
    const path = join(dir, "sans-reglages.jsonl");
    await writeFile(path, [ligne("user", [{ text: "bonjour" }]), ""].join("\n"));
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect("model" in line).toBe(false);
    expect("thinking" in line).toBe(false);
  });
});

describe("U16 — l'horodatage est une chaîne ISO", () => {
  test("un ISO se convertit en millisecondes", async () => {
    // ⚠️ `Number("2026-10-09T15:08:21.784Z")` vaut `NaN` : l'ancien code perdait
    // donc l'horodatage en silence, et la liste n'affichait aucune date.
    const path = join(dir, "iso.jsonl");
    await writeFile(path, [ligne("user", [{ text: "x" }]), ""].join("\n"));
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.timestamp).toBe(Date.parse("2026-10-09T15:08:21.784Z"));
    expect(Number.isFinite(line.timestamp)).toBe(true);
  });

  test("un horodatage illisible est absent, jamais NaN", async () => {
    const path = join(dir, "iso-casse.jsonl");
    await writeFile(path, [ligne("user", [{ text: "x" }], "pas-une-date"), ""].join("\n"));
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    // `NaN` passerait le décodage du contrat et s'afficherait « Invalid Date ».
    expect("timestamp" in line).toBe(false);
  });
});
