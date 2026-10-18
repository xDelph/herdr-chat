/**
 * Un appel d'outil raconté en une ligne (U21).
 *
 * Ces tests portent sur les trois choses qu'un groupe replié doit dire : ce qui
 * a été fait, combien de temps, et pour combien de jetons.
 */
import { describe, expect, test } from "bun:test";
import type { RenderedMessage } from "../src/blocks.ts";
import {
  actionDe,
  coutDuGroupe,
  deltaDe,
  dureeEnMots,
  jetonsCourts,
  lignesDeTravail,
  regrouperCommandes,
  resumeDuGroupe,
} from "../src/actions.ts";

const message = (
  meta: Readonly<Record<string, string>> = {},
  at: string | null = null,
): RenderedMessage => ({
  at,
  blocks: [],
  id: `m-${String(Math.random())}`,
  meta,
  role: "assistant",
  text: "",
});

describe("U21 — un appel se raconte en une ligne", () => {
  test("une commande : son icône, son verbe, sa première ligne", () => {
    const action = actionDe("bash", { command: "npm test\nnpm run build" });
    expect(action.icone).toBe("🖥");
    expect(action.singulier).toBe("Ran");
    // ⚠️ Une commande peut contenir un script entier : l'afficher en entier
    // défait la ligne compacte.
    expect(action.cible).toBe("npm test");
    expect(action.estFichier).toBe(false);
  });

  test("une édition : le chemin devient une cible cliquable", () => {
    const action = actionDe("edit", { path: "/dev/p/backup.py" });
    expect(action.icone).toBe("✎");
    expect(action.cible).toBe("/dev/p/backup.py");
    expect(action.estFichier).toBe(true);
  });

  test("une création se distingue d'une modification", () => {
    // « Créé » et « modifié » ne se relisent pas de la même façon.
    expect(actionDe("write", { path: "a.ts" }).singulier).toBe("Create");
    expect(actionDe("edit", { path: "a.ts" }).singulier).toBe("Edit");
  });

  test("une suppression a sa propre famille", () => {
    const action = actionDe("rm", { path: "vieux.ts" });
    expect(action.icone).toBe("✕");
    expect(action.singulier).toBe("Delete");
    expect(action.estFichier).toBe(true);
  });

  test("un outil inconnu garde une ligne, sans être inventé", () => {
    // ⚠️ Le nom technique **n'est pas traduit** : c'est un identifiant, et
    // l'inventer ferait perdre le lien avec la session.
    const action = actionDe("outil-du-futur", { path: "x" });
    expect(action.icone).toBe("•");
    expect(action.singulier).toBe("Action");
  });

  test("la casse du nom ne change pas la reconnaissance", () => {
    expect(actionDe("BASH", { command: "ls" }).singulier).toBe("Ran");
    expect(actionDe(" Edit ", { path: "a" }).singulier).toBe("Edit");
  });

  test("un chemin vide ne devient pas une cible cliquable", () => {
    const action = actionDe("edit", { path: "   " });
    expect(action.cible).toBeNull();
  });
});

describe("U21 — le résumé dit ce qui a été fait", () => {
  test("les familles rencontrées, dans l'ordre de lecture", () => {
    // « 7 appels » ne dit pas **ce qui a été fait** — la seule question qu'on se
    // pose devant un groupe replié.
    expect(resumeDuGroupe(["bash", "edit", "read", "bash"])).toBe(
      "Edits, ran commands, files read",
    );
  });

  test("une famille répétée n'apparaît qu'une fois", () => {
    expect(resumeDuGroupe(["bash", "bash", "bash"])).toBe("Ran commands");
  });

  test("un groupe vide ne produit pas de résumé", () => {
    expect(resumeDuGroupe([])).toBe("");
  });

  test("un outil inconnu est résumé, pas ignoré", () => {
    // L'ignorer ferait disparaître du travail de la ligne. La casse suit la
    // position dans l'énumération, donc on compare sans y prêter attention.
    expect(resumeDuGroupe(["bash", "outil-inconnu"]).toLowerCase()).toContain("actions");
  });
});

