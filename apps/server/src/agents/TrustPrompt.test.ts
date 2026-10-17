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
import { respondToTrust, touchesDeConfiance } from "./TrustPrompt.ts";

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
const herdrWith = (
  screen: string,
  sent: string[][],
  apres?: string,
  /** `true` = l'agent n'est PLUS là quand on vérifie l'issue. */
  agentMort = false,
): HerdrApi => {
  let lu = 0;
  return {
    closeTab: unused,
    createTab: unused,
    // ⚠️ L'agent doit être **vivant** pour que l'acceptation soit prouvée : une
    // invite qui disparaît parce que l'agent est mort n'est pas une acceptation.
    getAgent: () =>
      agentMort ? unused() : Effect.succeed({ agent: { agent: "codex", agent_status: "blocked" } }),
    listAgents: unused,
    ping: unused,
    promptAgent: unused,
    focusAgent: () => Effect.succeed({}),
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
    // ⚠️ Present parce que l'interface l'exige : ce chemin n'est pas celui de
    // l'invite de confiance (qui envoie des touches), mais un client incomplet
    // ne compilerait pas.
    sendText: unused,
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
      // ⚠️ La famille est **dite** : depuis qu'un type inconnu ne reçoit
      // aucune touche, un appel sans famille ne répondrait plus rien du tout.
      respondToTrust(herdrWith(TRUST_SCREEN, sent, "Welcome to Codex"), "w:p", true, "codex"),
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
      respondToTrust(herdrWith(TRUST_SCREEN, sent, TRUST_SCREEN), "w:p", true, "codex"),
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
      respondToTrust(herdrWith(TRUST_SCREEN, sent, "Trust declined"), "w:p", false, "codex"),
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.state).toBe("refusee");
    expect(sent).toEqual([["2"]]);
  });
});

/**
 * Les touches qui accordent la confiance **dépendent de la famille**, et c'est
 * mesuré.
 *
 * ⚠️ **Le défaut que cette section verrouille.** `respondToTrust` envoyait
 * `["1", "enter"]`, ce qui est la forme de codex — des options **numérotées**.
 * Claude présente une **sélection** sans numéro :
 *
 *     ❯ No, exit
 *       Yes, I trust this folder
 *
 * `1` n'y fait rien (ou pire, si la liste était numérotée dans un autre ordre,
 * choisirait « No, exit »). Il faut **descendre la surbrillance** puis valider.
 *
 * ⚠️ Le vocabulaire des touches est mesuré, pas deviné : `["down"]` a réellement
 * déplacé la surbrillance de « No, exit » à « Yes, I trust this folder » sur un
 * pane réel, puis `["up"]` l'a remise — **sans jamais valider**, donc sans
 * accorder la confiance. Herdr ne déclare pas ses noms de touches.
 */
describe("les touches de confiance, par famille", () => {
  test("claude : une SÉLECTION, donc descendre puis valider", () => {
    expect(touchesDeConfiance("claude", true)).toEqual(["down", "enter"]);
  });

  test("claude : refuser, c'est valider l'option déjà surlignée", () => {
    // `❯ No, exit` est la première : elle est surlignée d'origine (relevé).
    expect(touchesDeConfiance("claude", false)).toEqual(["enter"]);
  });

  test("codex : des options NUMÉROTÉES, donc un chiffre", () => {
    expect(touchesDeConfiance("codex", true)).toEqual(["1", "enter"]);
    expect(touchesDeConfiance("codex", false)).toEqual(["2"]);
  });

  test("une famille INCONNUE ne reçoit aucune touche", () => {
    /*
      ⚠️ **Le repli sur les touches de codex a TUÉ un agent.** Mesuré : le type
      n'était pas lu (un `Option` non déballé), la famille valait `null`, et la
      table envoyait `1` puis `enter` — les touches de codex. Sur l'invite de
      claude, qui est une **sélection sans numéros**, le `1` est ignoré et le
      `enter` valide l'option surlignée : « No, exit ». L'agent sortait.

      Envoyer une touche non mesurée, c'est appuyer au hasard sur une invite dont
      on ne connaît pas les options. On refuse, et on le dit.
    */
    expect(touchesDeConfiance(null, true)).toBeUndefined();
    expect(touchesDeConfiance(null, false)).toBeUndefined();
    expect(touchesDeConfiance("pasunagent", true)).toBeUndefined();
  });
});

/**
 * Un type d'agent **inconnu** ne reçoit aucune touche — et surtout pas celles
 * d'un autre.
 *
 * ⚠️ **Le défaut mesuré, et il a tué un agent.** Le type n'était pas lu (un
 * `Option` non déballé), donc la famille valait `null` et la table retombait sur
 * les touches de **codex** : `1` puis `enter`. Sur l'invite de claude — une
 * **sélection sans numéros** — le `1` est ignoré et le `enter` valide l'option
 * déjà surlignée, qui est « No, exit ». L'agent **sortait**, et la confiance
 * n'était pas écrite.
 */
describe("un type inconnu ne fait rien", () => {
  test("aucune touche n'est envoyée", async () => {
    const sent: string[][] = [];
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(TRUST_SCREEN, sent, "Welcome"), "w:p", true),
    );

    expect(sent).toEqual([]);
    expect(outcome.accepted).toBe(false);
    expect(outcome.state).toBe("non-applicable");
  });

  test("le refus dit POURQUOI, et où répondre", async () => {
    const sent: string[][] = [];
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(TRUST_SCREEN, sent, "Welcome"), "w:p", true),
    );

    expect(outcome.detail).toContain("no known key sequence");
    expect(outcome.detail).toContain("Mac");
  });
});

/**
 * Un agent qui **meurt** pendant la réponse n'est pas un succès.
 *
 * ⚠️ **La preuve ne peut pas être la seule disparition de l'invite** : un agent
 * mort n'affiche plus d'invite non plus. Le défaut a été vu en vrai — la carte
 * annonçait « accordé » alors que l'agent venait de sortir, et la confiance
 * n'était pas écrite. On exige donc aussi que l'agent soit **encore là**.
 */
describe("un agent mort n'est jamais « accordé »", () => {
  test("l'invite partie mais l'agent disparu → « transmise »", async () => {
    const sent: string[][] = [];
    // L'écran n'a plus l'invite (l'agent est mort), et `agent.get` échoue.
    const outcome = await Effect.runPromise(
      respondToTrust(herdrWith(TRUST_SCREEN, sent, "shell $", true), "w:p", true, "codex"),
    );

    expect(outcome.accepted).toBe(false);
    expect(outcome.state).toBe("transmise");
    expect(outcome.detail).toContain("gone");
  });
});
