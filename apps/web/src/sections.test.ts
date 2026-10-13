/**
 * La règle de l'accueil — testée seule, sans application (U04).
 *
 * Chaque cas vient du tableau des « Règles déjà tranchées ». Si la règle
 * change, un de ces tests tombe : c'est le but.
 */
import { describe, expect, test } from "bun:test";
import type { AgentStatus, ConversationSummary } from "@herdr-remote/shared";
import { countOf, SECTIONS, SECTION_LABEL, sectionConversations, sectionOf } from "./sections.ts";

const ligne = (
  paneId: string,
  status: AgentStatus = "idle",
  timestamp?: number,
  /** Titre affiché. Par défaut le `paneId`, ce qui rend les listes lisibles. */
  titre?: string,
): ConversationSummary => ({
  ...(timestamp === undefined ? {} : { timestamp }),
  paneId,
  sessionState: "available",
  status,
  title: titre ?? paneId,
  workspaceId: "w1",
});

const dans = (
  entrees: ReadonlyArray<ReturnType<typeof sectionConversations>[number]>,
  nom: string,
) => entrees.find((entree) => entree.section === nom)?.conversations.map((c) => c.paneId) ?? [];

describe("U04 — un pane apparaît une fois", () => {
  test("chaque statut tombe dans sa section", () => {
    expect(sectionOf("blocked")).toBe("a-traiter");
    expect(sectionOf("working")).toBe("en-cours");
    expect(sectionOf("idle")).toBe("recents");
    expect(sectionOf("done")).toBe("recents");
    expect(sectionOf("unknown")).toBe("recents");
  });

  test("un agent bloqué n'apparaît qu'une fois, même s'il travaille aussi", () => {
    // La priorité de `blocked` est la règle : un agent qui travaille *et* est
    // bloqué doit rester actionnable. Le mettre aussi dans « En cours » le
    // ferait apparaître deux fois.
    const entrees = sectionConversations([ligne("w1:p1", "blocked", 100)]);
    expect(dans(entrees, "a-traiter")).toEqual(["w1:p1"]);
    expect(dans(entrees, "en-cours")).toEqual([]);
    expect(dans(entrees, "recents")).toEqual([]);
  });

  test("chaque pane est dans exactement une section", () => {
    const entrees = sectionConversations([
      ligne("w1:p1", "blocked", 1),
      ligne("w1:p2", "working", 2),
      ligne("w1:p3", "idle", 3),
      ligne("w1:p4", "done", 4),
      ligne("w1:p5", "unknown", 5),
    ]);
    const total = entrees.reduce((somme, entree) => somme + entree.conversations.length, 0);
    expect(total).toBe(5);
    expect(countOf(entrees, "a-traiter")).toBe(1);
    expect(countOf(entrees, "en-cours")).toBe(1);
    expect(countOf(entrees, "recents")).toBe(3);
  });
});

describe("U04 — tri dans chaque section", () => {
  test("dernier message décroissant", () => {
    const entrees = sectionConversations([
      ligne("w1:p1", "idle", 100),
      ligne("w1:p2", "idle", 300),
      ligne("w1:p3", "idle", 200),
    ]);
    expect(dans(entrees, "recents")).toEqual(["w1:p2", "w1:p3", "w1:p1"]);
  });

  /**
   * Le contrepied : une ligne **sans horodatage** n'est pas « la plus
   * ancienne », elle est hors classement. La traiter comme une date à zéro la
   * remonterait en tête de liste — l'inverse de l'intention.
   */
  test("absence d'horodatage : la ligne passe en DERNIER", () => {
    const entrees = sectionConversations([
      ligne("w1:sans-date", "idle"),
      ligne("w1:recent", "idle", 300),
      ligne("w1:moyen", "idle", 200),
    ]);
    expect(dans(entrees, "recents")).toEqual(["w1:recent", "w1:moyen", "w1:sans-date"]);
  });

  test("deux lignes sans horodatage : paneId croissant", () => {
    const entrees = sectionConversations([
      ligne("w1:p9", "idle"),
      ligne("w1:p2", "idle"),
      ligne("w1:p5", "idle"),
    ]);
    expect(dans(entrees, "recents")).toEqual(["w1:p2", "w1:p5", "w1:p9"]);
  });

  test("à horodatage égal, paneId croissant — donc tri déterministe", () => {
    const entrees = sectionConversations([
      ligne("w1:p9", "idle", 500),
      ligne("w1:p2", "idle", 500),
      ligne("w1:p5", "idle", 500),
    ]);
    expect(dans(entrees, "recents")).toEqual(["w1:p2", "w1:p5", "w1:p9"]);
  });

  test("le tri ne modifie pas le tableau d'entrée", () => {
    const source = [ligne("w1:p1", "idle", 100), ligne("w1:p2", "idle", 300)];
    const copie = source.map((c) => c.paneId);
    sectionConversations(source);
    expect(source.map((c) => c.paneId)).toEqual(copie);
  });
});

