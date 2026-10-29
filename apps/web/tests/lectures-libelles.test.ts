/**
 * Ce que j'ai lu (tenu sur le téléphone) et les mots de l'interface.
 */
import { describe, expect, test } from "bun:test";
import { ecritLectures, estNonLue, litLectures, noteLecture } from "../src/lectures.ts";
import {
  apercuTexte,
  chrono,
  dureeLongue,
  heureDe,
  jetons,
  marqueAgent,
  quand,
  titrePropre,
} from "../src/libelles.ts";
import type { Stockage } from "../src/memoire-defilement.ts";

const stockage = (): Stockage & { readonly valeurs: Map<string, string> } => {
  const valeurs = new Map<string, string>();
  return {
    ecrit: (cle, valeur) => {
      valeurs.set(cle, valeur);
    },
    lit: (cle) => valeurs.get(cle) ?? null,
    valeurs,
  };
};

describe("lectures locales", () => {
  test("jamais ouverte : seul `done` est non lu", () => {
    const vide = new Map<string, number>();
    expect(estNonLue({ paneId: "a", status: "done", timestamp: 5 }, vide)).toBe(true);
    expect(estNonLue({ paneId: "a", status: "idle", timestamp: 5 }, vide)).toBe(false);
  });

  test("ouverte : non lue si l'activité est postérieure à la lecture", () => {
    const lues = noteLecture(new Map(), "a", 100);
    expect(estNonLue({ paneId: "a", status: "done", timestamp: 90 }, lues)).toBe(false);
    expect(estNonLue({ paneId: "a", status: "idle", timestamp: 120 }, lues)).toBe(true);
    expect(estNonLue({ paneId: "a", status: "idle" }, lues)).toBe(false);
  });

  test("lue sur un autre appareil : le point s'éteint ici aussi (H22)", () => {
    const vide = new Map<string, number>();
    // Jamais ouverte ici, mais lue ailleurs après sa dernière activité.
    expect(estNonLue({ paneId: "a", readAt: 100, status: "done", timestamp: 90 }, vide)).toBe(
      false,
    );
    // Lue ailleurs AVANT une nouvelle activité : toujours non lue.
    expect(estNonLue({ paneId: "a", readAt: 100, status: "idle", timestamp: 120 }, vide)).toBe(
      true,
    );
    // La plus récente des deux lectures l'emporte.
    const lues = noteLecture(new Map(), "a", 50);
    expect(estNonLue({ paneId: "a", readAt: 130, status: "idle", timestamp: 120 }, lues)).toBe(
      false,
    );
  });

  test("un agent au travail ou bloqué n'a pas de point non lu (son état parle)", () => {
    expect(estNonLue({ paneId: "a", status: "working", timestamp: 5 }, new Map())).toBe(false);
    expect(estNonLue({ paneId: "a", status: "blocked", timestamp: 5 }, new Map())).toBe(false);
  });

  test("une lecture ne recule jamais", () => {
    const lues = noteLecture(noteLecture(new Map(), "a", 100), "a", 50);
    expect(lues.get("a")).toBe(100);
  });

  test("aller-retour par le stockage, valeurs illisibles ignorées", () => {
    const s = stockage();
    ecritLectures(s, noteLecture(new Map(), "w1:p1", 42));
    expect(litLectures(s).get("w1:p1")).toBe(42);
    s.ecrit("herdr-chat.lectures", "{pas du json");
    expect(litLectures(s).size).toBe(0);
  });
});

describe("libellés", () => {
  test("le préfixe décoratif du titre est retiré, rien d'autre", () => {
    expect(titrePropre("π - herdr-pwa")).toBe("herdr-pwa");
    expect(titrePropre("OC | Pixel function naming")).toBe("Pixel function naming");
    expect(titrePropre("✳ Production readiness")).toBe("Production readiness");
    expect(titrePropre("◑ Migration Rust")).toBe("Migration Rust");
    expect(titrePropre("Migration - phase 2")).toBe("Migration - phase 2");
    expect(titrePropre(null)).toBe("");
  });

  test("monogrammes des agents", () => {
    expect(marqueAgent("claude").lettres).toBe("C");
    expect(marqueAgent("codex").lettres).toBe("Cx");
    expect(marqueAgent("pi").lettres).toBe("π");
    expect(marqueAgent("opencode").lettres).toBe("oc");
    expect(marqueAgent("devin").lettres).toBe("D");
    expect(marqueAgent("aider").nom).toBe("aider");
  });

  test("temps relatif de la liste", () => {
    const maintenant = new Date(2026, 9, 29, 15, 0).getTime();
    expect(quand(maintenant - 20_000, maintenant)).toBe("just now");
    expect(quand(maintenant - 25 * 60_000, maintenant)).toBe("25 min");
    expect(quand(maintenant - 3 * 3_600_000, maintenant)).toBe("3h");
    expect(quand(new Date(2026, 9, 28, 18, 0).getTime(), maintenant)).toBe("yesterday");
    expect(quand(new Date(2026, 9, 26, 9, 0).getTime(), maintenant)).toBe("Mon");
    expect(quand(new Date(2026, 8, 3, 9, 0).getTime(), maintenant)).toBe("Sep 3");
  });

  test("chronomètre, jetons, heure", () => {
    expect(chrono(72_000)).toBe("1:12");
    expect(chrono(245_000)).toBe("4:05");
    expect(chrono(3_723_000)).toBe("1:02:03");
    expect(jetons(18_400)).toBe("18.4k");
    expect(jetons(850)).toBe("850");
    expect(jetons(0)).toBe("");
    expect(heureDe("pas une date")).toBeNull();
    expect(dureeLongue(451_000)).toBe("7 min");
    expect(dureeLongue(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(dureeLongue(52 * 3_600_000)).toBe("2d 4h");
  });
});

describe("aperçu sans syntaxe", () => {
  test("titres, gras, code et puces disparaissent, les mots restent", () => {
    expect(apercuTexte("## Baseline (what **the** code does)")).toBe(
      "Baseline (what the code does)",
    );
    expect(apercuTexte("```ts\n// src/utils/salesforce.ts\nexport const g")).toBe(
      "// src/utils/salesforce.ts export const g",
    );
    expect(apercuTexte("- **Re**lu le `main.rs`")).toBe("Relu le main.rs");
    expect(apercuTexte("voir [la doc](https://x)")).toBe("voir la doc");
  });
});
