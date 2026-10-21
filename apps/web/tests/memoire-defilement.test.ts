/**
 * Où l'on était dans une conversation, d'une visite à l'autre.
 *
 * ⚠️ **Le défaut rapporté.** Lire une réponse sur l'ordinateur, lancer un
 * prompt, revenir sur la PWA : le fil repartait **en haut**, parce que la règle
 * d'ancrage ne parle que des changements d'état observés pendant qu'on regarde.
 */
import { describe, expect, test } from "bun:test";
import {
  hauteurDeReprise,
  litPosition,
  positionAffichee,
  ecritPosition,
  stockageNavigateur,
  type Stockage,
} from "../src/memoire-defilement.ts";

const stockage = (): Stockage & { contenu: Map<string, string> } => {
  const contenu = new Map<string, string>();
  return {
    contenu,
    ecrit: (cle, valeur) => {
      contenu.set(cle, valeur);
    },
    lit: (cle) => contenu.get(cle) ?? null,
  };
};

describe("ce qu'on retient d'un état de défilement", () => {
  test("collé au bas : on retient « je suivais le bas »", () => {
    expect(
      positionAffichee({
        clientHeight: 700,
        scrollHeight: 2000,
        scrollTop: 1300,
        seuilBas: 48,
      }),
    ).toEqual({ bas: true, ratio: 1 });
  });

  test("au milieu : on retient un ratio", () => {
    const position = positionAffichee({
      clientHeight: 700,
      scrollHeight: 2000,
      scrollTop: 650,
      seuilBas: 48,
    });
    expect(position.bas).toBe(false);
    expect(position.ratio).toBeCloseTo(0.5, 5);
  });

  test("une conversation plus courte que l'écran ne donne pas un ratio négatif", () => {
    // ⚠️ `scrollHeight - clientHeight` vaut alors 0 ou moins : sans borne, le
    // retour sur un fil court scrollait « au-dessus du début ».
    const position = positionAffichee({
      clientHeight: 900,
      scrollHeight: 400,
      scrollTop: 0,
      seuilBas: 48,
    });
    expect(position.ratio).toBeGreaterThanOrEqual(0);
    expect(position.bas).toBe(true);
  });
});

describe("où se poser au retour", () => {
  test("« je suivais le bas » ramène au NOUVEAU bas", () => {
    // Du contenu est arrivé depuis : suivre le bas, c'est suivre le bas.
    expect(
      hauteurDeReprise({ bas: true, ratio: 1 }, { clientHeight: 700, scrollHeight: 3000 }),
    ).toBe(2300);
  });

  test("un ratio est rendu proportionnellement à la hauteur actuelle", () => {
    expect(
      hauteurDeReprise({ bas: false, ratio: 0.5 }, { clientHeight: 700, scrollHeight: 2000 }),
    ).toBe(650);
  });

  test("sans course possible, on ne descend pas sous zéro", () => {
    expect(
      hauteurDeReprise({ bas: false, ratio: 0.8 }, { clientHeight: 900, scrollHeight: 400 }),
    ).toBe(0);
  });
});

describe("le stockage", () => {
  test("on relit ce qu'on a écrit", () => {
    const s = stockage();
    ecritPosition(s, "w1:p1", { bas: false, ratio: 0.25 });
    expect(litPosition(s, "w1:p1")).toEqual({ bas: false, ratio: 0.25 });
  });

  test("une valeur illisible vaut « inconnue », pas une erreur", () => {
    const s = stockage();
    s.ecrit("herdr:defilement:w1:p1", "{pas du json");
    expect(litPosition(s, "w1:p1")).toBeNull();
    s.ecrit("herdr:defilement:w1:p1", JSON.stringify({ bas: "oui", ratio: 2 }));
    expect(litPosition(s, "w1:p1")).toBeNull();
  });

  test("chaque conversation a sa position", () => {
    const s = stockage();
    ecritPosition(s, "w1:p1", { bas: true, ratio: 1 });
    ecritPosition(s, "w1:p2", { bas: false, ratio: 0.1 });
    expect(litPosition(s, "w1:p1")?.bas).toBe(true);
    expect(litPosition(s, "w1:p2")?.ratio).toBeCloseTo(0.1, 5);
    expect(litPosition(s, "w9:p9")).toBeNull();
  });

  test("un stockage indisponible rend un stockage muet, jamais une exception", () => {
    // Safari privé lève à l'écriture : le fil doit continuer de se rendre.
    const muet = stockageNavigateur();
    expect(() => ecritPosition(muet, "w1:p1", { bas: true, ratio: 1 })).not.toThrow();
  });
});