describe("U21 — les jetons se lisent d'un regard", () => {
  test("65 000 devient 65k", () => {
    // ⚠️ `65000` ne se lit pas au doigt et prend la place de trois mots.
    expect(jetonsCourts(65_000)).toBe("65k");
  });

  test("au-delà du million, on passe au million", () => {
    /*
     * ⚠️ `1_200_000` s'affichait « 1200k » — et un gros travail « 2156k ».
     * Quatre chiffres suivis d'un `k` ne se lisent pas ; l'utilisateur l'a
     * signalé. On change d'unité au million.
     */
    expect(jetonsCourts(1_200_000)).toBe("1,2 M");
    expect(jetonsCourts(2_156_000)).toBe("2,2 M");
  });

  test("sous 10 000 on garde une décimale", () => {
    // `1,5k` et `2k` ne disent pas la même chose quand on compare deux travaux.
    expect(jetonsCourts(1500)).toBe("1,5k");
    expect(jetonsCourts(999)).toBe("999");
  });

  test("sans jetons, rien — jamais « 0k »", () => {
    expect(jetonsCourts(0)).toBe("");
    expect(jetonsCourts(Number.NaN)).toBe("");
  });
});

describe("U21 — la durée d'un travail", () => {
  test("les minutes et les secondes", () => {
    expect(dureeEnMots(14 * 60_000 + 20_000)).toBe("14 min 20 s");
  });

  test("sous la minute, en secondes", () => {
    expect(dureeEnMots(42_000)).toBe("42 s");
  });

  test("les secondes disparaissent au-delà d'une heure", () => {
    // « 1 h 4 min 12 s » se déchiffre ; « 1 h 4 min » se lit.
    expect(dureeEnMots(64 * 60_000 + 12_000)).toBe("1 h 4 min");
  });

  test("plancher, jamais d'arrondi vers le haut", () => {
    // Un âge exagéré est exactement ce que l'utilisateur compare avec son
    // souvenir.
    expect(dureeEnMots(119_000)).toBe("1 min 59 s");
  });

  test("une durée nulle ou négative ne s'affiche pas", () => {
    expect(dureeEnMots(0)).toBe("");
    expect(dureeEnMots(-5)).toBe("");
  });
});

describe("U21 — le coût du travail, pas celui de la session", () => {
  test("les jetons du groupe sont additionnés", () => {
    // ⚠️ Le total de la session ne dit rien sur ce qu'on vient de lire.
    const cout = coutDuGroupe([
      message({ tokens: "1200" }, "2026-10-09T15:00:00.000Z"),
      message({ tokens: "800" }, "2026-10-09T15:00:30.000Z"),
    ]);
    expect(cout.jetons).toBe(2000);
  });

  test("la durée est celle du groupe, pas d'une session entière", () => {
    const cout = coutDuGroupe([
      message({}, "2026-10-09T15:00:00.000Z"),
      message({}, "2026-10-09T15:14:20.000Z"),
    ]);
    expect(cout.dureeMs).toBe(14 * 60_000 + 20_000);
  });

  test("un seul message n'a pas de durée", () => {
    // On ne prétend pas mesurer un intervalle qui n'existe pas.
    expect(coutDuGroupe([message({}, "2026-10-09T15:00:00.000Z")]).dureeMs).toBeNull();
  });

  test("les messages sont lus dans le désordre sans fausser la durée", () => {
    const cout = coutDuGroupe([
      message({}, "2026-10-09T15:14:20.000Z"),
      message({}, "2026-10-09T15:00:00.000Z"),
    ]);
    expect(cout.dureeMs).toBe(14 * 60_000 + 20_000);
  });

  test("un horodatage illisible ne fabrique pas de durée", () => {
    const cout = coutDuGroupe([
      message({}, "pas-une-date"),
      message({}, "2026-10-09T15:14:20.000Z"),
    ]);
    expect(cout.dureeMs).toBeNull();
  });

  test("sans jetons déclarés, rien plutôt que zéro", () => {
    // ⚠️ « 0 jeton » se lirait comme une mesure, alors qu'on n'en a pas.
    expect(coutDuGroupe([message({})]).jetons).toBeNull();
  });

  test("un jeton illisible est ignoré, sans faire tomber le total", () => {
    const cout = coutDuGroupe([message({ tokens: "beaucoup" }), message({ tokens: "500" })]);
    expect(cout.jetons).toBe(500);
  });
});

