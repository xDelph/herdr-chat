/**
 * Les écrans, rendus côté serveur avec des données factices — aucun réseau,
 * aucun agent.
 *
 * Ce qui est vérifié est du **comportement visible** : ce que l'écran propose
 * et ce qu'il dit, pas la forme du code. Les quelques lectures de source à la
 * fin gardent deux portes qui ne se voient pas à l'écran : le focus du Mac et
 * le nombre de flux globaux.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationSummary } from "@herdr-remote/shared";
import { ecrireBrouillon } from "../src/brouillons.ts";
import { toMessages } from "../src/blocks.ts";
import type { Envoi } from "../src/envois.ts";
import { Composeur } from "../src/chat/Composeur.tsx";
import { Envois } from "../src/chat/Envois.tsx";
import { GroupeOutils } from "../src/chat/Outils.tsx";
import { Question } from "../src/chat/Question.tsx";
import { CarteAttention } from "../src/inbox/CarteAttention.tsx";

const rien = () => undefined;

/** Le HTML rendu, apostrophes décodées. */
const rendu = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element).replaceAll("&#x27;", "'");

const composeur = (travaille: boolean, paneId = "w1:p1") =>
  rendu(
    createElement(Composeur, {
      agentNom: "Claude Code",
      aide: null,
      arretEnCours: false,
      onArrete: rien,
      onEnvoie: rien,
      paneId,
      travaille,
    }),
  );

describe("Arrêter reste visible tant que l'agent travaille", () => {
  test("champ vide : Arrêter, sans Envoyer", () => {
    const html = composeur(true, "vide:p1");
    expect(html).toContain('aria-label="Arrêter l\'agent"');
    expect(html).not.toContain('aria-label="Envoyer"');
  });

  test("champ rempli : Arrêter ET Envoyer — taper ne cache jamais l'arrêt", () => {
    ecrireBrouillon("rempli:p1", "corrige plutôt le test");
    const html = composeur(true, "rempli:p1");
    expect(html).toContain('aria-label="Arrêter l\'agent"');
    expect(html).toContain('aria-label="Envoyer"');
    expect(html).toContain("corrige plutôt le test");
  });

  test("au repos : pas d'Arrêter", () => {
    expect(composeur(false, "repos:p1")).not.toContain("Arrêter");
  });

  test("le brouillon est celui du pane, jamais celui d'un autre", () => {
    ecrireBrouillon("a:p1", "pour A");
    expect(composeur(false, "b:p1")).not.toContain("pour A");
  });
});

const envoi = (changement: Partial<Envoi>): Envoi => ({
  baseline: 0,
  detail: null,
  failureState: null,
  id: "local-1",
  pane: "w1:p1",
  state: "queued",
  text: "lance les tests",
  ...changement,
});

const envois = (liste: ReadonlyArray<Envoi>) =>
  rendu(createElement(Envois, { liste, onRemettre: rien }));

describe("un envoi non confirmé n'est jamais affiché comme envoyé", () => {
  test("incertain : dit qu'il n'est pas confirmé, propose de réessayer", () => {
    const html = envois([envoi({ state: "uncertain" })]);
    expect(html).toContain("Remise non confirmée par Herdr");
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("Remis à Herdr");
  });

  test("délai dépassé : peut-être parti, réessayer", () => {
    const html = envois([envoi({ detail: "délai", failureState: "attente", state: "uncertain" })]);
    expect(html).toContain("peut-être parti");
  });

  test("transport muet : le renvoi est signalé comme un doublon possible", () => {
    const html = envois([envoi({ detail: "x", failureState: "inconnu", state: "uncertain" })]);
    expect(html).toContain("doublon possible");
  });

  test("refus : la cause est affichée, et on peut modifier", () => {
    const html = envois([
      envoi({ detail: "prompt trop long", failureState: "erreur", state: "failed" }),
    ]);
    expect(html).toContain("prompt trop long");
    expect(html).toContain("Modifier");
  });

  test("en file : annulable", () => {
    expect(envois([envoi({})])).toContain("Annuler");
  });
});

const ligne = (id: string, role: string, contenu: unknown) => ({
  id,
  raw: JSON.stringify({ message: { content: contenu, role }, type: "message" }),
  type: "message",
});

describe("le travail se lit en lignes", () => {
  const messages = toMessages([
    ligne("a1", "assistant", [
      {
        arguments: { file_path: "/p/src/main.rs", new_string: "b", old_string: "a" },
        id: "c1",
        name: "Edit",
        type: "toolCall",
      },
    ]),
    ligne("a2", "assistant", [
      { arguments: { command: "cargo test" }, id: "c2", name: "Bash", type: "toolCall" },
    ]),
    {
      id: "r2",
      raw: JSON.stringify({
        message: { content: "boom", isError: true, role: "toolResult", toolName: "Bash" },
        type: "message",
      }),
      type: "message",
    },
  ]);

  test("verbe, cible relative au projet, résultat", () => {
    const html = rendu(
      createElement(GroupeOutils, { cwd: "/p", enCours: true, messages, onOuvrirFichier: rien }),
    );
    expect(html).toContain("Modifié");
    expect(html).toContain("src/main.rs");
    expect(html).not.toContain("/p/src/main.rs</span>");
    expect(html).toContain("+1 −1");
    expect(html).toContain("Lancé");
    expect(html).toContain("cargo test");
  });

  test("un échec se marque sur sa ligne, et le groupe replié le compte", () => {
    const html = rendu(
      createElement(GroupeOutils, { cwd: "/p", enCours: false, messages, onOuvrirFichier: rien }),
    );
    expect(html).toContain("1 échec");
    expect(html).toContain('aria-expanded="false"');
  });
});

