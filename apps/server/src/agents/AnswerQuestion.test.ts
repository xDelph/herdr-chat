/**
 * Répondre à une question — et surtout : **ne pas répondre à côté**.
 *
 * ⚠️ La garde testée ici n'est pas décorative. L'invite relevée sur un vrai
 * agent codex autorise l'exécution de code (« Allow Computer Use… »). Envoyer un
 * chiffre que la question n'offre pas serait envoyer une **décision que
 * l'utilisateur n'a pas prise**.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { HerdrPourQuestion } from "./AnswerQuestion.ts";
import { numeroOffert, repondreQuestion } from "./AnswerQuestion.ts";

/** L'écran réel d'un agent codex bloqué (relevé le 2026-10-13). */
const ECRAN = [
  "  Field 1/1",
  '  Allow Computer Use to use "Zen"?',
  "",
  "  App: Zen",
  "",
  "  › 1. Allow                   Run the tool and continue",
  "    2. Allow for this session  Run the tool and remember this choice for this session",
  "    3. Always allow            Run the tool and remember this choice for future tool calls",
  "    4. Cancel                  Cancel this tool call",
  "  enter to submit | esc to cancel",
].join("\n");

/** Un Herdr simulé : on ne touche jamais un vrai agent dans un test. */
const fauxHerdr = (
  ecrans: ReadonlyArray<string>,
): { herdr: HerdrPourQuestion; frappes: Array<ReadonlyArray<string>> } => {
  const frappes: Array<ReadonlyArray<string>> = [];
  let index = 0;
  const lire = () => {
    const texte = ecrans[Math.min(index, ecrans.length - 1)] ?? "";
    index += 1;
    return Effect.succeed({ text: texte, truncated: false });
  };
  const herdr: HerdrPourQuestion = {
    readAgent: () => lire(),
    sendKeys: (_cible: string, keys: ReadonlyArray<string>) => {
      frappes.push(keys);
      return Effect.succeed({});
    },
    // Ce faux client n'exerce pas la saisie libre (voir `fauxHerdrTrace`) : les
    // tests ci-dessus ne passent jamais de texte.
    sendText: () => Effect.succeed({}),
  };
  return { frappes, herdr };
};

const lancer = async (ecrans: ReadonlyArray<string>, numero: number) => {
  const { frappes, herdr } = fauxHerdr(ecrans);
  const resultat = await Effect.runPromise(repondreQuestion(herdr, "w1:p1", numero));
  return { frappes, resultat };
};

describe("numeroOffert — la garde", () => {
  test("un numéro réellement proposé passe", () => {
    const choix = [{ numero: 1 }, { numero: 2 }];
    expect(numeroOffert(choix, 1)).toBe(true);
    expect(numeroOffert(choix, 2)).toBe(true);
  });

  test("un numéro hors liste est refusé — c'est le but", () => {
    const choix = [{ numero: 1 }, { numero: 2 }, { numero: 3 }, { numero: 4 }];
    for (const numero of [0, 5, 7, 99, -1]) {
      expect(numeroOffert(choix, numero)).toBe(false);
    }
  });

  test("un non-entier est refusé, jamais arrondi", () => {
    const choix = [{ numero: 1 }, { numero: 2 }];
    for (const numero of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(numeroOffert(choix, numero)).toBe(false);
    }
  });

  test("une liste vide n'offre rien", () => {
    expect(numeroOffert([], 1)).toBe(false);
  });
});

describe("repondreQuestion", () => {
  test("un choix offert est envoyé, puis l'application est PROUVÉE", async () => {
    // Premier écran : la question. Second : l'agent a repris.
    const { frappes, resultat } = await lancer([ECRAN, "• Traitement en cours…"], 1);
    expect(frappes).toEqual([["1", "enter"]]);
    expect(resultat.state).toBe("appliquee");
    expect(resultat.detail).toContain("Allow");
  });

  test("un choix NON offert n'envoie RIEN", async () => {
    const { frappes, resultat } = await lancer([ECRAN, ECRAN], 7);
    expect(frappes).toEqual([]);
    expect(resultat.state).toBe("refusee");
    // Le refus nomme ce qui était possible : sinon l'utilisateur ne sait pas
    // s'il s'est trompé ou si la question a changé.
    expect(resultat.detail).toContain("1, 2, 3, 4");
  });

  test("sans question à l'écran, rien n'est envoyé", async () => {
    const { frappes, resultat } = await lancer(["• Ran ls\n  └ ok"], 1);
    expect(frappes).toEqual([]);
    expect(resultat.state).toBe("refusee");
  });

  /**
   * ⚠️ Le cas qui interdit de dire « envoyé ». La frappe part, mais la question
   * est **toujours là** : Herdr n'a pas appliqué, ou l'agent a redémarré.
   */
  test("question toujours à l'écran : « transmise », jamais « appliquée »", async () => {
    const { frappes, resultat } = await lancer([ECRAN, ECRAN], 2);
    expect(frappes).toEqual([["2", "enter"]]);
    expect(resultat.state).toBe("transmise");
    expect(resultat.detail).toContain("not proven");
  });

  test("on ne suppose jamais un choix déjà sélectionné", async () => {
    // Le `›` est sur « Allow » : on envoie quand même le numéro demandé.
    const { frappes } = await lancer([ECRAN, "fini"], 4);
    expect(frappes).toEqual([["4", "enter"]]);
  });
});

