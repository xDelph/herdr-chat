/**
 * Les lectures du client — sans réseau : `fetch` est un double.
 *
 * - la sonde du flux de session distingue une route absente d'un pane refusé ;
 */
import { afterEach, describe, expect, test } from "bun:test";
import { sondeFluxSession } from "../src/api.ts";

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
