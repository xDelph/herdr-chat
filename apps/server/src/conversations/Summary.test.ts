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

  test("session existante et vide : `available`, pas `absent`", () => {
    const vide = Effect.runSync(
      summaryOf(pane({ sessionPath: "/x" }), () => Effect.succeed(neverRead())),
    );
    // Le fichier existe : dire « absent » ferait croire qu'il n'a pas encore
    // été créé, et l'interface afficherait un état d'attente faux.
    expect(vide.sessionState).toBe("available");
  });

  test("le dernier message texte devient l'aperçu", async () => {
    const path = join(dir, "a.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({ type: "user", content: "question" }),
        JSON.stringify({ type: "assistant", content: [{ text: "première réponse" }] }),
        JSON.stringify({ type: "assistant", content: [{ text: "dernière réponse" }] }),
        "",
      ].join("\n"),
    );
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.preview).toBe("dernière réponse");
  });

  test("un assistant qui n'a écrit que des outils n'invente pas d'aperçu", async () => {
    const path = join(dir, "outils.jsonl");
    await writeFile(
      path,
      [JSON.stringify({ type: "assistant", content: [{ toolCall: { name: "bash" } }] }), ""].join(
        "\n",
      ),
    );
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
