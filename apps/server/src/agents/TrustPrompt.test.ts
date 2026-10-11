/**
 * Invite de confiance — la porte qui ne doit **jamais** répondre à la place
 * de l'utilisateur.
 *
 * ⚠️ Ces tests vérifient l'absence d'action autant que la présence : le pire
 * scénario est d'envoyer `enter` dans un agent qui posait une *autre*
 * question.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { isTrustPrompt } from "./TrustPrompt.ts";
import type { HerdrApi, HerdrError } from "../herdr/HerdrClient.ts";
import { HerdrProtocolError } from "../herdr/HerdrClient.ts";
import { respondToTrust } from "./TrustPrompt.ts";

/** Écran réel relevé sur un pane de test (codex, dossier non approuvé). */
const TRUST_SCREEN = `
  /Users/thomas.delalonde/projects/perso/herdr-pwa

  Trust this folder? Codex can read, edit, and run files here, subject to your
  permission settings. Folder settings can run code automatically, even without
  a model request. Continue only if you trust these files.

  › 1. Trust and continue
    2. Quit
`;

/** Un agent qui pose une AUTRE question : répondre « oui » serait faux. */
const OTHER_DIALOG = `
  ? Approve this command?
  › 1. Yes
    2. No
`;

describe("TrustPrompt — détection", () => {
  test("reconnaît l'invite de confiance de codex", () => {
    expect(isTrustPrompt(TRUST_SCREEN)).toBe(true);
  });

  test("ne confond pas une autre boîte de dialogue avec l'invite de confiance", () => {
    expect(isTrustPrompt(OTHER_DIALOG)).toBe(false);
    expect(isTrustPrompt("")).toBe(false);
    expect(isTrustPrompt("prêt")).toBe(false);
  });
});

/**
 * Client simulé.
 *
 * ⚠️ **Complet**, sans assertion : un `HerdrApi` à moitié rempli aurait besoin
 * d'un `as unknown as`, et le lint le refuse à juste titre — une assertion
 * non sûre dans un test est une assertion non sûre.
 */
const unused = <A>(): Effect.Effect<A, HerdrError> =>
  Effect.fail(new HerdrProtocolError({ code: "unused", message: "non utilisé", method: "test" }));

const herdrWith = (screen: string, sent: string[][]): HerdrApi => {
  return {
    closeTab: unused,
    createTab: unused,
    getAgent: unused,
    listAgents: unused,
    ping: unused,
    promptAgent: unused,
    readAgent: () => Effect.succeed({ text: screen, truncated: false }),
    request: unused,
    sendKeys: (_target: string, keys: ReadonlyArray<string>) => {
      sent.push([...keys]);
      return Effect.succeed({});
    },
    snapshot: unused,
    startAgent: unused,
  };
};

describe("TrustPrompt — rien n'est envoyé si l'invite n'est pas là", () => {
  test("invite absente → aucune touche envoyée", async () => {
    const sent: string[][] = [];
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(OTHER_DIALOG, sent), "w:p", true),
    );
    expect(outcome.accepted).toBe(false);
    // ⚠️ C'est LE point : zéro touche, sinon on répondrait à l'utilisateur.
    expect(sent).toEqual([]);
  });

  test("invite présente et acceptée → « 1 » puis « enter »", async () => {
    const sent: string[][] = [];
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(TRUST_SCREEN, sent), "w:p", true),
    );
    expect(outcome.accepted).toBe(true);
    expect(sent).toEqual([["1", "enter"]]);
  });

  test("invite présente et refusée → « 2 », et rien n'est déclaré accordé", async () => {
    const sent: string[][] = [];
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(TRUST_SCREEN, sent), "w:p", false),
    );
    expect(outcome.accepted).toBe(false);
    expect(sent).toEqual([["2"]]);
  });
});
