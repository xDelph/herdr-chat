/**
 * Ce que dit une notification — et où elle mène.
 *
 * ⚠️ Une notification est le seul endroit du produit où l'utilisateur lit sans
 * être dans l'application. Deux erreurs y sont invisibles pour nous et coûteuses
 * pour lui : annoncer « terminé » pour un agent qui attend, et ouvrir
 * l'application ailleurs que sur l'agent concerné.
 */
import { describe, expect, test } from "bun:test";
import { payloadDeNotification } from "./PushNotifications.ts";

describe("payloadDeNotification", () => {
  test("un agent bloqué demande une réponse, il n'a pas « terminé »", () => {
    const p = payloadDeNotification("herdr-pwa", "wB:p16", "blocked");
    expect(p.title).toBe("Agent needs you");
    expect(p.body).toBe("herdr-pwa is waiting for your answer.");
  });

  test("un agent terminé le dit", () => {
    const p = payloadDeNotification("herdr-pwa", "wB:p16", "done");
    expect(p.title).toBe("Agent finished");
    expect(p.body).toBe("herdr-pwa has finished working.");
  });

  test("sans titre connu, la phrase reste lisible", () => {
    expect(payloadDeNotification("", "wB:p16", "blocked").body).toBe(
      "An agent is waiting for your answer.",
    );
    expect(payloadDeNotification("", "wB:p16", "done").body).toBe(
      "Your agent has finished working.",
    );
  });

  /**
   * ⚠️ Le point de ce commit : la notification doit ouvrir **l'agent**, pas
   * l'accueil. Retrouver soi-même lequel des six agents vient de finir, au
   * moment où l'on ne sait plus lequel c'était, est exactement ce que la
   * notification devrait éviter.
   */
  test("le clic mène à l'agent concerné, pas à l'accueil", () => {
    expect(payloadDeNotification("x", "wB:p16", "done").url).toBe("/#/agent/wB%3Ap16");
  });

  test("le paneId est encodé — il contient `:`", () => {
    // Sans encodage, `#/agent/wB:p16` serait relu de travers au retour.
    const url = payloadDeNotification("x", "w1:p2", "blocked").url;
    expect(url).not.toContain("w1:p2");
    expect(decodeURIComponent(url.replace("/#/agent/", ""))).toBe("w1:p2");
  });

  test("sans paneId, on ne devine pas d'adresse : l'accueil", () => {
    expect(payloadDeNotification("x", undefined, "done").url).toBe("/");
  });

  /**
   * ⚠️ Les étiquettes diffèrent : une question en attente ne doit pas être
   * remplacée en silence par un « finished » plus tardif pour le même pane.
   */
  test("les deux états ne partagent pas la même étiquette", () => {
    expect(payloadDeNotification("x", "wB:p16", "blocked").tag).toBe("waiting-wB:p16");
    expect(payloadDeNotification("x", "wB:p16", "done").tag).toBe("done-wB:p16");
  });
});
