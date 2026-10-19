/**
 * C25 — la feuille est **réellement modale** quand le moteur sait le faire.
 *
 * ⚠️ **Le défaut mesuré.** `<dialog open>` s'affichait par-dessus, mais le fond
 * restait **interactif** : un clic dans la marge atteignait la page derrière, et
 * le clavier ne tenait que par notre piège de focus. `aria-modal="true"`
 * annonce une modale ; il ne la rend pas modale.
 *
 * ⚠️ **Ce qui est prouvé ici, et ce qui ne peut pas l'être.** On prouve la
 * **décision** : `showModal()` est appelé quand il existe, l'attribut `open`
 * sert de repli sinon, et on n'appelle jamais `showModal()` sur un dialogue
 * déjà ouvert (il lèverait). L'inertie elle-même est celle **du navigateur** —
 * c'est précisément pourquoi on délègue au lieu de simuler : un test ne peut
 * pas prouver qu'un clic passe ou ne passe pas.
 */
import { describe, expect, test } from "bun:test";
import { ouvreDialogue, type Dialogue } from "../src/dialogue.ts";

/** Un dialogue factice : note ce qu'on lui fait. */
const dialogue = (
  options: { open?: boolean; modal?: boolean } = {},
): { appels: string[]; dialogue: Dialogue } => {
  const appels: string[] = [];
  const base: Dialogue = {
    open: options.open ?? false,
    setAttribute: (nom, valeur) => {
      appels.push(`set:${nom}=${valeur}`);
    },
  };
  if (options.modal !== false) {
    return {
      appels,
      dialogue: {
        ...base,
        showModal: () => {
          appels.push("showModal");
        },
      },
    };
  }
  return { appels, dialogue: base };
};

describe("C25 — modal quand c'est possible", () => {
  test("un dialogue fermé s'ouvre en modal (fond inerte par le navigateur)", () => {
    const { appels, dialogue: element } = dialogue();
    expect(ouvreDialogue(element)).toBe("modale");
    expect(appels).toEqual(["showModal"]);
  });

  test("sans `showModal`, on retombe sur `open` — et on le DIT", () => {
    const { appels, dialogue: element } = dialogue({ modal: false });
    expect(ouvreDialogue(element)).toBe("simple");
    expect(appels).toEqual(["set:open="]);
    // Le repli ne prétend pas être modal : c'est la limite du moteur.
  });

  test("un dialogue DÉJÀ ouvert ne rappelle pas `showModal` (il lèverait)", () => {
    const { appels, dialogue: element } = dialogue({ open: true });
    expect(ouvreDialogue(element)).toBe("simple");
    expect(appels).not.toContain("showModal");
  });
});
