/**
 * Le worker demande d'ouvrir une conversation (`herdr:navigate`) : seul un
 * fragment de l'app est suivi.
 */
import { describe, expect, test } from "bun:test";
import {
  CACHE_NAVIGATION,
  CLE_NAVIGATION,
  ecouteNavigationWorker,
  hashDeNavigation,
  reprendNavigation,
  type ReserveNavigation,
} from "../src/navigation-worker.ts";

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

/** Une réserve en mémoire — la forme de `caches`, sans navigateur. */
const reserve = (
  contenu: unknown,
): { reserve: ReserveNavigation; entrees: Map<string, unknown> } => {
  const entrees = new Map<string, unknown>();
  if (contenu !== undefined) entrees.set(`${CACHE_NAVIGATION}|${CLE_NAVIGATION}`, contenu);
  return {
    entrees,
    reserve: {
      open: async (nom: string) => ({
        delete: async (cle: string) => entrees.delete(`${nom}|${cle}`),
        match: async (cle: string) => {
          const valeur = entrees.get(`${nom}|${cle}`);
          return valeur === undefined ? undefined : { json: async () => valeur };
        },
      }),
    },
  };
};

describe("cible retenue par le worker (iOS perd navigate et le message)", () => {
  test("une cible fraîche est reprise, une seule fois", async () => {
    const vus: string[] = [];
    const { reserve: r, entrees } = reserve({ at: 1_000, hash: "#/agent/w1%3Ap1" });
    expect(await reprendNavigation(r, 5_000, (hash) => vus.push(hash))).toBe("#/agent/w1%3Ap1");
    expect(vus).toEqual(["#/agent/w1%3Ap1"]);
    expect(entrees.size).toBe(0);
    expect(await reprendNavigation(r, 6_000, (hash) => vus.push(hash))).toBeNull();
    expect(vus).toHaveLength(1);
  });

  test("trop vieille, ou hors de l'app : effacée, jamais suivie", async () => {
    const vus: string[] = [];
    const vieille = reserve({ at: 1_000, hash: "#/agent/w1%3Ap1" });
    expect(await reprendNavigation(vieille.reserve, 120_000, (h) => vus.push(h))).toBeNull();
    expect(vieille.entrees.size).toBe(0);
    const ailleurs = reserve({ at: 1_000, hash: "https://ailleurs.example/" });
    expect(await reprendNavigation(ailleurs.reserve, 2_000, (h) => vus.push(h))).toBeNull();
    expect(vus).toEqual([]);
  });

  test("sans réserve ni cible : rien", async () => {
    expect(await reprendNavigation(undefined, 0, () => undefined)).toBeNull();
    expect(await reprendNavigation(reserve(undefined).reserve, 0, () => undefined)).toBeNull();
  });
});
