/**
 * Les lectures du client — sans réseau : `fetch` est un double.
 *
 * - la sonde du flux de session distingue une route absente d'un pane refusé ;
 * - une lecture a un délai, et son dépassement se dit ;
 * - les erreurs connues du démon sont traduites, la cause brute reste.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { fetchSession, sendPrompt, sondeFluxSession } from "../src/api.ts";
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
    expect(erreur instanceof Error ? erreur.message : "").toBe("Le démon n'a pas répondu en 10 s");
  });
});

describe("les erreurs du démon, en français (P2)", () => {
  test("la phrase connue est traduite, et la cause brute suit sur sa ligne", () => {
    expect(erreurLisible("no usable session path for this agent")).toBe(
      "Herdr n'expose pas de session lisible pour cet agent\nCause : no usable session path for this agent",
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
      "Herdr n'expose pas de session lisible pour cet agent",
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
