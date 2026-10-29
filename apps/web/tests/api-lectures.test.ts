/**
 * Les lectures du client — sans réseau : `fetch` est un double.
 *
 * - la sonde du flux de session distingue une route absente d'un pane refusé ;
 * - une lecture a un délai, et son dépassement se dit ;
 * - les erreurs connues du démon sont traduites, la cause brute reste.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { fetchHealth, fetchSession, sendPrompt, sondeFluxSession } from "../src/api.ts";
import { erreurLisible } from "../src/erreurs-demon.ts";

const original = globalThis.fetch;

const repond = (corps: string, statut: number, type: string) => {
  globalThis.fetch = Object.assign(
    async () => new Response(corps, { headers: { "content-type": type }, status: statut }),
    { preconnect: original.preconnect },
  );
};

afterEach(() => {
  globalThis.fetch = original;
});

describe("sonde du flux de session : route absente ≠ pane refusé", () => {
  const url = "/api/agents/w1%3Ap1/stream";

  test("404 JSON avec une erreur de domaine : c'est CE pane", async () => {
    repond(
      JSON.stringify({ error: "aucune source", hint: "code diagnostic : no_source" }),
      404,
      "application/json",
    );
    expect(await sondeFluxSession(url)).toEqual({ detail: "aucune source", nature: "pane" });
  });

  test("404 « route inconnue » : la route manque", async () => {
    repond(JSON.stringify({ error: "route inconnue" }), 404, "application/json");
    expect((await sondeFluxSession(url)).nature).toBe("route-absente");
  });

  test("404 « unknown route » (démon en anglais) : la route manque aussi", async () => {
    repond(JSON.stringify({ error: "unknown route" }), 404, "application/json");
    expect((await sondeFluxSession(url)).nature).toBe("route-absente");
  });

  test("405 : la route ne sert pas ce flux", async () => {
    repond(JSON.stringify({ error: "method not allowed" }), 405, "application/json");
    expect((await sondeFluxSession(url)).nature).toBe("route-absente");
  });

  test("HTML 200 (repli SPA du démon TS) : la route manque", async () => {
    repond("<!doctype html><title>Herdr Chat</title>", 200, "text/html");
    expect((await sondeFluxSession(url)).nature).toBe("route-absente");
  });

  test("un flux qui répond, ou un 503 de plafond : passager", async () => {
    repond("", 200, "text/event-stream");
    expect((await sondeFluxSession(url)).nature).toBe("passager");
    repond(JSON.stringify({ error: "trop de flux" }), 503, "application/json");
    expect((await sondeFluxSession(url)).nature).toBe("passager");
  });

  test("réseau coupé : passager, jamais une route absente", async () => {
    globalThis.fetch = Object.assign(
      async () => {
        throw new TypeError("Load failed");
      },
      { preconnect: original.preconnect },
    );
    expect((await sondeFluxSession(url)).nature).toBe("passager");
  });
});

describe("une lecture a un délai (P2)", () => {
  test("un délai dépassé se dit comme tel, pas comme une erreur réseau", async () => {
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = Object.assign(
      async (_entree: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
      { preconnect: original.preconnect },
    );
    const erreur = await fetchSession("w1:p1", { tail: 1 }).catch((cause: unknown) => cause);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(erreur instanceof Error ? erreur.message : "").toBe(
      "The daemon did not respond within 10s",
    );
  });
});

describe("les erreurs du démon, en français (P2)", () => {
  test("la phrase connue est traduite, et la cause brute suit sur sa ligne", () => {
    expect(erreurLisible("no usable session path for this agent")).toBe(
      "Herdr exposes no readable session for this agent\nCause: no usable session path for this agent",
    );
  });

  test("l'arrêt sans agent est expliqué tel que le démon l'écrit", () => {
    // Le démon dit « no Herdr agent in this pane » (arret.rs) : le motif ne
    // reconnaissait que « … in pane X ».
    expect(erreurLisible("no Herdr agent in this pane")).toBe(
      "Herdr knows no agent in this pane\nCause: no Herdr agent in this pane",
    );
    expect(erreurLisible("no Herdr agent in pane w1:p2")).toBe(
      "Herdr knows no agent in pane w1:p2\nCause: no Herdr agent in pane w1:p2",
    );
    expect(erreurLisible("unreadable Herdr snapshot: socket")).toBe(
      "Herdr's state is unreadable\nCause: unreadable Herdr snapshot: socket",
    );
  });

  test("une cause inconnue passe telle quelle — rien d'inventé", () => {
    expect(erreurLisible("quelque chose d'imprévu")).toBe("quelque chose d'imprévu");
  });

  test("une lecture de session refusée affiche la traduction", async () => {
    repond(
      JSON.stringify({ error: "no usable session path for this agent" }),
      404,
      "application/json",
    );
    const erreur = await fetchSession("w1:p1").catch((cause: unknown) => cause);
    expect(erreur instanceof Error ? erreur.message : "").toContain(
      "Herdr exposes no readable session for this agent",
    );
  });

  test("hors ligne, un envoi dit « rien n'est parti »", async () => {
    const enLigne = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: false },
    });
    globalThis.fetch = Object.assign(
      async () => {
        throw new TypeError("Load failed");
      },
      { preconnect: original.preconnect },
    );
    try {
      expect(await sendPrompt("w1:p1", "x")).toEqual({
        kind: "failed",
        message: "",
        state: "hors-ligne",
      });
    } finally {
      if (enLigne === undefined) Reflect.deleteProperty(globalThis, "navigator");
      else Object.defineProperty(globalThis, "navigator", enLigne);
    }
  });
});

describe("santé : le 503 est une réponse, pas une panne (H01)", () => {
  test("Herdr injoignable se lit, au lieu de « failed (503) »", async () => {
    repond(
      JSON.stringify({
        herdr: { reachable: false, socket: "/s/herdr.sock" },
        ok: false,
        uptimeMs: 1,
      }),
      503,
      "application/json",
    );
    const sante = await fetchHealth();
    expect(sante.ok).toBe(false);
    expect(sante.herdr.reachable).toBe(false);
  });

  test("un autre échec reste une erreur nommée", async () => {
    repond(JSON.stringify({ error: "boom" }), 500, "application/json");
    await expect(fetchHealth()).rejects.toThrow("boom");
  });
});
