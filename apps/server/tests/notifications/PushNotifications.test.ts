/**
 * Ce que dit une notification — et où elle mène.
 *
 * ⚠️ Une notification est le seul endroit du produit où l'utilisateur lit sans
 * être dans l'application. Deux erreurs y sont invisibles pour nous et coûteuses
 * pour lui : annoncer « terminé » pour un agent qui attend, et ouvrir
 * l'application ailleurs que sur l'agent concerné.
 */
import { describe, expect, test } from "bun:test";
import { payloadDeNotification } from "../../src/notifications/PushNotifications.ts";

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

/**
 * Un agent qui **n'est plus là** — et on ne dit pas pourquoi, parce qu'on ne le
 * sait pas.
 *
 * ⚠️ **Mesuré sur un vrai pane.** Un agent lancé à `00:25`, son invite affichée
 * 11 h 33, puis le shell est revenu **sans un mot** : aucun message à l'écran,
 * aucun rapport de plantage, et Claude Code avait supprimé son propre fichier
 * d'état — une sortie **propre**. Herdr, lui, rend `pane.exited` avec son seul
 * type, **sans code de sortie ni raison** (vérifié au schéma).
 *
 * Annoncer « has finished working » ferait croire à une réussite : c'est faux, et
 * c'est le genre de mensonge qui fait ignorer une alerte.
 */
describe("payloadDeNotification — un agent qui n'est plus là", () => {
  test("il n'a pas « fini », et le message le dit", () => {
    const payload = payloadDeNotification("pixel · tab 1 · claude", "wF:p5", "gone");

    expect(payload.body).toContain("no longer running");
    expect(payload.body).not.toContain("finished");
  });

  test("sans nom connu, la phrase reste générique et lisible", () => {
    const payload = payloadDeNotification("", "wF:p5", "gone");

    expect(payload.body).toBe("An agent is no longer running.");
  });

  test("sa propre étiquette, pour ne pas effacer une question sans réponse", () => {
    // ⚠️ Le `tag` est ce qui fait **coexister** deux bannières : une question en
    // attente ne doit pas disparaître parce que l'agent s'est arrêté ensuite.
    expect(payloadDeNotification("x", "wF:p5", "gone").tag).toBe("gone-wF:p5");
    expect(payloadDeNotification("x", "wF:p5", "blocked").tag).toBe("waiting-wF:p5");
  });

  test("son propre titre, ni « needs you » ni « finished »", () => {
    expect(payloadDeNotification("x", "wF:p5", "gone").title).toBe("Agent stopped");
  });

  test("le clic mène toujours au pane concerné", () => {
    expect(decodeURIComponent(payloadDeNotification("x", "wF:p5", "gone").url)).toContain("wF:p5");
  });
});
