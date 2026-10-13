/**
 * Contrat de la feuille de lancement (U06).
 *
 * Les deux clauses du tableau sontici, exécutables :
 *
 * - « filtrer ≠ sélectionner » — un filtre qui n'affecte que la liste visible ;
 * - « choix incompatible bloque l'envoi » — le refus est motivé, jamais muet.
 *
 * ⚠️ Ces tests portent sur du **code**, pas sur des intentions. Le défaut qu'ils
 * couvrent était invisible : taper dans le champ de recherche sélectionnait le
 * modèle tapé, et l'agent le refusait au démarrage.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelCatalog } from "./api.ts";
import {
  filtreUtile,
  MAX_MODELES_AFFICHES,
  modelesVisibles,
  SEUIL_FILTRE,
  verifierLancement,
} from "./launch.ts";

const modele = (id: string, thinkingLevels: string[] = [], label?: string) => ({
  ...(label === undefined ? {} : { label }),
  id,
  thinkingLevels,
});

const catalogue = (
  kind: string,
  models: ReadonlyArray<ReturnType<typeof modele>>,
  thinkingLevels: string[] = [],
): ModelCatalog => ({ error: null, kind, models: [...models], source: "essai", thinkingLevels });

const deuxModeles = () =>
  catalogue("pi", [
    modele("gpt-5", ["low", "high"], "GPT 5"),
    modele("claude-sonnet", ["medium"], "Claude Sonnet"),
  ]);

const ids = (modeles: ReadonlyArray<{ id: string }>): string[] => modeles.map((m) => m.id);

describe("U06 — filtrer ne sélectionne pas", () => {
  test("le filtre réduit la liste, rien d'autre", () => {
    const visible = modelesVisibles(deuxModeles(), "gpt");
    expect(ids(visible)).toEqual(["gpt-5"]);
  });

  test("le filtre porte sur le libellé autant que sur l'identifiant", () => {
    // La liste affiche « libellé · identifiant » : chercher sur l'un seul
    // rendrait invisibles des modèles pourtant à l'écran.
    expect(ids(modelesVisibles(deuxModeles(), "sonnet"))).toEqual(["claude-sonnet"]);
  });

  test("insensible à la casse et aux espaces de bord", () => {
    expect(ids(modelesVisibles(deuxModeles(), "  GPT "))).toEqual(["gpt-5"]);
  });

  test("un filtre vide rend tout : effacer le champ ne désélectionne pas", () => {
    expect(ids(modelesVisibles(deuxModeles(), "   "))).toEqual(["gpt-5", "claude-sonnet"]);
  });

  test("un filtre sans correspondance rend une liste vide, pas une erreur", () => {
    expect(modelesVisibles(deuxModeles(), "zzz")).toEqual([]);
  });

  test("le seuil de filtre est mesuré, pas deviné", () => {
    const petit = catalogue("pi", [modele("a")]);
    const grand = catalogue(
      "pi",
      Array.from({ length: 200 }, (_, i) => modele(`m${String(i)}`)),
    );
    expect(filtreUtile(petit)).toBe(false);
    expect(filtreUtile(grand)).toBe(true);
    expect(grand.models.length).toBeGreaterThan(SEUIL_FILTRE);
  });
});

describe("U06 — l'envoi est bloqué, et la cause est dite", () => {
  test("rien choisi : l'agent part avec ses propres valeurs", () => {
    // Un choix, pas une absence de vérification : c'est le chemin le plus
    // fréquent et il doit rester ouvert, même sans catalogue.
    const verdict = verifierLancement({ catalog: null, kind: "pi", model: "", thinking: "" });
    expect(verdict.envoyable).toBe(true);
    if (verdict.envoyable) expect(verdict.choix).toEqual({});
  });

  test("modèle connu, sans niveau : envoyé", () => {
    const verdict = verifierLancement({
      catalog: deuxModeles(),
      kind: "pi",
      model: "gpt-5",
      thinking: "",
    });
    expect(verdict.envoyable).toBe(true);
    if (verdict.envoyable) expect(verdict.choix).toEqual({ model: "gpt-5" });
  });

  test("modèle et niveau connus : envoyé, sans propriété vide", () => {
    const verdict = verifierLancement({
      catalog: deuxModeles(),
      kind: "pi",
      model: "gpt-5",
      thinking: "high",
    });
    expect(verdict.envoyable).toBe(true);
    // ⚠️ Pas de `thinking: ""` : une chaîne vide a un autre sens que « non
    // choisi », et le serveur la lirait comme un niveau demandé.
    if (verdict.envoyable) expect(verdict.choix).toEqual({ model: "gpt-5", thinking: "high" });
  });

  test("niveau refusé pour ce modèle : bloqué, et le niveau correct est nommé", () => {
    const verdict = verifierLancement({
      catalog: deuxModeles(),
      kind: "pi",
      model: "gpt-5",
      thinking: "medium",
    });
    expect(verdict.envoyable).toBe(false);
    if (!verdict.envoyable) expect(verdict.raison).toContain("low, high");
  });

  test("niveau sans modèle : bloqué, on ne devine pas ce qu'il accepte", () => {
    const verdict = verifierLancement({
      catalog: deuxModeles(),
      kind: "pi",
      model: "",
      thinking: "high",
    });
    expect(verdict.envoyable).toBe(false);
    if (!verdict.envoyable) expect(verdict.raison).toContain("requires a model");
  });

  test("modèle absent du catalogue : bloqué, et le motif est vérifiable", () => {
    const verdict = verifierLancement({
      catalog: deuxModeles(),
      kind: "pi",
      model: "gpt",
      thinking: "",
    });
    expect(verdict.envoyable).toBe(false);
    // C'est exactement le symptôme du filtre mal utilisé comme sélection.
    if (!verdict.envoyable) expect(verdict.raison).toContain("2 modèles vérifiés");
  });

  test("catalogue illisible : bloqué plutôt que d'envoyer un identifiant inventé", () => {
    const verdict = verifierLancement({
      catalog: null,
      kind: "codex",
      model: "gpt-5",
      thinking: "",
    });
    expect(verdict.envoyable).toBe(false);
    if (!verdict.envoyable) expect(verdict.raison).toContain("codex");
  });

  test("catalogue vide : le refus distingue « aucun » de « inconnu »", () => {
    const verdict = verifierLancement({
      catalog: catalogue("codex", []),
      kind: "codex",
      model: "gpt-5",
      thinking: "",
    });
    expect(verdict.envoyable).toBe(false);
    if (!verdict.envoyable) expect(verdict.raison).toContain("aucun modèle vérifié");
  });

  test("modèle sans aucun niveau déclaré : le refus le dit", () => {
    const verdict = verifierLancement({
      catalog: catalogue("pi", [modele("muet")]),
      kind: "pi",
      model: "muet",
      thinking: "high",
    });
    expect(verdict.envoyable).toBe(false);
    if (!verdict.envoyable) expect(verdict.raison).toContain("aucun niveau");
  });
});

describe("U06 — la liste affichée reste utilisable", () => {
  test("la liste est plafonnée, sinon le navigateur rampe", () => {
    const grand = catalogue(
      "pi",
      Array.from({ length: 500 }, (_, i) => modele(`m${String(i)}`)),
    );
    // Le plafond porte sur l'affichage, jamais sur la vérification : un modèle
    // hors de la fenêtre doit rester sélectionnable par son identifiant.
    expect(grand.models.length).toBeGreaterThan(MAX_MODELES_AFFICHES);
    const verdict = verifierLancement({ catalog: grand, kind: "pi", model: "m499", thinking: "" });
    expect(verdict.envoyable).toBe(true);
  });
});

/**
 * Le câblage de la feuille, vérifié sur sa source.
 *
 * ⚠️ Un test de la fonction ne suffit pas : le défaut ne vivait pas dans
 * `modelesVisibles`, il vivait dans le `<input>` de la feuille, qui écrivait
 * dans l'état du modèle. Ces deux tests lisent le composant et ferment cette
 * porte-là — c'est elle qui se rouvre au premier refour.
 */
