/**
 * Le fil quand la session **rate** : il ne disparaît plus.
 *
 * ⚠️ **Le défaut rapporté, mot pour mot** : « quand l'agent a un bug ou passe en
 * `blocked`, la session disparaît, donc plus de data, plus de scroll, chat
 * inutilisable ». La cause était une ligne : une page lue **vide** remplaçait le
 * fil (`setEntries([])`), parce que l'écran traitait toute lecture comme une
 * nouvelle vérité.
 *
 * ⚠️ **Ce que ces tests fixent.** Une lecture qui n'apporte rien ne détruit
 * jamais ce qui est affiché ; une lecture qui apporte remplace ou ajoute ; un
 * `reset` **vide** n'efface pas (c'est le symptôme d'une lecture impossible, pas
 * la preuve d'une session vide) ; une erreur de transport laisse le fil en place.
 */
import { describe, expect, test } from "bun:test";
import {
  decideAffichage,
  gardeLeFilMalgréErreur,
  mentionLecturePartielle,
} from "../src/session-vue.ts";

const page = (
  entries: readonly string[],
  options: { incremental?: boolean; reset?: boolean; cause?: string } = {},
): {
  entries: readonly string[];
  incremental: boolean;
  reset: boolean;
  cause?: string;
} => ({
  cause: options.cause,
  entries,
  incremental: options.incremental ?? false,
  reset: options.reset ?? false,
});

describe("une lecture vide ne détruit pas le fil", () => {
  test("session absente alors qu'on affiche des messages : on garde", () => {
    // Le cas rapporté : l'agent passe en `blocked`, le serveur répond
    // `cause: "absente"`, `entries: []`. Avant : fil vidé, écran mort.
    const decision = decideAffichage({
      affiches: 12,
      page: page([], { cause: "absente" }),
    });
    expect(decision.genre).toBe("garde");
  });

  test("reset SANS entrées : on garde ET on prévient", () => {
    // ⚠️ Un reset vide n'est pas la preuve que la session est vide : c'est le
    // symptôme d'une lecture impossible. L'effacer reproduisait le défaut.
    const decision = decideAffichage({
      affiches: 12,
      page: page([], { cause: "invalide", reset: true }),
    });
    expect(decision.genre).toBe("garde-et-previens");
    if (decision.genre !== "garde-et-previens") return;
    expect(decision.raison).toContain("invalide");
  });

  test("reset AVEC entrées : on remplace, la session a vraiment changé", () => {
    const decision = decideAffichage({
      affiches: 12,
      page: page(["a", "b"], { reset: true }),
    });
    expect(decision).toEqual({ entries: ["a", "b"], genre: "remplace" });
  });
});

describe("une lecture qui apporte est appliquée", () => {
  test("incrémental avec des entrées : on ajoute", () => {
    const decision = decideAffichage({
      affiches: 12,
      page: page(["c"], { incremental: true }),
    });
    expect(decision).toEqual({ entries: ["c"], genre: "ajoute" });
  });

  test("première page non vide : on remplace", () => {
    const decision = decideAffichage({ affiches: 0, page: page(["a", "b"]) });
    expect(decision).toEqual({ entries: ["a", "b"], genre: "remplace" });
  });

  test("première lecture vide : on remplace aussi (il n'y a rien à perdre)", () => {
    // Un agent neuf : aucun message affiché, la page vide est la vérité du
    // moment. C'est le seul cas où un vide s'applique.
    const decision = decideAffichage({
      affiches: 0,
      page: page([], { cause: "vide" }),
    });
    expect(decision.genre).toBe("remplace");
  });

  test("une lecture vide SANS reset ne prévient pas", () => {
    // Un agent qui n'écrit plus n'est pas une panne : pas de bandeau à chaque
    // poll, sinon l'écran clignote d'avertissements.
    expect(decideAffichage({ affiches: 5, page: page([]) }).genre).toBe("garde");
  });
});

describe("une erreur de transport ne fait pas perdre la conversation", () => {
  test("avec des messages affichés, le fil reste", () => {
    // ⚠️ Un 502 passager dit « pas lu maintenant », pas « il n'y a rien ».
    expect(gardeLeFilMalgréErreur(8)).toBe(true);
    expect(gardeLeFilMalgréErreur(1)).toBe(true);
  });

  test("sans rien à afficher, l'écran peut montrer l'erreur", () => {
    expect(gardeLeFilMalgréErreur(0)).toBe(false);
  });

  test("la mention dit la cause réelle, sans la masquer", () => {
    const mention = mentionLecturePartielle("transport: 502");
    expect(mention).toContain("transport: 502");
    expect(mention).toContain("Derniers messages connus");
  });
});
