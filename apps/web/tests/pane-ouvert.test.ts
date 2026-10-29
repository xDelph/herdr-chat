/**
 * Le pane ouvert : présent, en attente de lecture, ou fermé — et ce que le
 * composeur peut faire (P1).
 *
 * ⚠️ Le défaut : l'écran retombait sur le dernier état mémorisé d'un pane
 * fermé, donc l'agent n'était jamais absent ; « Travaille » et Arrêter
 * restaient affichés pour toujours.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ecrireBrouillon } from "../src/brouillons.ts";
import { Composeur } from "../src/chat/Composeur.tsx";
import { presenceDuPane, raisonSansEnvoi, retiens } from "../src/pane-ouvert.ts";

const base = { lueA: 2_000, ouvertA: 1_000, overviewLu: true, present: false, vuAvant: false };

describe("présence du pane", () => {
  test("dans la dernière lecture : présent", () => {
    expect(presenceDuPane({ ...base, present: true })).toBe("present");
  });

  test("vu avant, absent maintenant : disparu", () => {
    expect(presenceDuPane({ ...base, vuAvant: true })).toBe("disparu");
  });

  test("ouverture à froid : rien n'est conclu avant la première lecture", () => {
    expect(presenceDuPane({ ...base, lueA: null, overviewLu: false })).toBe("attente");
  });

  test("agent tout juste lancé : la lecture d'AVANT l'ouverture ne tranche pas", () => {
    expect(presenceDuPane({ ...base, lueA: 500 })).toBe("attente");
    // Une lecture postérieure qui ne le voit toujours pas, elle, tranche.
    expect(presenceDuPane({ ...base, lueA: 1_500 })).toBe("disparu");
  });
});

describe("raison de ne pas envoyer", () => {
  test("pane fermé : on le dit", () => {
    expect(raisonSansEnvoi({ attente: null, phase: "pret", presence: "disparu" })).toContain(
      "ne connaît plus ce pane",
    );
  });

  test("question ou confiance à l'écran : le texte irait dans l'invite", () => {
    expect(raisonSansEnvoi({ attente: "question", phase: "pret", presence: "present" })).toContain(
      "choix ci-dessus",
    );
    expect(raisonSansEnvoi({ attente: "confiance", phase: "pret", presence: "present" })).toContain(
      "demande d'accès",
    );
  });

  test("session pas encore lue : on attend, et on dit pourquoi", () => {
    expect(raisonSansEnvoi({ attente: null, phase: "chargement", presence: "present" })).toContain(
      "Lecture de la conversation",
    );
  });

  test("tout est prêt : rien n'empêche l'envoi", () => {
    expect(raisonSansEnvoi({ attente: null, phase: "pret", presence: "present" })).toBeNull();
    // Avant la première lecture d'Herdr, le pane n'est pas déclaré fermé.
    expect(raisonSansEnvoi({ attente: null, phase: "pret", presence: "attente" })).toBeNull();
  });
});

describe("la mémoire des panes est bornée", () => {
  test("au-delà du maximum, la plus ancienne part ; une relecture la rajeunit", () => {
    let memoire: ReadonlyMap<string, number> = new Map();
    for (const cle of ["a", "b", "c"]) memoire = retiens(memoire, cle, 1, 3);
    memoire = retiens(memoire, "a", 2, 3);
    memoire = retiens(memoire, "d", 1, 3);
    expect([...memoire.keys()]).toEqual(["c", "a", "d"]);
  });

  test("la même valeur ne recrée pas la carte", () => {
    const memoire = retiens(new Map<string, number>(), "a", 1);
    expect(retiens(memoire, "a", 1)).toBe(memoire);
  });
});

const rendu = (props: Partial<Parameters<typeof Composeur>[0]>, paneId: string): string =>
  renderToStaticMarkup(
    createElement(Composeur, {
      agentNom: "Pi",
      aide: null,
      arretEnCours: false,
      onArrete: () => undefined,
      onEnvoie: () => undefined,
      paneId,
      travaille: true,
      ...props,
    }),
  ).replaceAll("&#x27;", "'");

describe("le composeur suit la présence", () => {
  test("pane fermé : saisie désactivée, ni Arrêter ni envoi possible", () => {
    ecrireBrouillon("ferme:p1", "texte");
    const html = rendu({ aide: "Herdr ne connaît plus ce pane", inactif: true }, "ferme:p1");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Arrêter");
    expect(html).toContain("Herdr ne connaît plus ce pane");
  });

  test("envoi impossible : le brouillon reste, Envoyer est désactivé, la raison est liée", () => {
    ecrireBrouillon("question:p1", "réponse");
    const html = rendu(
      { aide: "Répondez avec les choix ci-dessus", envoiImpossible: true, travaille: false },
      "question:p1",
    );
    expect(html).toMatch(/aria-label="Envoyer" disabled=""/);
    expect(html).toContain("aria-describedby");
    expect(html).toContain("réponse");
  });

  test("Entrée insère une ligne : la touche le dit (`enterkeyhint=enter`)", () => {
    expect(rendu({}, "touche:p1")).toContain('enterKeyHint="enter"');
  });
});
