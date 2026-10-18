/**
 * Nommage d'un pane — l'étiquette qui distingue des voisins de **même onglet**.
 *
 * ⚠️ **Les fixtures de disposition sont celles d'un vrai onglet à cinq panes**,
 * relevées le 2026-10-16 sur Herdr 0.9.3 (`snapshot.layouts`) : créés
 * `p1 p2 p3 p4 p5`, disposés `p1 p2 / p4 p3 / p5`. C'est ce qui rend le test de
 * l'ordre utile : l'ordre de lecture **diffère** de l'ordre de création, donc un
 * tri par identifiant le ferait échouer.
 *
 * ⚠️ Et c'est un cas d'usage réel, pas une hypothèse : un onglet découpé, un
 * agent par pane, pour orchestrer un principal et ses vérificateurs.
 */
import { describe, expect, test } from "bun:test";
import { dejaDit, etiquetteDePane, rangsDesPanes } from "../src/nommage.ts";

/** La disposition réelle du tab `wF:t1`, mesurée pane par pane. */
const DISPOSITION = [
  { pane_id: "wF:p1", rect: { x: 0, y: 0 } },
  { pane_id: "wF:p4", rect: { x: 0, y: 41 } },
  { pane_id: "wF:p5", rect: { x: 0, y: 62 } },
  { pane_id: "wF:p2", rect: { x: 95, y: 0 } },
  { pane_id: "wF:p3", rect: { x: 95, y: 41 } },
];

describe("le rang suit la disposition, pas l'ordre de création", () => {
  test("de haut en bas, puis de gauche à droite", () => {
    const rangs = rangsDesPanes(DISPOSITION);

    expect([...rangs.entries()].toSorted((a, b) => a[1] - b[1])).toEqual([
      ["wF:p1", 1],
      ["wF:p2", 2],
      ["wF:p4", 3],
      ["wF:p3", 4],
      ["wF:p5", 5],
    ]);
  });

  test("l'ordre n'est PAS celui des identifiants", () => {
    // ⚠️ C'est tout l'intérêt : `p3` est le quatrième rectangle. Trier par
    // identifiant aurait donné un numéro qui ne correspond à aucun pane visible.
    const rangs = rangsDesPanes(DISPOSITION);

    expect(rangs.get("wF:p3")).toBe(4);
    expect(rangs.get("wF:p4")).toBe(3);
  });

  test("les panes d'une même ligne se lisent de gauche à droite", () => {
    // `p1` (x 0) avant `p2` (x 95) : même hauteur, donc l'axe des x décide.
    const rangs = rangsDesPanes(DISPOSITION);

    const gauche = rangs.get("wF:p1") ?? 0;
    const droite = rangs.get("wF:p2") ?? 0;

    expect(gauche).toBeLessThan(droite);
  });

  test("un pane sans rectangle n'a PAS de rang, il n'est pas rangé au hasard", () => {
    /*
      ⚠️ Un snapshot partiel peut livrer un pane sans `rect`. Lui donner un rang
      arbitraire produirait un numéro faux, c'est-à-dire pire que pas de numéro :
      l'étiquette retomberait alors sur un nom, ou sur rien.
    */
    const rangs = rangsDesPanes([{ pane_id: "w1:p1" }, { pane_id: "w1:p2", rect: { x: 0, y: 0 } }]);

    expect(rangs.has("w1:p1")).toBe(false);
    expect(rangs.get("w1:p2")).toBe(1);
  });

  test("une disposition vide ne lève pas", () => {
    expect(rangsDesPanes([]).size).toBe(0);
  });
});

describe("l'étiquette — seulement quand il y a quelque chose à distinguer", () => {
  const base = {
    name: null,
    paneRank: 3,
    tabLabel: "1",
    tabPaneCount: 5,
    workspaceLabel: "multipane",
  };

  test("seul dans son onglet : AUCUNE étiquette", () => {
    /*
      ⚠️ Le cas ordinaire, et de loin : un agent par onglet. Une étiquette qui
      apparaîtrait partout serait du bruit qu'on ne lit plus — la règle vaut
      déjà pour le libellé d'onglet.
    */
    expect(etiquetteDePane({ ...base, tabPaneCount: 1 })).toBeUndefined();
  });

  test("le nom donné par Herdr l'emporte : c'est le seul libellé CHOISI", () => {
    expect(etiquetteDePane({ ...base, name: "multipane-pi" })).toBe("multipane-pi");
  });

  test("un nom qui répète le projet cède la place au rang", () => {
    /*
      ⚠️ Mesuré : `agent.start` reçoit par défaut le libellé du projet, donc un
      agent lancé par l'app s'appelle « pixel » dans le projet « pixel ».
      L'afficher redirait la ligne du dessus — même règle que pour l'onglet.
    */
    expect(etiquetteDePane({ ...base, name: "multipane" })).toBe("pane 3");
  });

  test("un nom qui répète l'onglet cède aussi la place au rang", () => {
    expect(etiquetteDePane({ ...base, name: "1", tabLabel: "1" })).toBe("pane 3");
  });

  test("sans nom, c'est la place dans la disposition", () => {
    expect(etiquetteDePane(base)).toBe("pane 3");
  });

  test("sans nom ET sans rang : rien, plutôt qu'un identifiant", () => {
    // ⚠️ On ne retombe **jamais** sur `pane_id` : `wA:p7` ne dit rien à personne.
    expect(etiquetteDePane({ ...base, paneRank: null })).toBeUndefined();
  });

  test("un nom fait d'espaces compte comme absent", () => {
    expect(etiquetteDePane({ ...base, name: "   " })).toBe("pane 3");
  });

  test("le rang est écrit tel quel, sans zéro de tête", () => {
    expect(etiquetteDePane({ ...base, paneRank: 10 })).toBe("pane 10");
  });
});

describe("dejaDit — la comparaison qui écarte un libellé inutile", () => {
  test("insensible à la casse et aux sous-chaînes", () => {
    expect(dejaDit("π - atcrea", "atcrea")).toBe(true);
    expect(dejaDit("MULTIPANE", "multipane")).toBe(true);
    expect(dejaDit("pixel", "pi")).toBe(true);
  });

  test("écarte seulement quand le libellé est réellement contenu", () => {
    expect(dejaDit("atcrea", "pixel")).toBe(false);
  });
});
