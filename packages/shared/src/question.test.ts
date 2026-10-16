/**
 * Lecture d'une question posée à l'écran.
 *
 * ⚠️ Ces tests encodent une **mesure**, pas une supposition : l'écran qui suit a
 * été recopié mot pour mot de `agent.read` sur un agent codex réellement bloqué
 * (2026-10-13, Herdr 0.9.3, protocole 22).
 */
import { describe, expect, test } from "bun:test";
import { questionDeLEcran } from "./question.ts";

/** L'écran réel, tel que Herdr l'a rendu — indentation et alignement compris. */
const ECRAN_REEL = [
  '• Ran pixel search-content "App" -F apps/web/src/App.tsx',
  "  └   ├─ § estimated LLM context saved: ~1267 tok (99%)",
  "",
  "",
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
  "",
].join("\n");

describe("questionDeLEcran", () => {
  test("lit la question réelle, avec ses choix", () => {
    const question = questionDeLEcran(ECRAN_REEL);
    expect(question?.texte).toBe('Allow Computer Use to use "Zen"?');
    expect(question?.choix).toEqual([
      { detail: "Run the tool and continue", libelle: "Allow", numero: 1, selectionne: true },
      {
        detail: "Run the tool and remember this choice for this session",
        libelle: "Allow for this session",
        numero: 2,
        selectionne: false,
      },
      {
        detail: "Run the tool and remember this choice for future tool calls",
        libelle: "Always allow",
        numero: 3,
        selectionne: false,
      },
      { detail: "Cancel this tool call", libelle: "Cancel", numero: 4, selectionne: false },
    ]);
  });

  test("le contexte et l'invite de validation sont repris tels quels", () => {
    const question = questionDeLEcran(ECRAN_REEL);
    expect(question?.contexte).toEqual(["App: Zen"]);
    expect(question?.invite).toBe("enter to submit | esc to cancel");
  });

  test("le choix surligné est celui qui porte `›`, et un seul", () => {
    const question = questionDeLEcran(ECRAN_REEL);
    expect(question?.choix.filter((c) => c.selectionne).map((c) => c.libelle)).toEqual(["Allow"]);
  });

  /**
   * ⚠️ Le piège du séparateur. Les colonnes sont alignées par le terminal, donc
   * l'écart varie : un libellé peut contenir un espace simple (« Allow for this
   * session ») sans que ce soit une frontière. Seul un trou de **deux espaces ou
   * plus** sépare.
   */
  test("un libellé à espaces simples n'est pas coupé en deux", () => {
    const question = questionDeLEcran(ECRAN_REEL);
    expect(question?.choix[1]?.libelle).toBe("Allow for this session");
  });

  test("sans détail, le libellé reste entier", () => {
    const ecran = ["Question ?", "› 1. Oui", "  2. Non", "enter to submit"].join("\n");
    const question = questionDeLEcran(ecran);
    expect(question?.choix).toEqual([
      { libelle: "Oui", numero: 1, selectionne: true },
      { libelle: "Non", numero: 2, selectionne: false },
    ]);
  });

  /**
   * ⚠️ On lit la **dernière** invite. Un agent qui a travaillé en a affiché
   * plusieurs ; l'écran garde le défilement, et la première trouvée serait une
   * question à laquelle plus personne n'attend de réponse.
   */
  test("plusieurs invites : c'est la dernière qui compte", () => {
    const ecran = [
      "Question ancienne ?",
      "› 1. Ancien oui",
      "  2. Ancien non",
      "",
      "Question actuelle ?",
      "› 1. Oui",
      "  2. Non",
    ].join("\n");
    expect(questionDeLEcran(ecran)?.texte).toBe("Question actuelle ?");
  });

  test("une sortie d'outil numérotée n'est PAS une question", () => {
    // Le cas qui ferait afficher n'importe quoi : une liste dans une sortie.
    const ecran = ["1. première étape", "2. deuxième étape", "3. troisième étape"].join("\n");
    expect(questionDeLEcran(ecran)).toBeUndefined();
  });

  test("une numérotation avec un trou est refusée", () => {
    const ecran = ["Question ?", "› 1. Un", "  3. Trois"].join("\n");
    expect(questionDeLEcran(ecran)).toBeUndefined();
  });

  test("un seul « choix » n'est pas une question", () => {
    expect(questionDeLEcran(["Fait.", "1. seule ligne"].join("\n"))).toBeUndefined();
  });

  test("un écran sans invite ne lève pas, et ne rend rien", () => {
    for (const ecran of ["", "\n\n", "juste du texte", "• Ran ls\n  └ ok"]) {
      expect(questionDeLEcran(ecran)).toBeUndefined();
    }
  });
});

