/**
 * La liste des conversations — règles vérifiées (U16).
 *
 * La refonte de l'écran est visuelle ; les règles qui la rendent **lisible**
 * ne le sont pas. Elles sont vérifiées ici comme le reste.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MINIMUM, ratio, token as lireToken } from "./contraste.ts";

const css = readFileSync(join(import.meta.dir, "styles.css"), "utf8");

/**
 * Feuille sans commentaires.
 *
 * Un commentaire contient des `{` et des `}`, et l'ancre « début de bloc » ne
 * les reconnaît pas : sans ce retrait, un bloc précédé d'un commentaire passe
 * pour absent — et le test échouerait sur un écran parfaitement correct.
 */
const cssNu = css.replace(/\/\*[\s\S]*?\*\//g, "");
const app = readFileSync(join(import.meta.dir, "App.tsx"), "utf8");
const ligne = readFileSync(join(import.meta.dir, "ConversationRow.tsx"), "utf8");

/** Déclarations d'un bloc, comme dans `chat-layout.test.ts`. */
const bloc = (selecteur: string): Record<string, string> => {
  const trouve = new RegExp(
    `(?:^|\\})\\s*${selecteur.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`,
  ).exec(cssNu);
  if (trouve?.[1] === undefined) throw new Error(`bloc « ${selecteur} » absent`);
  const resultat: Record<string, string> = {};
  for (const morceau of trouve[1].split(";")) {
    const deuxPoints = morceau.indexOf(":");
    if (deuxPoints < 0) continue;
    resultat[morceau.slice(0, deuxPoints).trim()] = morceau.slice(deuxPoints + 1).trim();
  }
  return resultat;
};

const token = lireToken;

describe("U16 — le mot d'état se lit, et il se distingue", () => {
  test("chaque état a une couleur, et ils ne se ressemblent pas", () => {
    // Une pastille demandait de connaître la légende ; un mot doit **dire** son
    // état. La couleur ne peut pas être la seule distinction, et le texte reste.
    // On vérifie la **référence** au token, pas sa valeur résolue : c'est la
    // règle de thème, et la résolution est mesurée par `contrast.test.ts`. Les
    // confondre ferait échouer ce test au premier changement de teinte.
    const blocEtat = bloc(".etat");
    expect(blocEtat["font-weight"]).toBe("600");
    expect(blocEtat.color).toBe("var(--muted)");
    expect(bloc(".etat--bloque").color).toBe("var(--warn)");
    expect(bloc(".etat--en-cours").color).toBe("var(--accent)");
    expect(bloc(".etat--fait").color).toBe("var(--ok)");
  });

  test("« inconnu » reste neutre — le rouge accuserait l'agent", () => {
    // On ne sait rien de lui : une couleur d'alerte serait une accusation.
    expect(bloc(".etat").color).toBe("var(--muted)");
    expect(ligne).toContain('unknown: "etat"');
  });

  test("le mot est bien le texte de l'état, pas une pastille", () => {
    expect(ligne).toContain("statusLabel(agent.status)");
    expect(ligne).not.toContain("statusClass(");
  });
});

describe("U16 — contrastes de la ligne", () => {
  const paires: ReadonlyArray<readonly [string, string]> = [
    ["texte", "text"],
    ["source", "muted"],
    ["temps", "muted"],
    ["meta", "muted"],
    ["titre", "text"],
  ];

  test("chaque texte de la ligne passe le seuil", () => {
    for (const [nom, couleur] of paires) {
      const mesure = ratio(token(couleur), token("bg"));
      // Le libellé entre dans l'assertion : un échec nomme le couple fautif.
      expect(`${nom} (${mesure.toFixed(2)}:1) ≥ ${String(MINIMUM)}:1`).not.toBe("");
      if (mesure < MINIMUM) throw new Error(`${nom} sous le seuil : ${mesure.toFixed(2)}:1`);
    }
  });

  test("les mots d'état restent lisibles sur le fond", () => {
    for (const couleur of ["warn", "accent", "ok"]) {
      const mesure = ratio(token(couleur), token("bg"));
      if (mesure < MINIMUM) throw new Error(`${couleur} sous le seuil : ${mesure.toFixed(2)}:1`);
    }
  });
});

describe("U16 — la ligne se lit à 320 px", () => {
  test("la ligne entière est la cible tactile", () => {
    const conv = bloc(".conv");
    expect(conv["min-height"]).toBe("var(--tap-min)");
    expect(conv.width).toBe("100%");
  });

  test("source et temps ne se chevauchent pas", () => {
    // La source porte `min-width: 0` pour pouvoir rétrécir ; sans elle, elle
    // pousserait le temps hors de l'écran à 320 px.
    expect(bloc(".conv__ligne")["min-width"]).toBe("0");
    expect(bloc(".conv__source").overflow).toBe("hidden");
    expect(bloc(".conv__temps")["flex"]).toBe("0 0 auto");
  });

  test("le titre est tronqué à deux lignes, jamais empilé", () => {
    // Un titre de conversation peut être une phrase entière : sans plafond, il
    // pousse la ligne et mange l'écran.
    expect(bloc(".conv__titre")["-webkit-line-clamp"]).toBe("2");
    expect(bloc(".conv__titre").overflow).toBe("hidden");
  });
});

describe("U16 — la liste garde sa structure", () => {
  test("chaque section a un titre et un compte", () => {
    expect(app).toContain("<SectionTitle count={conversations.length}>");
    expect(app).toContain("SECTION_LABEL[section]");
  });

  test("une section vide reste visible avec son compte", () => {
    // La retirer ferait croire qu'elle a été filtrée.
    expect(app).toContain('className="liste__vide"');
  });

  test("le filtre est caché par défaut, et dit quand il est actif", () => {
    expect(app).toContain("filtreActif");
    expect(app).toContain("Filtres actifs");
  });

  test("le bouton flottant est fixe, pas dans le flux", () => {
    const fab = bloc(".fab");
    expect(fab.position).toBe("fixed");
    // La barre du téléphone ne doit pas le recouvrir.
    expect(fab.bottom).toContain("safe-area-inset-bottom");
    expect(fab["min-height"]).toBe("var(--tap-min)");
  });

  test("le bouton flottant passe AU-DESSUS de la barre d'onglets", () => {
    /*
      ⚠️ C'est le défaut visuel le plus probable d'un bouton flottant : un
      `bottom` en pixels nus le place derrière la barre, à moitié caché, sans
      qu'aucun test ne le voie. Le calcul doit nommer la hauteur de la barre.
    */
    const fab = bloc(".fab");
    expect(fab.bottom).toContain("var(--tabs-height)");
    // Et cette hauteur doit correspondre à la barre réelle, pas à un chiffre
    // écrit à la main qui dériverait au premier changement de gabarit.
    expect(bloc(".tab")["min-height"]).toBe("var(--tap-min)");
    expect(bloc(".tabs").background).toBe("var(--surface)");
    expect(bloc(".tabs")["padding-bottom"]).toContain("safe-area-inset-bottom");
  });

  test("le bouton flottant demande un projet, il ne lance pas dans le vide", () => {
    // « Nouvel agent » exige une cible : sans elle, le bouton ne ferait pas ce
    // qu'il annonce.
    expect(app).toContain("ProjectPicker");
    expect(app).toContain("+ Nouvel agent");
  });
});
