/**
 * Où l'on était dans une conversation, pour la durée de l'onglet.
 *
 * ⚠️ **Deux défauts.** Le fil repartait en haut (aucune mémoire) ; puis il
 * rouvrait au milieu de nulle part des jours après (un ratio gardé pour
 * toujours dans `localStorage`, appliqué à un fil qui avait grandi).
 */
import { describe, expect, test } from "bun:test";
import {
  ecritPosition,
  litPosition,
  premierVisible,
  purgeAnciennesPositions,
  repriseDe,
  stockageNavigateur,
  stockageSession,
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

describe("la reprise suit le MESSAGE, et oublie quand du neuf est arrivé", () => {
  const memoire = { ancre: "m:u3", bas: false, decalage: -40, dernier: "m:a9" };

  test("même fil : on reprend sur le message retenu, avec son décalage", () => {
    expect(repriseDe(memoire, "m:a9")).toEqual({ ancre: "m:u3", decalage: -40, genre: "ancre" });
  });

  test("du neuf depuis : la mémoire est oubliée, le défaut s'applique", () => {
    expect(repriseDe(memoire, "m:a10")).toEqual({ genre: "defaut" });
  });

  test("je suivais le bas : je reste en bas", () => {
    expect(repriseDe({ ...memoire, bas: true }, "m:a9")).toEqual({ genre: "bas" });
  });

  test("rien de retenu : le défaut", () => {
    expect(repriseDe(null, "m:a9")).toEqual({ genre: "defaut" });
  });
});

describe("le premier élément visible", () => {
  test("celui dont le bas dépasse le haut du fil, avec son décalage", () => {
    const elements = [
      { bas: 100, cle: "m:u1", haut: 0 },
      { bas: 400, cle: "m:a1", haut: 100 },
      { bas: 600, cle: "m:u2", haut: 400 },
    ];
    expect(premierVisible(elements, 250)).toEqual({ cle: "m:a1", decalage: -150 });
    expect(premierVisible(elements, 700)).toBeNull();
  });
});

describe("le stockage", () => {
  test("écrire puis lire rend la même position", () => {
    const s = stockage();
    const position = { ancre: "m:u3", bas: false, decalage: -12, dernier: "m:a9" };
    ecritPosition(s, "w1:p1", position);
    expect(litPosition(s, "w1:p1")).toEqual(position);
  });

  test("une valeur de l'ancienne forme (ratio) ou illisible vaut « inconnue »", () => {
    const s = stockage();
    s.ecrit("herdr:defilement:w1:p1", JSON.stringify({ bas: false, ratio: 0.4 }));
    expect(litPosition(s, "w1:p1")).toBeNull();
    s.ecrit("herdr:defilement:w1:p1", "{");
    expect(litPosition(s, "w1:p1")).toBeNull();
  });

  test("sans stockage de plateforme, rien ne lève", () => {
    expect(() => stockageNavigateur().lit("x")).not.toThrow();
    expect(() => stockageSession().ecrit("x", "y")).not.toThrow();
  });

  test("les anciennes positions par ratio sont purgées de localStorage", () => {
    const contenu = new Map<string, string>([
      ["herdr:defilement:w1:p1", "{}"],
      ["herdr-chat.theme", "auto"],
    ]);
    const faux = {
      key: (index: number) => [...contenu.keys()][index] ?? null,
      get length() {
        return contenu.size;
      },
      removeItem: (cle: string) => {
        contenu.delete(cle);
      },
    };
    purgeAnciennesPositions(faux);
    expect([...contenu.keys()]).toEqual(["herdr-chat.theme"]);
  });
});
