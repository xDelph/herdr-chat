/**
 * H23 — la présence de cet appareil : battement visible, départ caché, rien
 * sans abonnement, panne signalée. Sans navigateur ni réseau.
 */
import { describe, expect, test } from "bun:test";
import { BATTEMENT_PRESENCE_MS, creePresence } from "../src/presence.ts";

const banc = (endpoint: string | null = "https://push.example/tel") => {
  const envois: Array<[string, boolean]> = [];
  const pannes: string[] = [];
  const battements: Array<() => void> = [];
  let visible = true;
  let arrets = 0;
  let echoue = false;
  const presence = creePresence({
    endpoint: async () => endpoint,
    envoie: async (cible, etat) => {
      if (echoue) throw new Error("403 unauthorized origin");
      envois.push([cible, etat]);
    },
    repete: (action, intervalle) => {
      expect(intervalle).toBe(BATTEMENT_PRESENCE_MS);
      battements.push(action);
      return () => {
        arrets += 1;
      };
    },
    signale: (cause) => pannes.push(cause),
    visible: () => visible,
  });
  return {
    arrets: () => arrets,
    battements,
    cache: () => {
      visible = false;
    },
    echoue: () => {
      echoue = true;
    },
    envois,
    pannes,
    presence,
  };
};

describe("présence de cet appareil (H23)", () => {
  test("visible : un battement tout de suite, puis à intervalle", async () => {
    const b = banc();
    await b.presence.surVisibilite();
    expect(b.envois).toEqual([["https://push.example/tel", true]]);
    expect(b.battements).toHaveLength(1);
    // Un second signal visible ne double pas le battement.
    await b.presence.surVisibilite();
    expect(b.battements).toHaveLength(1);
  });

  test("caché : le départ part, le battement s'arrête", async () => {
    const b = banc();
    await b.presence.surVisibilite();
    b.cache();
    await b.presence.surVisibilite();
    expect(b.envois.at(-1)).toEqual(["https://push.example/tel", false]);
    expect(b.arrets()).toBe(1);
  });

  test("sans abonnement push : rien ne part", async () => {
    const b = banc(null);
    await b.presence.surVisibilite();
    b.cache();
    await b.presence.surVisibilite();
    expect(b.envois).toEqual([]);
  });

  test("une panne est signalée avec sa cause, jamais avalée", async () => {
    const b = banc();
    b.echoue();
    await b.presence.surVisibilite();
    expect(b.pannes).toEqual(["403 unauthorized origin"]);
  });
});
