/**
 * Un agent bloqué sans question numérotée doit quand même dire ce qu'il attend.
 *
 * ⚠️ **Le cas mesuré, 2026-10-17.** opencode pose ses questions en **formulaires
 * à plusieurs champs**, puis passe par une étape **Review** dont l'écran n'a
 * aucun choix numéroté. `questionDeLEcran` rend alors `undefined` : la carte de
 * question disparaissait, l'agent restait `blocked`, et l'écran ne disait plus
 * rien — « agent marqué comme bloqué, mais plus de question ». L'utilisateur
 * n'avait plus rien à quoi répondre.
 *
 * ⚠️ **Ce qu'on ne fait pas.** On n'invente **aucun** choix à partir de l'écran :
 * une touche fabriquée serait une décision que l'utilisateur n'a pas prise. On
 * montre les lignes, brutes.
 */
import { describe, expect, test } from "bun:test";
import { attenteDeLEcran, attenteDeLigne } from "../../src/http/routes-conversations.ts";

/** L'écran de revue d'opencode, tel qu'il se présente après le dernier champ. */
const ECRAN_REVUE = `
  ┃  Questions
  ┃
  ┃  Review
  ┃
  ┃  How would you like to share it?: It's a file on disk
  ┃  Which project?: perso
  ┃
  ┃  enter Submit form   esc dismiss
`;

describe("l'écran d'un agent bloqué est montré, borné, jamais reformulé", () => {
  test("les lignes vides de tête et de queue ne comptent pas", () => {
    const texte = attenteDeLEcran(ECRAN_REVUE);

    expect(texte).toBeDefined();
    expect(texte?.startsWith("\n")).toBe(false);
    expect(texte?.endsWith("\n")).toBe(false);
  });

  test("l'indentation de tête est GARDÉE — elle porte la structure du TUI", () => {
    // Ces lignes sont sorties de terminal : leur alignement dit quelque chose.
    expect(attenteDeLEcran(ECRAN_REVUE)).toContain("  ┃  Review");
  });

  test("les espaces de fin partent, eux", () => {
    expect(attenteDeLEcran("a   \nb  \n")).toBe("a\nb");
  });

  test("la fenêtre est bornée, et c'est la FIN qui est gardée", () => {
    const long = Array.from({ length: 30 }, (_, i) => `ligne ${String(i + 1)}`).join("\n");
    const texte = attenteDeLEcran(long, 3);

    // L'état courant est en bas : c'est lui qu'on veut voir.
    expect(texte).toBe("ligne 28\nligne 29\nligne 30");
  });

  test("un écran vide ne rend rien, jamais une chaîne trouée", () => {
    expect(attenteDeLEcran("")).toBeUndefined();
    expect(attenteDeLEcran("\n  \n\t\n")).toBeUndefined();
  });
});

describe("seul un agent BLOQUÉ reçoit l'écran", () => {
  test("un agent bloqué : oui", () => {
    expect(attenteDeLigne({ status: "blocked" }, ECRAN_REVUE)).toBeDefined();
  });

  test("un agent muet mais au repos : non", () => {
    /*
      ⚠️ **C'est toute la garde.** `fautLireLEcran` lit aussi l'écran d'un agent
      « muet » (ni aperçu, ni dernière demande). Sans le filtre sur l'état, un
      agent qui n'a **rien écrit** montrerait son panneau de démarrage comme s'il
      attendait une réponse — un mensonge.
    */
    expect(attenteDeLigne({ status: "idle" }, ECRAN_REVUE)).toBeUndefined();
    expect(attenteDeLigne({ status: "unknown" }, ECRAN_REVUE)).toBeUndefined();
    expect(attenteDeLigne({ status: "done" }, ECRAN_REVUE)).toBeUndefined();
    expect(attenteDeLigne({ status: "working" }, ECRAN_REVUE)).toBeUndefined();
  });

  test("un agent bloqué devant un écran vide ne montre rien", () => {
    expect(attenteDeLigne({ status: "blocked" }, "\n \n")).toBeUndefined();
  });
});
