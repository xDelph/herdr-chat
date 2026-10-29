/**
 * La transcription incrémentale — même résultat que le calcul complet, et
 * **les mêmes objets** pour ce qui n'a pas changé.
 *
 * ⚠️ L'identité est le contrat : c'est elle qui permet aux lignes mémoïsées de
 * ne pas se redessiner. Un test qui ne vérifierait que l'égalité de valeur
 * passerait sur une version qui recrée tout à chaque delta — le défaut même que
 * ce module ferme.
 */
import { describe, expect, test } from "bun:test";
import { toItems, toMessages } from "../src/blocks.ts";
import { fusionnerEntrees } from "../src/messages.ts";
import { creeGroupeur, creeTranscripteur, tourEnCours } from "../src/transcript.ts";

interface Entree {
  readonly id: string;
  readonly raw: string;
  readonly timestamp?: string;
  readonly type: string;
}

const utilisateur = (id: string, texte: string, timestamp?: string): Entree => ({
  id,
  raw: JSON.stringify({ message: { content: texte, role: "user" }, type: "message" }),
  type: "message",
  ...(timestamp === undefined ? {} : { timestamp }),
});

const assistant = (id: string, contenu: unknown, tokens?: number): Entree => ({
  id,
  raw: JSON.stringify({
    message: {
      content: contenu,
      role: "assistant",
      ...(tokens === undefined ? {} : { usage: { totalTokens: tokens } }),
    },
    type: "message",
  }),
  type: "message",
});

const appel = (id: string, nom: string, args: Record<string, unknown>): Entree =>
  assistant(id, [{ arguments: args, id: `${id}-c`, name: nom, type: "toolCall" }]);

const texte = (id: string, valeur: string): Entree =>
  assistant(id, [{ text: valeur, type: "text" }]);

const session: ReadonlyArray<Entree> = [
  utilisateur("u1", "première demande"),
  appel("a1", "read", { path: "/p/a.ts" }),
  texte("a2", "Voici la réponse."),
  utilisateur("u2", "deuxième demande"),
  appel("a3", "bash", { command: "cargo test" }),
  appel("a4", "edit", { edits: [{ newText: "b", oldText: "a" }], path: "/p/b.ts" }),
  texte("a5", "Fait."),
];

describe("même résultat que le calcul complet", () => {
  test("éléments identiques en valeur à `toItems(toMessages(…))`", () => {
    const transcrit = creeTranscripteur()(session);
    expect(transcrit.items).toEqual(toItems(toMessages(session)));
  });

  test("après une série de deltas, toujours le même résultat", () => {
    const transcrire = creeTranscripteur();
    let affichees: ReadonlyArray<Entree> = [];
    for (const entree of session) {
      affichees = fusionnerEntrees(affichees, [entree]);
      expect(transcrire(affichees).items).toEqual(toItems(toMessages(affichees)));
    }
    // Une ligne réécrite (opencode réécrit 97 % de ses lignes).
    affichees = fusionnerEntrees(affichees, [texte("a5", "Fait, et vérifié.")]);
    expect(transcrire(affichees).items).toEqual(toItems(toMessages(affichees)));
  });
});

describe("identité préservée", () => {
  test("un delta en bas ne recrée pas les éléments des tours précédents", () => {
    const transcrire = creeTranscripteur();
    const avant = transcrire(session);
    const apres = transcrire(fusionnerEntrees(session, [texte("a6", "Encore une chose.")]));

    const premierTour = avant.items.slice(0, 3);
    expect(apres.items.slice(0, 3)).toHaveLength(3);
    for (const [index, item] of premierTour.entries()) expect(apres.items[index]).toBe(item);
    expect(apres.items.length).toBe(avant.items.length + 1);
  });

  test("un ajout d'historique en haut ne recrée pas les tours existants", () => {
    const transcrire = creeTranscripteur();
    const recent = session.slice(3);
    const avant = transcrire(recent);
    const apres = transcrire([...session.slice(0, 3), ...recent]);
    const decalage = apres.items.length - avant.items.length;
    for (const [index, item] of avant.items.entries()) {
      expect(apres.items[index + decalage]).toBe(item);
    }
  });

  test("une entrée inchangée n'est décodée qu'une fois (même message)", () => {
    const transcrire = creeTranscripteur();
    const avant = transcrire(session);
    const apres = transcrire([...session]);
    expect(apres.messages[0]).toBe(avant.messages[0]);
  });

  test("le même tableau rend le même résultat, sans travail", () => {
    const transcrire = creeTranscripteur();
    expect(transcrire(session)).toBe(transcrire(session));
  });

  test("le groupeur seul : un tour inchangé rend les mêmes objets", () => {
    const grouper = creeGroupeur();
    const messages = toMessages(session);
    const premier = grouper(messages);
    const second = grouper([...messages]);
    expect(second).not.toBe(premier);
    for (const [index, item] of premier.entries()) expect(second[index]).toBe(item);
  });
});

describe("le tour en cours", () => {
  test("durée depuis la demande, jetons du tour, dernière action", () => {
    const tour = tourEnCours(
      toMessages([
        utilisateur("u1", "ancienne", "2026-10-29T10:00:00Z"),
        assistant("a0", [{ text: "x", type: "text" }], 999),
        utilisateur("u2", "go", "2026-10-29T13:52:00Z"),
        assistant(
          "a1",
          [{ arguments: { command: "cargo clippy" }, id: "c", name: "bash", type: "toolCall" }],
          1200,
        ),
        assistant("a2", [{ thinking: "hmm", type: "thinking" }], 300),
        assistant("a3", [
          { arguments: { file_path: "/p/main.rs" }, id: "d", name: "Read", type: "toolCall" },
        ]),
      ]),
    );
    expect(tour.debutMs).toBe(Date.parse("2026-10-29T13:52:00Z"));
    expect(tour.jetons).toBe(1500);
    expect(tour.derniereAction?.singulier).toBe("Lu");
    expect(tour.derniereAction?.cible).toBe("/p/main.rs");
  });

  test("sans horodatage ni jetons, rien n'est inventé", () => {
    const tour = tourEnCours(toMessages([utilisateur("u1", "go")]));
    expect(tour.debutMs).toBeNull();
    expect(tour.jetons).toBeNull();
    expect(tour.derniereAction).toBeNull();
  });
});
