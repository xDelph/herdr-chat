/**
 * En-tête de conversation — la marque de l'agent, et la troisième ligne.
 *
 * Deux choses distinctes y sont verrouillées :
 *
 * 1. **Le modèle et le raisonnement en vigueur** (`headerReglages`) : ce que la
 *    troisième ligne écrit, y compris quand la session n'a rien déclaré ;
 * 2. **La marque** (`AgentBadge`) : un signe par famille, et un repli neutre —
 *    jamais le signe d'un autre agent, qui ferait croire à un type non vérifié.
 *
 * ⚠️ Le rendu est vérifié, pas seulement la fonction : c'est le SVG qui part à
 * l'écran, et une marque qui ne serait pas rendue ne servirait à rien.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentBadge, classeDeMarque } from "../src/AgentBadge.tsx";
import { headerReglages } from "../src/labels.tsx";

const rendu = (kind: string | null): string =>
  renderToStaticMarkup(createElement(AgentBadge, { kind }));

describe("headerReglages — ce que dit la troisième ligne", () => {
  test("modèle et raisonnement, dans cet ordre", () => {
    expect(headerReglages("claude-sonnet-4-5", "high")).toBe("claude-sonnet-4-5 · high");
  });

  test("le modèle seul est écrit seul — on n'invente pas un niveau", () => {
    expect(headerReglages("space-bunny-free", undefined)).toBe("space-bunny-free");
  });

  test("le raisonnement seul est écrit seul", () => {
    expect(headerReglages(undefined, "max")).toBe("max");
  });

  test("sans rien de déclaré, l'ABSENCE est nommée", () => {
    /*
      ⚠️ Ce n'est pas un détail de style. La session ne déclare ces valeurs qu'au
      moment où elles **changent** : un agent qui n'y a jamais touché n'en déclare
      aucune. Une ligne vide disparaîtrait, et l'en-tête changerait de hauteur
      d'une conversation à l'autre. Un modèle « par défaut » serait une invention.
    */
    expect(headerReglages(undefined, undefined)).toBe("model not declared");
  });

  test("une valeur faite d'espaces compte comme absente", () => {
    // Une chaîne vide affichée telle quelle donnerait «  ·  », qui se lit comme
    // un défaut de rendu et non comme une information manquante.
    expect(headerReglages("   ", "  ")).toBe("model not declared");
    expect(headerReglages("  ", "high")).toBe("high");
  });
});

describe("AgentBadge — un signe par famille", () => {
  test("chaque agent connu reçoit un signe, et il est rendu", () => {
    for (const kind of ["pi", "codex", "opencode", "devin", "claude"]) {
      const html = rendu(kind);
      expect(`${kind} → ${String(html.includes("<svg"))}`).toBe(`${kind} → true`);
    }
  });

  test("les signes sont DISTINCTS d'une famille à l'autre", () => {
    /*
      ⚠️ Un test qui vérifierait seulement « il y a un SVG » passerait avec cinq
      fois le même dessin. Ce qu'on veut savoir, c'est qu'on peut les distinguer :
      on compare donc les tracés eux-mêmes.
    */
    const traces = ["pi", "codex", "opencode", "devin", "claude"].map(
      (kind) => /<svg[^>]*>(.*)<\/svg>/.exec(rendu(kind))?.[1] ?? "",
    );

    expect(new Set(traces).size).toBe(traces.length);
  });

  test("un type inconnu reçoit un signe NEUTRE, jamais celui d'un voisin", () => {
    // Emprunter la marque d'un autre ferait croire à un type qu'on n'a pas
    // mesuré : exactement ce que le produit refuse partout ailleurs.
    const neutre = /<svg[^>]*>(.*)<\/svg>/.exec(rendu("pasunagent"))?.[1] ?? "";
    const pi = /<svg[^>]*>(.*)<\/svg>/.exec(rendu("pi"))?.[1] ?? "";

    expect(neutre).not.toBe(pi);
    expect(neutre).toContain("<circle");
  });

  test("un agent sans type ne lève pas non plus", () => {
    expect(rendu(null)).toContain("<svg");
  });

  test("la marque porte le type, et se dit DÉCORATIVE", () => {
    // ⚠️ `aria-hidden` : le type est écrit en toutes lettres sur la ligne juste
    // en dessous. Une marque annoncée ferait dire deux fois la même chose.
    expect(rendu("claude")).toContain('aria-hidden="true"');
    expect(classeDeMarque("claude")).toBe("agent-badge agent-badge--claude");
    expect(classeDeMarque(null)).toBe("agent-badge agent-badge--inconnu");
  });
});