const bloquee = (changement: Partial<ConversationSummary>): ConversationSummary => ({
  agent: "claude",
  name: null,
  paneId: "w7:p1",
  paneRank: null,
  sessionState: "available",
  status: "blocked",
  tabId: "w7:t1",
  tabPaneCount: 1,
  title: "✳ Revue",
  workspaceId: "w7",
  ...changement,
});

describe("répondre depuis la liste", () => {
  test("une question montre ses choix numérotés, tels que lus à l'écran", () => {
    const html = rendu(
      createElement(CarteAttention, {
        conversation: bloquee({
          question: {
            choix: [
              { libelle: "Oui, appliquer", numero: 1, selectionne: true },
              { libelle: "Non", numero: 2, selectionne: false },
            ],
            contexte: [],
            texte: "Appliquer la migration 0042 ?",
          },
        }),
        maintenant: 0,
        projet: "atcrea",
        titre: "Revue",
      }),
    );
    expect(html).toContain("Appliquer la migration 0042 ?");
    expect(html).toContain("Oui, appliquer");
    expect(html).toContain('<span class="k">2</span>');
    expect(html).toContain("bouton--attn");
  });

  test("une confiance montre accorder et refuser — le refus dit qu'il arrête", () => {
    const html = rendu(
      createElement(CarteAttention, {
        conversation: bloquee({
          trust: {
            folder: "/Users/x/pixel",
            kind: "codex",
            message: "trust?",
            paneId: "w7:p1",
            status: "trust-required",
          },
        }),
        maintenant: 0,
        projet: "pixel",
        titre: "",
      }),
    );
    expect(html).toContain("Faire confiance");
    expect(html).toContain("Refuser et arrêter codex");
    expect(html).toContain("/Users/x/pixel");
  });

  test("une attente sans choix montre l'écran et n'invente aucun bouton de réponse", () => {
    const html = rendu(
      createElement(CarteAttention, {
        conversation: bloquee({ waiting: "Review\n> Submit answers" }),
        maintenant: 0,
        projet: "pixel",
        titre: "",
      }),
    );
    expect(html).toContain("Submit answers");
    expect(html).not.toContain('class="k"');
  });
});

describe("la question ancrée dit d'où elle vient", () => {
  test("provenance et réponse libre quand l'agent en offre une", () => {
    const html = rendu(
      createElement(Question, {
        agentNom: "opencode",
        conversation: bloquee({
          question: {
            choix: [
              { libelle: "Rust", numero: 1, selectionne: false },
              { libelle: "Type your own answer", numero: 2, selectionne: false },
            ],
            contexte: [],
            texte: "Quel langage ?",
          },
        }),
        lueA: null,
      }),
    );
    expect(html).toContain("Lue sur l'écran de l'agent");
    expect(html).toContain("Autre réponse");
    // L'option de saisie libre n'est pas un bouton qui partirait seul.
    expect(html).not.toContain("Type your own answer");
  });
});

/** Tous les fichiers source de l'app, pour les deux portes ci-dessous. */
const sources = (dossier: string): ReadonlyArray<string> =>
  readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? sources(chemin) : [chemin];
  });
const racine = join(import.meta.dir, "..", "src");
const appelants = (motif: string): ReadonlyArray<string> =>
  sources(racine)
    .filter((chemin) => readFileSync(chemin, "utf8").includes(motif))
    .map((chemin) => chemin.slice(racine.length + 1))
    .toSorted();

describe("portes invisibles à l'écran", () => {
  test("le focus du Mac n'est posé que par le geste explicite du menu", () => {
    // Lire (défiler, ouvrir) ne doit jamais appeler `/focus` : c'était le vol
    // de clavier du Mac. Un seul appelant, `montrerSurMac`, câblé au menu.
    expect(appelants("focusAgent(")).toEqual(["app/gestes.ts"]);
    expect(appelants("montrerSurMac(")).toEqual(["chat/Conversation.tsx"]);
  });

  test("un seul flux global pour toute l'app", () => {
    // Le flux global n'est ouvert que par `openEventStream`, branché une fois
    // sur le magasin ; l'autre `EventSource` est le flux PAR SESSION.
    expect(appelants('new EventSource("/api/events")')).toEqual(["api.ts"]);
    expect(appelants("new EventSource(")).toEqual(["api.ts", "app/services.ts"]);
    expect(appelants("ouvreEvenements: openEventStream")).toEqual(["app/services.ts"]);
  });
});