/**
 * ⚠️ **L'écran opencode, recopié tel quel.** Relevé le 2026-10-16 sur un agent
 * réellement bloqué, via `herdr pane read --source visible`. Rien n'est
 * reconstruit : c'est la forme exacte que l'application reçoit, filet `┃`
 * compris — et c'est le filet qui l'empêchait de reconnaître la question.
 */
const ECRAN_OPENCODE = `  ┃
     + Thought · 9.0s

     I don't see a report attached to your message — no file path, pasted text, or link.

  ┃
  ┃  $ git status --short | head -30
  ┃
  ┃  M .agents/skills/improve-codebase-architecture/SKILL.md
  ┃

     + Thought · 4.6s

     → Asked 1 question

  ┃
  ┃  Questions
  ┃
  ┃  I don't see a report in your message or in the recent repo files — how would you like to share it with me?
  ┃
  ┃  1. It's a file on disk
  ┃     Tell me the file path and I'll read it.
  ┃  2. Paste it as text
  ┃     It seems the report didn't come through — paste its contents in your next message.
  ┃  3. It's a GitHub/CI report
  ┃     Share the PR number, run ID, or URL and I'll pull it with gh.
  ┃  4. It's pixel CLI output
  ┃     E.g. pixel doctor, pixel audit, or a benchmark report — paste the output.
  ┃  5. Type your own answer
  ┃
  ┃  ↑↓ select  enter submit  esc dismiss`;

describe("opencode — le filet de rendu ne cache plus la question", () => {
  test("la question est reconnue, alors qu'elle était invisible", () => {
    expect(questionDeLEcran(ECRAN_OPENCODE)).toBeDefined();
  });

  test("les cinq choix sont lus, dans l'ordre", () => {
    // ⚠️ Avant le nettoyage du filet, `LIGNE_CHOIX` — ancrée sur `^[ \t]*(›)?` —
    // ne pouvait pas traverser `  ┃  `. La fonction rendait `undefined` : un
    // agent bloqué, et un écran qui ne disait pas sur quoi.
    const question = questionDeLEcran(ECRAN_OPENCODE);

    expect(question?.choix.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5]);
  });

  test("les libellés sont repris sans le filet ni le numéro", () => {
    const libelles = questionDeLEcran(ECRAN_OPENCODE)?.choix.map((c) => c.libelle);

    expect(libelles).toEqual([
      "It's a file on disk",
      "Paste it as text",
      "It's a GitHub/CI report",
      "It's pixel CLI output",
      "Type your own answer",
    ]);
  });

  test("le texte de la question est la phrase, pas le titre de section", () => {
    const question = questionDeLEcran(ECRAN_OPENCODE);

    expect(question?.texte).toContain("I don't see a report in your message");
    expect(question?.texte).not.toContain("Questions");
  });

  test("l'invite `↑↓ select` est reconnue — sans barre oblique", () => {
    // ⚠️ pi écrit `↑/↓`, opencode écrit `↑↓`. Une seule forme reconnue suffisait
    // à perdre l'invite sur l'autre agent.
    expect(questionDeLEcran(ECRAN_OPENCODE)?.invite).toBe("↑↓ select  enter submit  esc dismiss");
  });

  test("aucun choix n'est marqué sélectionné, et on ne le devine pas", () => {
    // ⚠️ opencode colore sa sélection ; le texte brut perd la couleur, et il
    // n'écrit pas de `›`. Inventer une sélection serait pire que ne rien dire :
    // l'utilisateur verrait un choix surligné qui n'est pas celui de l'agent.
    const choix = questionDeLEcran(ECRAN_OPENCODE)?.choix ?? [];

    expect(choix.every((c) => !c.selectionne)).toBe(true);
  });

  test("les autres filets sont tolérés aussi", () => {
    const barre = ECRAN_OPENCODE.replaceAll("┃", "│");
    const tube = ECRAN_OPENCODE.replaceAll("┃", "|");

    expect(questionDeLEcran(barre)?.choix.length).toBe(5);
    expect(questionDeLEcran(tube)?.choix.length).toBe(5);
  });

  test("un filet sans question ne fabrique pas de question", () => {
    const sansQuestion = ["  ┃  $ ls -la", "  ┃  total 0", "  ┃  drwxr-xr-x 2"].join("\n");

    expect(questionDeLEcran(sansQuestion)).toBeUndefined();
  });
});