describe("U04 — l'ordre par nom", () => {
  test("le défaut reste le plus récent — on ne change pas la règle en silence", () => {
    const source = [ligne("w1:p1", "idle", 100), ligne("w1:p2", "idle", 300)];
    expect(dans(sectionConversations(source), "recents")).toEqual(["w1:p2", "w1:p1"]);
    expect(dans(sectionConversations(source, "recent"), "recents")).toEqual(["w1:p2", "w1:p1"]);
  });

  test("par nom : ordre alphabétique, quelle que soit la date", () => {
    const source = [
      ligne("w1:p1", "idle", 300, "zeta"),
      ligne("w1:p2", "idle", 100, "alpha"),
      ligne("w1:p3", "idle", 200, "midi"),
    ];
    expect(dans(sectionConversations(source, "nom"), "recents")).toEqual([
      "w1:p2",
      "w1:p3",
      "w1:p1",
    ]);
  });

  test("l'ordre par nom ignore la casse et les accents", () => {
    // « Émile » doit se ranger à « e », pas après « z » : sinon la liste paraît
    // rangée alors qu'elle ne l'est pas.
    const source = [ligne("w1:p1", "idle", 1, "Émile"), ligne("w1:p2", "idle", 1, "zoe")];
    expect(dans(sectionConversations(source, "nom"), "recents")).toEqual(["w1:p1", "w1:p2"]);
  });

  test("à nom égal, paneId croissant — l'ordre reste déterministe", () => {
    const source = [ligne("w1:p9", "idle", 1), ligne("w1:p2", "idle", 2)];
    expect(dans(sectionConversations(source, "nom"), "recents")).toEqual(["w1:p2", "w1:p9"]);
  });

  test("changer l'ordre ne change AUCUNE répartition", () => {
    // L'ordre est un affichage, pas un classement : les sections et leurs
    // effectifs doivent être identiques dans les deux ordres.
    const source = [
      ligne("w1:p1", "blocked", 100, "c"),
      ligne("w1:p2", "working", 200, "a"),
      ligne("w1:p3", "idle", 300, "b"),
    ];
    for (const ordre of ["recent", "nom"] as const) {
      const entrees = sectionConversations(source, ordre);
      expect(entrees.map((e) => e.section)).toEqual([...SECTIONS]);
      expect(entrees.map((e) => e.conversations.length)).toEqual([1, 1, 1]);
    }
  });
});

describe("U04 — structure et libellés", () => {
  test("les trois sections existent toujours, même vides", () => {
    const entrees = sectionConversations([]);
    expect(entrees.map((e) => e.section)).toEqual([...SECTIONS]);
    // Une section vide reste présente : l'écran garde sa hauteur et l'utilisateur
    // ne voit pas l'écran sauter quand une conversation change de section.
    for (const entree of entrees) {
      expect(entree.conversations).toEqual([]);
    }
  });

  test("chaque section a un libellé exact", () => {
    expect(SECTION_LABEL["a-traiter"]).toBe("Needs attention");
    expect(SECTION_LABEL["en-cours"]).toBe("In progress");
    expect(SECTION_LABEL["recents"]).toBe("Recent");
  });

  test("la réponse est stable à conversation identique", () => {
    const source = [
      ligne("w1:p3", "idle", 300),
      ligne("w1:p1", "blocked", 100),
      ligne("w1:p2", "idle"),
    ];
    expect(sectionConversations(source)).toEqual(sectionConversations(source));
  });
});
