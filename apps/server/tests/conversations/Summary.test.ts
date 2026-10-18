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
import {
  defaultRead,
  PREVIEW_BYTES,
  summaryOf,
  titleOf,
  type RawPane,
} from "../../src/conversations/Summary.ts";

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

/**
 * Une ligne pi **réelle** d'un tour d'assistant, modèle compris.
 *
 * ⚠️ C'est la forme de pi elle-même : `model`, `provider` et `thinkingLevel`
 * vivent sur **chaque** message, et non dans un événement de changement.
 */
const tour = (model: string, provider?: string, thinkingLevel?: string): string =>
  JSON.stringify({
    message: {
      content: [{ text: "ok", type: "text" }],
      model,
      ...(provider === undefined ? {} : { provider }),
      role: "assistant",
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    },
    timestamp: "2026-10-16T06:57:07.102Z",
    type: "message",
  });

/** Une ligne de **changement** de réglage, telle que la session l'écrit. */
const changement = (type: string, cle: string, valeur: string): string =>
  JSON.stringify({ [cle]: valeur, timestamp: "2026-10-09T16:17:28.362Z", type });

/**
 * Une ligne de session **Claude Code**, telle que son JSONL la porte.
 *
 * ⚠️ Sa forme ressemble à celle de pi — `message.role` — et c'est justement le
 * piège : une ligne refusée par l'adaptateur restait lisible comme un message.
 */
