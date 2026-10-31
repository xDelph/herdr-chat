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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("une liste peut contenir des blocs", () => {
  test("une sous-liste est rendue en liste, pas en texte brut", () => {
    const html = rendre("1. **Sauvegardes**\n   - Rapatrier\n   - Basculer\n2. Fin\n");
    expect((html.match(/<ul/g) ?? []).length).toBe(1);
    expect(html).toContain("<li>Rapatrier</li>");
    expect(html).not.toContain("- Basculer");
  });
});

/** Les déclarations d'une règle CSS de `styles/base.css`, par sélecteur exact. */
const regle = (selecteur: string): string => {
  const feuille = readFileSync(join(import.meta.dir, "..", "src", "styles", "base.css"), "utf8");
  const debut = feuille.search(new RegExp(`(^|\\n)${selecteur.replaceAll(".", "\\.")}[,\\s{]`));
  expect(debut).toBeGreaterThanOrEqual(0);
  const ouvrante = feuille.indexOf("{", debut);
  return feuille.slice(ouvrante + 1, feuille.indexOf("}", ouvrante));
};

describe("un bloc de code n'élargit jamais le fil", () => {
  // ⚠️ Retour du 2026-10-31 : une commande longue dans une liste numérotée
  // élargissait tout le fil — mesuré dans WebKit et Chromium, 1285 px de
  // contenu pour un écran de 390. Le défilement interne du `<pre>` ne suffit
  // pas : dans un élément de liste, sa largeur minimale est sa plus longue
  // ligne. Le code revient donc à la ligne.
  test("le bloc revient à la ligne et coupe les jetons sans espace", () => {
    const declarations = regle(".md-pre");
    expect(declarations).toContain("white-space: pre-wrap;");
    expect(declarations).toContain("overflow-wrap: anywhere;");
    expect(declarations).not.toMatch(/white-space:\s*pre;/);
  });

  test("le bloc de code d'une liste garde sa commande entière", () => {
    const commande =
      "herdr-chat --listen 127.0.0.1:8791 --log-file ~/Library/Logs/herdr-chat/daemon.log";
    const html = rendre(`1. Lance :\n\n   \`\`\`bash\n   ${commande}\n   \`\`\`\n`);
    expect(html).toContain('<pre class="md-pre">');
    expect(html).toContain(commande);
  });
});