/** Écran d'après : la question a disparu, l'agent a repris. */
const ECRAN_APRES = ["  > travail en cours", "  $ bun run verify", ""].join("\n");

/**
 * Un Herdr simulé qui note **la méthode** de chaque écriture, dans l'ordre.
 *
 * ⚠️ Sans cette trace, « un choix seul » et « un choix suivi d'un texte » sont
 * indistinguables : les deux finissent par un `sendKeys`. Or l'ordre est
 * exactement ce qu'il faut tenir — écrire le texte **avant** de choisir
 * l'option le ferait taper dans le vide.
 */
const fauxHerdrTrace = (ecrans: ReadonlyArray<string>) => {
  const trace: Array<string> = [];
  let index = 0;
  const lire = () => {
    const texte = ecrans[Math.min(index, ecrans.length - 1)] ?? "";
    index += 1;
    return Effect.succeed({ text: texte, truncated: false });
  };
  const herdr: HerdrPourQuestion = {
    readAgent: () => lire(),
    sendKeys: (_cible: string, keys: ReadonlyArray<string>) => {
      trace.push(`keys:${keys.join("+")}`);
      return Effect.succeed({});
    },
    sendText: (_cible: string, text: string) => {
      trace.push(`text:${text}`);
      return Effect.succeed({});
    },
  };
  return { herdr, trace };
};

const lancerAvecTexte = async (texte: string | undefined) => {
  const { herdr, trace } = fauxHerdrTrace([ECRAN, ECRAN_APRES]);
  const reponse = await Effect.runPromise(repondreQuestion(herdr, "w1:p1", 4, texte));
  return { reponse, trace };
};

describe("la saisie libre — le choix ouvre le champ, le texte l'emplit", () => {
  test("sans texte, le choix seul part — et rien de plus", async () => {
    const { reponse, trace } = await lancerAvecTexte(undefined);

    expect(reponse.state).toBe("appliquee");
    expect(trace).toEqual(["keys:4+enter"]);
  });

  test("avec un texte : choix, puis texte, puis validation", async () => {
    // ⚠️ C'est la séquence prouvée dans le code d'opencode : un chiffre
    // **sélectionne** sans valider, `enter` valide — ce qui ouvre le champ texte
    // pour l'option de saisie libre — puis on écrit, puis on valide.
    const { reponse, trace } = await lancerAvecTexte("le rapport est dans ~/tmp/r.md");

    expect(reponse.state).toBe("appliquee");
    expect(trace).toEqual(["keys:4+enter", "text:le rapport est dans ~/tmp/r.md", "keys:enter"]);
  });

  test("le texte est écrit APRÈS le choix, jamais avant", async () => {
    // L'inverse ferait taper dans le vide : le champ n'existe qu'une fois
    // l'option sélectionnée et validée.
    const { trace } = await lancerAvecTexte("ma réponse");
    const rangChoix = trace.indexOf("keys:4+enter");
    const rangTexte = trace.findIndex((t) => t.startsWith("text:"));

    expect(rangChoix).toBeGreaterThanOrEqual(0);
    expect(rangTexte).toBeGreaterThan(rangChoix);
  });

  test("un texte fait d'espaces n'écrit RIEN", async () => {
    // ⚠️ Valider un champ vide ferait avancer l'agent sur du vent — il croirait
    // avoir reçu une réponse.
    const { trace } = await lancerAvecTexte("   \n  ");

    expect(trace).toEqual(["keys:4+enter"]);
  });

  test("un texte vide n'écrit rien non plus", async () => {
    const { trace } = await lancerAvecTexte("");

    expect(trace).toEqual(["keys:4+enter"]);
  });

  test("un choix refusé n'écrit jamais de texte", async () => {
    // La garde passe avant tout envoi : rien ne part, texte compris.
    const { herdr, trace } = fauxHerdrTrace([ECRAN, ECRAN]);
    const reponse = await Effect.runPromise(repondreQuestion(herdr, "w1:p1", 9, "ma réponse"));

    expect(reponse.state).toBe("refusee");
    expect(trace).toEqual([]);
  });
});
