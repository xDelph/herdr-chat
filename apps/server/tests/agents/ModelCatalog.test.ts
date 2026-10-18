import { describe, expect, test } from "bun:test";
import { modelsDeDevin } from "../../src/agents/ModelCatalog.ts";

/**
 * Le catalogue devin — lu sur la **forme réelle** du CLI.
 *
 * ⚠️ La fixture est recopiée de `devin models list --format json` (3000.11.92,
 * 2026-10-16), réduite à deux familles. Elle porte ce qui compte : les modèles
 * sont les **variants**, pas les familles.
 */
const CATALOGUE_DEVIN = {
  families: [
    {
      aliases: [],
      family_label: "Adaptive",
      family_uid: "Adaptive",
      slug: "adaptive",
      variants: [
        {
          cost_summary: "$0.5 / 1M Input",
          description: "Automatically balances quality and cost",
          is_beta: false,
          is_new: false,
          label: "Adaptive",
          model_uid: "adaptive",
        },
      ],
    },
    {
      aliases: ["swe"],
      family_label: "SWE-2",
      family_uid: "swe-2",
      slug: "swe-2",
      variants: [
        { label: "SWE-2 High", model_uid: "swe-2-high" },
        { label: "SWE-2 Medium", model_uid: "swe-2-medium" },
        { label: "SWE-2 Max", model_uid: "swe-2-max" },
      ],
    },
  ],
};

describe("devin — le modèle est le variant, pas la famille", () => {
  test("tous les variants sont proposés", () => {
    expect(modelsDeDevin(CATALOGUE_DEVIN).map((m) => m.id)).toEqual([
      "adaptive",
      "swe-2-high",
      "swe-2-medium",
      "swe-2-max",
    ]);
  });

  test("le libellé accompagne le modèle", () => {
    expect(modelsDeDevin(CATALOGUE_DEVIN)[1]?.label).toBe("SWE-2 High");
  });

  test("le `slug` de famille n'est JAMAIS proposé comme modèle", () => {
    // ⚠️ `--model swe-1.6-slow` n'existe pas : le CLI attend `swe-1-6-slow`.
    // Proposer la famille enverrait un nom refusé.
    expect(modelsDeDevin(CATALOGUE_DEVIN).map((m) => m.id)).not.toContain("swe-2");
  });

  test("aucun niveau séparé : il est dans le nom", () => {
    for (const modele of modelsDeDevin(CATALOGUE_DEVIN)) {
      expect(modele.thinkingLevels).toEqual([]);
    }
  });
});

describe("devin — un catalogue illisible se refuse, il ne se devine pas", () => {
  test("une forme inattendue ne produit rien", () => {
    expect(modelsDeDevin(null)).toEqual([]);
    expect(modelsDeDevin("texte")).toEqual([]);
    expect(modelsDeDevin({})).toEqual([]);
    expect(modelsDeDevin({ families: "pas un tableau" })).toEqual([]);
  });

  test("un variant sans identifiant est écarté, les autres survivent", () => {
    const models = modelsDeDevin({
      families: [{ variants: [{ label: "sans id" }, { model_uid: "bon" }] }],
    });

    expect(models.map((m) => m.id)).toEqual(["bon"]);
  });

  test("une famille sans variants est ignorée", () => {
    expect(modelsDeDevin({ families: [{ slug: "vide" }, { variants: [] }] })).toEqual([]);
  });
});
