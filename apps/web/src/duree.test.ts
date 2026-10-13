/**
 * Durée relative — la ligne de conversation (U16).
 *
 * Ces bornes sont un choix d'affichage : « il y a 40 s » n'apporte rien au
 * doigt et ferait clignoter la liste à chaque rafraîchissement.
 */
import { describe, expect, test } from "bun:test";
import { dureeDepuis, dureeRelative } from "./duree.ts";

const a = (secondes: number): number => secondes * 1000;

describe("U16 — l'âge d'une conversation", () => {
  test("moins d'une minute : à l'instant", () => {
    expect(dureeRelative(a(0))).toBe("just now");
    expect(dureeRelative(a(59))).toBe("just now");
  });

  test("les minutes, au singulier et au pluriel", () => {
    expect(dureeRelative(a(60))).toBe("1 min ago");
    // ⚠️ Plancher : 1 min 59 ne doit pas s'afficher « 2 min ». Un âge arrondi
    // vers le haut exagère ce que l'utilisateur compare avec son souvenir.
    expect(dureeRelative(a(119))).toBe("1 min ago");
    expect(dureeRelative(a(120))).toBe("2 min ago");
  });

  test("les heures", () => {
    // 59 min 59 reste en minutes : arrondir donnerait « 1 h » une minute trop
    // tôt, et « 1 h » pendant presque une heure entière est un âge arrondi.
    expect(dureeRelative(a(3599))).toBe("59 min ago");
    expect(dureeRelative(a(3600))).toBe("1 hr ago");
    expect(dureeRelative(a(7200))).toBe("2 hr ago");
  });

  test("les jours", () => {
    // 23 h reste en heures : « 1 j » serait arrondi, donc faux.
    expect(dureeRelative(a(23 * 3600))).toBe("23 hr ago");
    expect(dureeRelative(a(24 * 3600))).toBe("1 day ago");
    expect(dureeRelative(a(72 * 3600))).toBe("3 days ago");
  });

  test("un horodatage dans le futur ne donne pas une durée négative", () => {
    // Deux horloges peuvent différer de quelques ms. « il y a -3 s » serait
    // visible à l'écran.
    expect(dureeRelative(a(-5))).toBe("just now");
  });
});

describe("U16 — sans instant, on n'invente rien", () => {
  test("`null` ne devient pas « à l'instant »", () => {
    // ⚠️ « à l'instant » serait la donnée que l'utilisateur vient chercher, et
    // la donner fausse est pire que de ne rien afficher.
    expect(dureeDepuis(null, 1_000)).toBeNull();
  });

  test("un instant mesuré donne bien une durée", () => {
    expect(dureeDepuis(0, a(120))).toBe("2 min ago");
  });
});