describe("U22 — la taille d'un changement se dit sur la ligne", () => {
  test("une écriture ajoute tout son contenu", () => {
    const delta = deltaDe("write", { content: "a\nb\nc", path: "neuf.ts" });
    expect(delta).toEqual({ added: 3, removed: 0 });
  });

  test("une édition compte ce qu'elle ajoute et ce qu'elle retire", () => {
    const delta = deltaDe("edit", {
      edits: [
        { newText: "un\ndeux", oldText: "un" },
        { newText: "trois", oldText: "a\nb\nc\nd" },
      ],
      path: "a.ts",
    });
    expect(delta).toEqual({ added: 3, removed: 5 });
  });

  test("une commande n'a pas de delta, jamais zéro", () => {
    // ⚠️ `+0 −0` sur une lecture laisserait croire à un changement mesuré alors
    // qu'il n'y en a pas.
    expect(deltaDe("bash", { command: "ls" })).toBeNull();
    expect(deltaDe("read", { path: "a.ts" })).toBeNull();
    // Et l'action elle-même, pas seulement le compteur : c'est elle qui est
    // affichée, donc c'est elle qui doit porter « null ».
    expect(actionDe("bash", { command: "ls" }).delta).toBeNull();
    expect(actionDe("read", { path: "a.ts" }).delta).toBeNull();
  });

  test("une édition sans changement ne produit pas de delta", () => {
    expect(deltaDe("edit", { edits: [{ newText: "", oldText: "" }], path: "a.ts" })).toBeNull();
  });

  test("une forme inattendue ne fait pas tomber la ligne", () => {
    expect(deltaDe("edit", { edits: "pas un tableau" })).toBeNull();
    expect(deltaDe("write", { content: 12 })).toBeNull();
  });

  test("le delta remonte dans l'action, prêt à afficher", () => {
    const action = actionDe("edit", { edits: [{ newText: "x", oldText: "a\nb" }], path: "a.ts" });
    expect(action.delta).toEqual({ added: 1, removed: 2 });
    expect(action.cible).toBe("a.ts");
  });
});

describe("U22 — l'appel lui-même est son détail", () => {
  test("une édition a de quoi se déplier", () => {
    /*
      ⚠️ Le diff d'une édition vit dans ses **arguments**, pas dans son
      résultat. Avec `details: []`, « Fichier modifié » n'avait rien à déplier :
      le diff existait dans le code sans être atteignable.
    */
    const appel = {
      arguments: { edits: [{ newText: "x", oldText: "y" }], path: "a.ts" },
      id: "c1",
      kind: "toolCall" as const,
      name: "edit",
    };
    const lignes = lignesDeTravail([
      { at: null, blocks: [appel], id: "m1", meta: {}, role: "assistant", text: "" },
    ]);
    expect(lignes).toHaveLength(1);
    const premiere = lignes[0];
    expect(premiere?.kind).toBe("action");
    if (premiere?.kind === "action") {
      expect(premiere.details).toHaveLength(1);
      expect(premiere.details[0]?.kind).toBe("toolCall");
    }
  });

  test("la sortie se rattache à l'appel qui la précède", () => {
    // Deux lignes par appel doubleraient la longueur du groupe.
    const lignes = lignesDeTravail([
      {
        at: null,
        blocks: [
          {
            arguments: { command: "ls" },
            id: "c1",
            kind: "toolCall" as const,
            name: "bash",
          },
        ],
        id: "m1",
        meta: {},
        role: "assistant",
        text: "",
      },
      {
        at: null,
        blocks: [
          {
            images: [],
            isError: false,
            kind: "toolResult" as const,
            text: "fichier.ts",
            toolName: "bash",
          },
        ],
        id: "m2",
        meta: {},
        role: "toolResult",
        text: "",
      },
    ]);
    expect(lignes).toHaveLength(1);
    const seule = lignes[0];
    expect(seule?.kind).toBe("action");
    if (seule?.kind === "action") {
      expect(seule.details.map((bloc) => bloc.kind)).toEqual(["toolCall", "toolResult"]);
    }
  });

  test("les commandes consécutives sont regroupées, les éditions restent séparées", () => {
    const appels = [
      { arguments: { command: "pwd" }, id: "c1", kind: "toolCall" as const, name: "bash" },
      {
        arguments: { command: "bun run build" },
        id: "c2",
        kind: "toolCall" as const,
        name: "bash",
      },
      { arguments: { path: "src/app.ts" }, id: "c3", kind: "toolCall" as const, name: "edit" },
      { arguments: { command: "git status" }, id: "c4", kind: "toolCall" as const, name: "bash" },
    ];
    const lines = lignesDeTravail([
      { at: null, blocks: appels, id: "m1", meta: {}, role: "assistant", text: "" },
    ]);
    const visible = regrouperCommandes(lines);
    expect(visible.map((line) => line.kind)).toEqual(["commands", "action", "action"]);
    expect(visible[0]?.kind === "commands" ? visible[0].commands : []).toHaveLength(2);
  });
});