const claude = (type: string, content: unknown, at: string): string =>
  JSON.stringify({ message: { content, role: type }, timestamp: at, type, uuid: `${type}-${at}` });

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

  /**
   * ⚠️ **Le réglage est loin, et c'est le cas normal des longues sessions.**
   * Le modèle et le niveau de pensée ne sont écrits qu'en *changements* : la
   * session ne les répète pas. Sur une session réelle de 31 Mo, le dernier
   * `model_change` était à 608 Ko de la fin, alors que l'aperçu n'en lit que 64.
   * Sans remontée, la ligne ne déclarait aucun modèle — et la feuille de
   * changement s'ouvrait sans rien présélectionner.
   */
  test("un réglage plus ancien que la fenêtre est retrouvé", async () => {
    const path = join(dir, "reglages-loin.jsonl");
    const remplissage = Array.from({ length: 900 }, (_, index) =>
      ligne("assistant", [{ text: `${String(index)} ${"x".repeat(80)}` }]),
    ).join("\n");
    await writeFile(
      path,
      [
        changement("model_change", "modelId", "modele-ancien"),
        changement("thinking_level_change", "thinkingLevel", "high"),
        remplissage,
        ligne("assistant", [{ text: "dernier" }]),
      ].join("\n") + "\n",
    );
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.model).toBe("modele-ancien");
    expect(line.thinking).toBe("high");
  });

  /**
   * ⚠️ On remonte de la fin vers le début : la **première** occurrence trouvée
   * est la plus récente. Une fenêtre plus ancienne ne doit jamais écraser une
   * valeur déjà trouvée, sinon on afficherait un modèle que l'agent a quitté.
   */
  test("le réglage le PLUS RÉCENT gagne, même hors de la fenêtre", async () => {
    const path = join(dir, "reglages-recents.jsonl");
    const bloc = Array.from({ length: 900 }, (_, index) =>
      ligne("assistant", [{ text: `${String(index)} ${"y".repeat(80)}` }]),
    ).join("\n");
    await writeFile(
      path,
      [
        changement("model_change", "modelId", "modele-ancien"),
        bloc,
        changement("model_change", "modelId", "modele-recent"),
        bloc,
        ligne("assistant", [{ text: "dernier" }]),
      ].join("\n") + "\n",
    );
    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.model).toBe("modele-recent");
  });

  /*
    ⚠️ **L'aperçu remonte le fil, comme les réglages — et pour la même raison.**
    Une session claude réelle avait **94 % de son fichier en comptabilité**
    (`api-request-blob`, `api-request`, `attachment`…) : sur 511 Kio, 481 Kio ne
    portent pas la conversation. La fenêtre de 64 Kio ne contenait donc aucune
    ligne d'assistant, et l'agent — qui avait pourtant parlé — s'affichait sans
    aperçu dans la liste. Le champ manquait à la remontée.

    La garde ci-dessous vérifie que le trou dépasse bien **une** fenêtre : sans
    ça, le test passerait aussi avec l'ancien code et ne prouverait rien.
  */
  test("l'aperçu est retrouvé même quand la comptabilité remplit la fenêtre", async () => {
    const path = join(dir, "apercu-loin.jsonl");
    const comptabilite = Array.from({ length: 220 }, (_, index) =>
      JSON.stringify({
        payload: `${String(index)} ${"x".repeat(600)}`,
        type: "api-request-blob",
      }),
    ).join("\n");
    const contenu = [
      ligne("user", "la demande du début"),
      ligne("assistant", [{ text: "la réponse du début" }]),
      comptabilite,
      ligne("user", "et la toute dernière demande"),
    ].join("\n");
    await writeFile(path, `${contenu}\n`);

    // Le trou doit excéder une fenêtre de lecture, sinon ce test ne prouve rien.
    expect(Buffer.byteLength(comptabilite, "utf8")).toBeGreaterThan(PREVIEW_BYTES);

    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.preview).toBe("la réponse du début");
    expect(line.lastPrompt).toBe("et la toute dernière demande");
  });

  /*
    ⚠️ **Le piège propre à claude : la source parle la même langue que la cible.**

    Une ligne de conversation claude refusée par l'adaptateur retombait sur la
    règle générale — « une ligne illisible est gardée brute ». Sauf que sa forme
    est celle de pi : elle porte `message.role`. Le filtre marchait, et pourtant
    la liste annonçait `[Request interrupted by user]` comme « la dernière
    demande de l'utilisateur », parce que l'aperçu relisait la ligne brute.

    Chez codex, le même refus ne fuit pas : sa forme (`event_msg.payload`) n'a
    pas de `message.role`. Un adaptateur juste ne suffit donc pas quand la forme
    source ressemble à la forme cible.
  */
  test("une ligne claude refusée n'est pas relue comme une demande", async () => {
    const path = join(dir, "claude-marqueur.jsonl");
    await writeFile(
      path,
      [
        claude("user", "la vraie demande", "2026-10-16T10:00:00.000Z"),
        claude(
          "assistant",
          [{ text: "la vraie réponse", type: "text" }],
          "2026-10-16T10:00:01.000Z",
        ),
        claude("user", "[Request interrupted by user]", "2026-10-16T10:00:02.000Z"),
      ].join("\n") + "\n",
    );

    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.lastPrompt).toBe("la vraie demande");
    expect(line.preview).toBe("la vraie réponse");
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
    //
    // ⚠️ La liste est exhaustive **à dessein** : c'est en la comparant qu'on
    // remarque qu'un champ est apparu sans raison. `agent` y est entré en
    // connaissance de cause — la marque de la liste en dépend, et la ligne ne
    // peut pas aller la chercher ailleurs sans recroiser l'overview.
    const line = Effect.runSync(summaryOf(pane(), () => Effect.succeed(neverRead())));
    expect(Object.keys(line).toSorted()).toEqual([
      "agent",
      "name",
      "paneId",
      "paneRank",
      "sessionState",
      "status",
      "tabId",
      "tabPaneCount",
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

/**
 * Le modèle déclaré par le **message**, sans aucun changement enregistré.
 *
 * ⚠️ **Le défaut que cette section verrouille, et il a été vu à l'écran.** La
 * ligne de liste et l'en-tête annonçaient « model not declared » sur des agents
 * qui venaient d'écrire leur modèle noir sur blanc. La cause : le lecteur ne
 * cherchait que des événements `model_change`, alors que **quatre des cinq
 * sources** écrivent le modèle sur chaque message assistant — c'est la forme de
 * pi elle-même. Seul codex le met dans un événement, et il est traduit.
 *
 * Mesure avant correction : 7 des 12 conversations déclaraient un modèle.
 * Après : 12 sur 12.
 */
describe("U16 — le modèle vient aussi du message", () => {
  test("sans aucun `model_change`, le message suffit", async () => {
    const path = join(dir, "modele-du-message.jsonl");
    await writeFile(
      path,
      [ligne("user", "demande"), tour("deepseek-v4.1-flash", "opencode-go", "high")].join("\n") +
        "\n",
    );

    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.model).toBe("deepseek-v4.1-flash");
    expect(line.provider).toBe("opencode-go");
    expect(line.thinking).toBe("high");
  });

  test("le DERNIER message gagne, pas le premier", async () => {
    const path = join(dir, "modele-change-en-cours.jsonl");
    await writeFile(
      path,
      [
        tour("modele-ancien", "fournisseur-ancien", "low"),
        ligne("user", "encore"),
        tour("modele-recent", "fournisseur-recent", "max"),
      ].join("\n") + "\n",
    );

    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.model).toBe("modele-recent");
    expect(line.thinking).toBe("max");
  });

  test("un changement déclaré APRÈS le dernier message gagne aussi", async () => {
    // L'utilisateur a changé de modèle sans envoyer de tour : c'est le
    // changement qui décrit l'état, et il est le plus récent.
    const path = join(dir, "modele-change-apres.jsonl");
    await writeFile(
      path,
      [
        tour("modele-du-tour", "p", "high"),
        changement("model_change", "modelId", "modele-choisi"),
        changement("thinking_level_change", "thinkingLevel", "low"),
      ].join("\n") + "\n",
    );

    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.model).toBe("modele-choisi");
    expect(line.thinking).toBe("low");
  });

  test("le fournisseur n'est JAMAIS emprunté à un autre modèle", async () => {
    /*
      ⚠️ Modèle et fournisseur forment une **paire**. Ici le message le plus
      récent donne un modèle sans fournisseur, et un changement plus ancien en
      donne un : les coller ensemble afficherait « modele-recent · ancien-
      fournisseur », c'est-à-dire un couple qui n'a jamais existé.
    */
    const path = join(dir, "fournisseur-pair.jsonl");
    await writeFile(
      path,
      [
        changement("model_change", "modelId", "modele-ancien"),
        JSON.stringify({
          message: {
            content: [{ text: "ok", type: "text" }],
            model: "modele-recent",
            role: "assistant",
          },
          type: "message",
        }),
      ].join("\n") + "\n",
    );

    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.model).toBe("modele-recent");
    expect(line.provider).toBeUndefined();
  });

  test("un message SANS modèle n'efface pas celui d'un message plus ancien", async () => {
    // Le repli ne doit pas s'arrêter au premier message venu : il continue de
    // remonter tant que rien ne déclare. Sinon un tour d'outil sans modèle, à la
    // fin, effacerait tout.
    const path = join(dir, "modele-plus-loin.jsonl");
    await writeFile(
      path,
      [
        tour("modele-quelque-part"),
        ligne("user", "encore"),
        JSON.stringify({
          message: {
            content: [{ text: "ok", type: "text" }],
            role: "assistant",
          },
          type: "message",
        }),
      ].join("\n") + "\n",
    );

    const line = await Effect.runPromise(summaryOf(pane({ sessionPath: path }), defaultRead(dir)));
    expect(line.model).toBe("modele-quelque-part");
  });
});