describe("U06 — la feuille ne rejoue pas le défaut", () => {
  const feuille = readFileSync(join(import.meta.dir, "LaunchSheet.tsx"), "utf8");

  test("le champ de filtre écrit dans le filtre, jamais dans le modèle", () => {
    const champ = feuille.slice(feuille.indexOf('id="launch-filtre"'));
    const fin = champ.indexOf("/>");
    const gestionnaire = champ.slice(0, fin < 0 ? undefined : fin);
    expect(gestionnaire).toContain("setFiltre(event.currentTarget.value)");
    expect(gestionnaire).not.toContain("setModel(");
  });

  test("la liste déroulante reçoit la liste filtrée", () => {
    // Le composant doit passer par `modelesVisibles`, pas re-filtrer lui-même :
    // deux filtres, c'est deux règles, et elles divergent.
    expect(feuille).toContain("modelesVisibles(catalog, filtre)");
  });

  test("le verdict décide du bouton, pas la seule présence des choix", () => {
    const bouton = feuille.slice(feuille.lastIndexOf("<button"));
    expect(bouton).toContain("disabled={!verdict.envoyable || launching");
  });

  test("changer de type remet modèle et niveau à zéro", () => {
    const gestionnaire = feuille.slice(feuille.indexOf("const onKind = useCallback"));
    const fin = gestionnaire.indexOf("[]);");
    for (const attendu of ['setFiltre("")', 'setModel("")', 'setThinking("")']) {
      expect(gestionnaire.slice(0, fin)).toContain(attendu);
    }
  });

  test("aucune feuille ne subsiste hors de la feuille de lancement", () => {
    // Deux endroits pour les mêmes choix, c'est le contrat qui diverge : le
    // second finit toujours par ne plus être à jour.
    for (const fichier of ["App.tsx", "ProjectDetail.tsx"]) {
      const texte = readFileSync(join(import.meta.dir, fichier), "utf8");
      expect(texte).not.toContain("modelesVisibles");
      expect(texte).not.toContain("fetchModelCatalog");
    }
  });
});
