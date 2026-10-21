/**
 * T071 — les règles de défilement du fil.
 *
 * ⚠️ **Ce que ces tests empêchent de revenir.** Trois défauts ont été vus à
 * l'usage et aucun n'avait de test, parce que la logique vivait dans le DOM :
 *
 * 1. **La vue sautait** quand on chargeait l'historique : ajouter des messages
 *    au-dessus augmente `scrollHeight` sans toucher `scrollTop`, donc ce qu'on
 *    lisait se retrouve plus bas de toute la hauteur ajoutée.
 * 2. **L'historique ne se chargeait qu'au bouton**, jamais au défilement — sur
 *    une session codex, la demande courante peut être dix pages en arrière.
 * 3. **L'ancrage était faux dans un cas** : arriver sur un agent `done` (réponse
 *    pas vue) doit montrer la **demande**, pas le bas ; un agent `idle` n'a rien
 *    de neuf et se lit par le bas.
 */
import { describe, expect, test } from "bun:test";
import {
  PIXELS_BAS,
  SEUIL_PREMIERES_LIGNES_PX,
  ancrage,
  doitChargerPlusTot,
  positionApresPrepend,
  suitLeBas,
} from "../src/defilement.ts";

describe("suivre le bas", () => {
  test("collé au bas, on suit", () => {
    expect(suitLeBas({ clientHeight: 500, scrollHeight: 1200, scrollTop: 700 })).toBe(true);
  });

  test("la tolérance est de 48 px, pas un pixel", () => {
    // Un doigt ne vise pas le pixel, et un clavier qui monte décale de quelques
    // pixels : sans tolérance, on « décroche » du bas sans l'avoir voulu.
    expect(
      suitLeBas({
        clientHeight: 500,
        scrollHeight: 1200,
        scrollTop: 700 - PIXELS_BAS + 1,
      }),
    ).toBe(true);
    expect(
      suitLeBas({
        clientHeight: 500,
        scrollHeight: 1200,
        scrollTop: 700 - PIXELS_BAS - 1,
      }),
    ).toBe(false);
  });

  test("en pleine lecture, on ne suit pas", () => {
    expect(suitLeBas({ clientHeight: 500, scrollHeight: 1200, scrollTop: 100 })).toBe(false);
  });
});

describe("où se poser quand le statut change", () => {
  test("une réponse pas vue montre la demande", () => {
    // L'agent finissait de travailler et s'arrête : la réponse est neuve.
    expect(ancrage({ apres: "done", avant: "working", suivaitLeBas: true })).toBe("demande");
  });

  test("arriver sur un agent déjà « done » montre la demande", () => {
    // On ouvre la conversation : la réponse est là, mais on ne l'a pas vue.
    expect(ancrage({ apres: "done", avant: null, suivaitLeBas: true })).toBe("demande");
  });

  test("arriver sur un agent « idle » va au bas", () => {
    // Rien de neuf : la convention de toutes les messageries.
    expect(ancrage({ apres: "idle", avant: null, suivaitLeBas: true })).toBe("bas");
  });

  test("quelqu'un qui lisait plus haut n'est jamais tiré de sa lecture", () => {
    expect(ancrage({ apres: "done", avant: "working", suivaitLeBas: false })).toBe("aucun");
    expect(ancrage({ apres: "done", avant: null, suivaitLeBas: false })).toBe("aucun");
  });

  test("un agent qui pose une question va au bas, pas à la demande", () => {
    // ⚠️ La question EST le dernier contenu : ancrer sur la demande la
    // laisserait hors de l'écran. C'est l'inverse du but recherché.
    expect(ancrage({ apres: "blocked", avant: "working", suivaitLeBas: true })).toBe("bas");
    expect(ancrage({ apres: "blocked", avant: null, suivaitLeBas: true })).toBe("bas");
    // Et on ne tire toujours pas quelqu'un qui lisait plus haut.
    expect(ancrage({ apres: "blocked", avant: "working", suivaitLeBas: false })).toBe("aucun");
  });
});

describe("la position après un préfixe", () => {
  test("on compense exactement la hauteur ajoutée", () => {
    // 400 px de messages plus anciens : on descend d'autant, et le message
    // qu'on lisait reste au même endroit de l'écran.
    expect(
      positionApresPrepend({
        hauteurApres: 2400,
        hauteurAvant: 2000,
        scrollAvant: 300,
      }),
    ).toBe(700);
  });

  test("une liste reconstruite plus courte ne donne pas une position négative", () => {
    expect(
      positionApresPrepend({
        hauteurApres: 900,
        hauteurAvant: 2000,
        scrollAvant: 100,
      }),
    ).toBe(0);
  });

  test("sans ajout, rien ne bouge", () => {
    expect(
      positionApresPrepend({
        hauteurApres: 2000,
        hauteurAvant: 2000,
        scrollAvant: 512,
      }),
    ).toBe(512);
  });
});

describe("le chargement paresseux", () => {
  const base = {
    curseurDisponible: true,
    distanceAuHaut: 0,
    enCours: false,
    seuil: SEUIL_PREMIERES_LIGNES_PX,
  };

  test("près du haut avec un curseur, on charge", () => {
    expect(doitChargerPlusTot(base)).toBe(true);
  });

  test("pendant un chargement, on ne double pas la page", () => {
    expect(doitChargerPlusTot({ ...base, enCours: true })).toBe(false);
  });

  test("sans curseur, il n'y a plus rien à charger", () => {
    expect(doitChargerPlusTot({ ...base, curseurDisponible: false })).toBe(false);
  });

  test("loin du haut, on attend", () => {
    expect(
      doitChargerPlusTot({
        ...base,
        distanceAuHaut: SEUIL_PREMIERES_LIGNES_PX + 1,
      }),
    ).toBe(false);
  });
});
