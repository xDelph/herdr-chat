/**
 * Le worker demande d'ouvrir une conversation (`herdr:navigate`) : seul un
 * fragment de l'app est suivi.
 */
import { describe, expect, test } from "bun:test";
import { ecouteNavigationWorker, hashDeNavigation } from "../src/navigation-worker.ts";

describe("navigation demandée par le worker", () => {
  test("un fragment `#/…` est suivi", () => {
    expect(hashDeNavigation({ hash: "#/agent/w1%3Ap1", type: "herdr:navigate" })).toBe(
      "#/agent/w1%3Ap1",
    );
  });

  test("autre type, autre adresse, forme inattendue : ignorés", () => {
    expect(hashDeNavigation({ hash: "#/agent/x", type: "autre" })).toBeNull();
    expect(
      hashDeNavigation({ hash: "https://ailleurs.example/", type: "herdr:navigate" }),
    ).toBeNull();
    expect(hashDeNavigation({ hash: "agent/x", type: "herdr:navigate" })).toBeNull();
    expect(hashDeNavigation({ hash: 3, type: "herdr:navigate" })).toBeNull();
    expect(hashDeNavigation("herdr:navigate")).toBeNull();
  });

  test("l'écoute navigue sur un message valide, et se retire", () => {
    const ecouteurs = new Set<(evenement: MessageEvent) => void>();
    const conteneur = {
      addEventListener: (_type: "message", ecouteur: (evenement: MessageEvent) => void) => {
        ecouteurs.add(ecouteur);
      },
      removeEventListener: (_type: "message", ecouteur: (evenement: MessageEvent) => void) => {
        ecouteurs.delete(ecouteur);
      },
    };
    const visites: string[] = [];
    const arreter = ecouteNavigationWorker(conteneur, (hash) => visites.push(hash));
    const poste = (data: unknown) => {
      for (const ecouteur of ecouteurs) ecouteur(new MessageEvent("message", { data }));
    };
    poste({ hash: "#/agent/w1%3Ap1", type: "herdr:navigate" });
    poste({ hash: "/ailleurs", type: "herdr:navigate" });
    expect(visites).toEqual(["#/agent/w1%3Ap1"]);
    arreter();
    expect(ecouteurs.size).toBe(0);
  });

  test("sans worker, rien ne lève", () => {
    expect(() => ecouteNavigationWorker(undefined, () => undefined)()).not.toThrow();
  });
});
