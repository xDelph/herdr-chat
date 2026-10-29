/**
 * Chaque action part en **POST JSON** — la règle que les deux démons
 * appliquent (405 sinon). L'arrêt partait en GET : Stop ne pouvait pas
 * fonctionner. Aucun réseau : `fetch` est un double qui note la demande.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  answerQuestion,
  answerTrust,
  focusAgent,
  launchAgent,
  sendPrompt,
  stopAgent,
} from "../src/api.ts";

type Demande = { readonly url: string; readonly method: string; readonly type: string | null };

const original = globalThis.fetch;
const demandes: Demande[] = [];

const doublure = (corps: unknown, statut = 200) => {
  demandes.length = 0;
  globalThis.fetch = Object.assign(
    async (entree: RequestInfo | URL, init?: RequestInit) => {
      const entetes = new Headers(init?.headers);
      demandes.push({
        method: init?.method ?? "GET",
        type: entetes.get("content-type"),
        url: typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url,
      });
      return new Response(JSON.stringify(corps), {
        headers: { "content-type": "application/json" },
        status: statut,
      });
    },
    { preconnect: original.preconnect },
  );
};

afterEach(() => {
  globalThis.fetch = original;
});

const action = (demande: Demande | undefined) => {
  expect(demande?.method).toBe("POST");
  expect(demande?.type).toBe("application/json");
};

describe("les actions partent en POST JSON", () => {
  test("arrêt", async () => {
    doublure({ requested: true, status: "working" });
    await stopAgent("wB:p1D").catch(() => undefined);
    expect(demandes[0]?.url).toBe("/api/agents/wB%3Ap1D/stop");
    action(demandes[0]);
  });

  test("envoi, réponse, confiance, focus, lancement", async () => {
    doublure({});
    await sendPrompt("w1:p1", "bonjour").catch(() => undefined);
    await answerQuestion("w1:p1", 1).catch(() => undefined);
    await answerTrust("w1:p1", true).catch(() => undefined);
    await focusAgent("w1:p1").catch(() => undefined);
    await launchAgent("w1", "pi").catch(() => undefined);
    expect(demandes).toHaveLength(5);
    for (const demande of demandes) action(demande);
  });
});
