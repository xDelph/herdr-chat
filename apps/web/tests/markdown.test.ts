/**
 * Le rendu Markdown, dont les **tableaux**.
 *
 * ⚠️ **Pourquoi ce fichier existe.** Un agent codex a lui-même relevé le défaut
 * dans un audit : « Markdown tables render empty ». Il avait raison, et la cause
 * n'était pas le texte : `marked` décrit une cellule de tableau par
 * `{ text, tokens, header, align }` — **sans `type`**. Le filtre de jetons, qui
 * écarte tout ce qui n'a pas de `type`, écartait donc *toutes* les cellules. Le
 * tableau se rendait en cadre vide.
 *
 * ⚠️ **Le contrôle compte autant que le cas.** Un test qui vérifierait seulement
 * « un tableau est rendu » passerait sur le bug : le `<table>` était bien là, il
 * était vide. On vérifie donc le **contenu des cellules**.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/Markdown.tsx";

const rendre = (source: string): string =>
  renderToStaticMarkup(createElement(Markdown, { source }));

/** Le tableau de la réponse finale de l'agent codex, verbatim. */
const TABLEAU_CODEX = `| Priority | Finding |
|---|---|
| Critical | Switching conversations preserves pending message state. |
| High | Partial JSONL writes **corrupt** incremental summaries. |
`;

describe("un tableau markdown n'est pas vide", () => {
  test("l'en-tête porte le vrai texte", () => {
    const html = rendre(TABLEAU_CODEX);

    expect(html).toContain("<table");
    expect(html).toContain("Priority");
    expect(html).toContain("Finding");
  });

  test("les cellules portent le vrai texte", () => {
    const html = rendre(TABLEAU_CODEX);

    expect(html).toContain("Critical");
    expect(html).toContain("Switching conversations preserves pending message state.");
    expect(html).toContain("Partial JSONL writes");
  });

  test("le gras DANS une cellule est rendu, pas imprimé", () => {
    // Le contenu d'une cellule est du markdown en ligne : `**corrupt**` doit être
    // un `<strong>`, pas la chaîne « **corrupt** ».
    const html = rendre(TABLEAU_CODEX);

    expect(html).toContain("<strong>corrupt</strong>");
    expect(html).not.toContain("**corrupt**");
  });

  test("le tableau a le bon nombre de lignes et de colonnes", () => {
    const html = rendre(TABLEAU_CODEX);

    // 2 colonnes d'en-tête, 2 lignes de 2 cellules.
    expect((html.match(/<th>/g) ?? []).length).toBe(2);
    expect((html.match(/<tr>/g) ?? []).length).toBe(3);
  });
});

describe("le rendu tient sur les autres formes", () => {
  test("un texte simple n'est pas cassé", () => {
    expect(rendre("bonjour")).toContain("<p");
    expect(rendre("bonjour")).toContain("bonjour");
  });

  test("un tableau à une seule colonne fonctionne aussi", () => {
    const html = rendre("| x |\n|---|\n| 1 |\n");

    expect(html).toContain(">x<");
    expect(html).toContain(">1<");
  });

  test("des listes et des blocs de code restent rendus", () => {
    const html = rendre("- un\n- deux\n\n```ts\nconst a = 1;\n```\n");

    expect(html).toContain("<li");
    expect(html).toContain("const a = 1;");
  });
});
