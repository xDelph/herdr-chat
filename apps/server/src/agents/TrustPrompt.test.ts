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

/**
 * Faux Herdr.
 *
 * `apres` est l'écran **relu après la frappe** (B06). Il diffère par défaut :
 * rejouer le même écran ferait croire que l'acceptance n'a pas eu lieu — ce qui
 * est justement le cas que B06 veut rendre visible.
 */
const herdrWith = (screen: string, sent: string[][], apres?: string): HerdrApi => {
  let lu = 0;
  return {
    closeTab: unused,
    createTab: unused,
    getAgent: unused,
    listAgents: unused,
    ping: unused,
    promptAgent: unused,
    readAgent: () => {
      lu += 1;
      const texte = lu === 1 ? screen : (apres ?? "");
      return Effect.succeed({ text: texte, truncated: false });
    },
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

  test("invite présente, acceptée, et disparue → accordé", async () => {
    const sent: string[][] = [];
    // L'écran après la frappe ne contient plus l'invite : c'est la **preuve**
    // que la décision a été appliquée, pas la frappe qui la constituait.
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(TRUST_SCREEN, sent, "Welcome to Codex"), "w:p", true),
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.state).toBe("acceptee");
    expect(sent).toEqual([["1", "enter"]]);
  });

  /**
   * **Le cœur de B06.** La frappe part, mais l'invite est toujours là : Herdr
   * peut refuser la touche, l'agent peut redémarrer. Afficher « confiance
   * accordée » serait faux — et le dossier resterait non approuvé sans que
   * rien ne l'explique.
   */
  test("frappe partie mais invite toujours là → « transmise », jamais « accordée »", async () => {
    const sent: string[][] = [];
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(TRUST_SCREEN, sent, TRUST_SCREEN), "w:p", true),
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.state).toBe("transmise");
    expect(outcome.detail).toContain("not proven");
    // La frappe, elle, a bien eu lieu : c'est la preuve qui manque.
    expect(sent).toEqual([["1", "enter"]]);
  });

  test("invite présente et refusée → « 2 », et rien n'est déclaré accordé", async () => {
    const sent: string[][] = [];
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(TRUST_SCREEN, sent, "Trust declined"), "w:p", false),
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.state).toBe("refusee");
    expect(sent).toEqual([["2"]]);
  });
});
