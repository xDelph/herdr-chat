/**
 * La liste des conversations — règles vérifiées (U16).
 *
 * La refonte de l'écran est visuelle ; les règles qui la rendent **lisible**
 * ne le sont pas. Elles sont vérifiées ici comme le reste.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MINIMUM, ratio, token as lireToken } from "../src/contraste.ts";

const css = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8");

/**
 * Feuille sans commentaires.
 *
 * Un commentaire contient des `{` et des `}`, et l'ancre « début de bloc » ne
 * les reconnaît pas : sans ce retrait, un bloc précédé d'un commentaire passe
 * pour absent — et le test échouerait sur un écran parfaitement correct.
 */
const cssNu = css.replace(/\/\*[\s\S]*?\*\//g, "");
const app = readFileSync(join(import.meta.dir, "..", "src", "App.tsx"), "utf8");
const ligne = readFileSync(join(import.meta.dir, "..", "src", "ConversationRow.tsx"), "utf8");

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

  test("le mot est bien un texte, jamais une pastille", () => {
    // U17 : le mot est calculé localement, parce que « terminé **il y a 2 min** »
    // porte plus d'information que le seul état.
    expect(ligne).toContain("motDEtat(conversation, maintenant)");
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

  test("projet et onglet ne poussent pas l'état hors de l'écran", () => {
    // Le projet porte `min-width: 0` et le tronquage : sans eux, un nom long
    // pousserait l'état à droite hors de l'écran à 320 px.
    expect(bloc(".conv__origine")["min-width"]).toBe("0");
    expect(bloc(".conv__projet").overflow).toBe("hidden");
    expect(bloc(".conv__onglet")["flex"]).toBe("0 0 auto");
  });

  test("la demande est tronquée à deux lignes, jamais empilée", () => {
    // Une demande peut être un paragraphe entier : sans plafond, une ligne
    // prendrait la moitié de l'écran et la liste cesserait d'être parcourable.
    expect(bloc(".conv__demande")["-webkit-line-clamp"]).toBe("2");
    expect(bloc(".conv__demande").overflow).toBe("hidden");
  });

  test("la troisième ligne se tronque au lieu de passer à la ligne", () => {
    // Branche, modèle et raisonnement peuvent être longs : une ligne, un
    // ellipsis. Un retour à la ligne ferait varier la hauteur d'une ligne à
    // l'autre et casserait le rythme de la liste.
    expect(bloc(".conv__details")["white-space"]).toBe("nowrap");
    expect(bloc(".conv__details")["text-overflow"]).toBe("ellipsis");
  });
});

describe("U16 — la liste garde sa structure", () => {
  test("chaque groupe a un titre et son compte", () => {
    /*
      ⚠️ Le titre vient désormais du **groupe**, pas d'une table lue dans
      l'écran. C'était `SECTION_LABEL[section]` : depuis que la liste peut être
      répartie par projet, une clé est soit une section, soit un identifiant de
      projet — et une seule des deux se traduit par une table. Résoudre le titre
      dans `sections.ts` évite un `as Section` dans le rendu, c'est-à-dire une
      assertion qui masquerait une clé inattendue au lieu de la montrer.
    */
    expect(app).toContain("<SectionTitle count={lignes.length}>{titre}</SectionTitle>");
    expect(app).not.toContain("SECTION_LABEL[");
  });

  test("les filtres, l'activité et la barre d'onglets ont disparu", () => {
    /*
      ⚠️ Vérifié **par absence**. Ces trois blocs occupaient le premier écran
      sans aider à lire : deux listes déroulantes, un journal d'événements et
      trois onglets pour deux écrans réels. Un retour discret les ramènerait.
    */
    expect(app).not.toContain("Filtres actifs");
    expect(app).not.toContain("Activité récente");
    expect(app).not.toContain('className="tabs"');
    expect(app).not.toContain("statusFilter");
  });

  test("le point de connexion a trois couleurs, pas deux", () => {
    // Une reconnexion n'est pas une panne : le flux peut se taire quelques
    // secondes pendant que la lecture fonctionne encore.
    for (const etat of ["live", "reconnexion", "hors-ligne"]) {
      expect(bloc(`.point--${etat}`).background).toMatch(/var\(--(ok|warn|err)\)/);
    }
    // Et la couleur seule ne suffit pas : le libellé existe pour les lecteurs
    // d'écran.
    expect(app).toContain('className="sr-only"');
    expect(bloc(".sr-only")["clip-path"]).toBe("inset(50%)");
  });

  test("les réglages sont derrière un engrenage, plus dans un onglet", () => {
    expect(app).toContain('aria-label="Settings"');
    expect(app).toContain("SettingsSheet");
  });

  test("le bouton nouvel agent reste dans le pied de page de l'écran", () => {
    const footer = bloc(".app__footer");
    expect(footer.display).toBe("flex");
    expect(footer.flex).toBe("0 0 auto");
    expect(footer.padding).toBe("0 16px max(10px, env(safe-area-inset-bottom))");
    const fab = bloc(".fab");
    expect(fab["min-height"]).toBe("var(--tap-min)");
  });

  test("le bouton flottant ne réserve plus la place d'une barre disparue", () => {
    /*
      ⚠️ Il réservait 45 px pour la barre d'onglets. Depuis U17 cette barre
      n'existe plus, et l'écart ne servait qu'à faire flotter le bouton dans le
      vide. Ce test empêche le retour d'un décalage fantôme.
    */
    const footer = bloc(".app__footer");
    expect(footer.padding).toBe("0 16px max(10px, env(safe-area-inset-bottom))");

    /*
      ⚠️ Ce test interdisait `safe-area-inset-bottom` **partout dans la feuille**.
      L'interdiction était juste à l'époque : la boîte du shell était trop courte
      sur iOS, donc l'inset s'ajoutait à un vide déjà là. Maintenant que le shell
      atteint le vrai bord, l'inset fait l'inverse — il dégage l'indicateur
      d'accueil.

      La règle utile n'est donc pas « jamais d'inset » mais **« jamais un inset
      nu »** : chaque usage doit passer par un plancher `max(...)`, pour que la
      barre d'accueil ne puisse pas rapetisser une cible tactile ni créer d'espace
      quand il n'y a pas de barre (desktop, Android). Un inset nu reviendrait à
      ajouter du vide — c'est ce que ce test empêche désormais.
    */
    for (const trouve of cssNu.matchAll(/safe-area-inset-bottom/gu)) {
      const contexte = cssNu.slice(Math.max(0, (trouve.index ?? 0) - 40), trouve.index ?? 0);
      expect(contexte).toContain("max(");
    }
    // Et la barre d'onglets elle-même ne doit plus exister, ni en style ni en balise.
    expect(cssNu).not.toContain(".tabs {");
    expect(app).not.toContain('className="tabs"');
  });

  test("le bouton flottant demande un projet, il ne lance pas dans le vide", () => {
    // « Nouvel agent » exige une cible : sans elle, le bouton ne ferait pas ce
    // qu'il annonce.
    expect(app).toContain("ProjectPicker");
    expect(app).toContain("+ New agent");
  });
});

describe("U18 — l'en-tête reste en haut", () => {
  test("la barre du haut ne rétrécit pas et colle", () => {
    // ⚠️ Sans `flex: 0 0 auto`, une liste longue comprime l'en-tête : le titre
    // et l'engrenage sortent de l'écran en défilant.
    const barre = bloc(".topbar");
    expect(barre["flex"]).toBe("0 0 auto");
    expect(barre["flex"]).toBe("0 0 auto");
  });

  test("l'en-tête est hors du conteneur défilant", () => {
    // `.screen` est ce qui défile. L'en-tête étant son frère, il ne défile pas
    // avec lui — c'est la structure qui le garantit, pas une astuce de style.
    const ecran = bloc(".screen");
    expect(ecran["overflow-y"]).toBe("auto");
    expect(app.indexOf('className="topbar"')).toBeLessThan(
      app.indexOf('className="screen screen--liste"'),
    );
  });

  test("le titre de section colle en haut du défilement", () => {
    // On sait toujours dans quelle section on lit, même au milieu de la liste.
    const titre = bloc(".section");
    expect(titre["position"]).toBe("sticky");
    expect(titre.top).toBe("0");
    // Fond opaque : sinon le contenu se verrait au travers.
    expect(titre.background).toBe("var(--bg)");
  });

  test("le titre de section n'a pas de marge, seulement un rembourrage", () => {
    // ⚠️ Une marge laisserait une bande où le contenu défilerait **avant** le
    // titre collé — le titre semblerait sauter.
    const titre = bloc(".section");
    expect(titre["margin"]).toBe("0");
    expect(titre["padding"]).toContain("14px 16px 6px");
  });

  test("les deux niveaux collants ne se recouvrent pas", () => {
    // Le titre de section passe **sous** la barre du haut, jamais par-dessus.
    expect(Number(bloc(".topbar")["z-index"])).toBeGreaterThan(Number(bloc(".section")["z-index"]));
  });
});
