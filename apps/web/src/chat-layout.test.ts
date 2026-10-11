/**
 * Géométrie de l'écran Chat — **vérifiée**, pas estimée (U07).
 *
 * Le critère d'acceptation est double : à 320×568 et 390×844, clavier ouvert,
 * le titre, le message courant et la saisie doivent rester accessibles **sans
 * chevauchement**. Un chevauchement de CSS ne se voit pas en relisant le
 * composant : il faut vérifier les règles qui le produisent.
 *
 * ⚠️ Ces tests lisent la feuille de style et le composant, ils ne rendent pas.
 * Ce n'est pas un compromis : la géométrie dépend de règles qui ne se déduisent
 * pas du JSX. Ce qui est **structurel** — le composeur hors du conteneur
 * défilant — est lui vérifié sur l'arbre, parce que c'est la régression
 * qu'on observerait d'abord si quelqu'un réintroduisait un conteneur unique.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "styles.css"), "utf8");
const brut = readFileSync(join(import.meta.dir, "ChatScreen.tsx"), "utf8");

// Un commentaire parle souvent de `<div>` pour expliquer un placement. Compté
// tel quel, il fausse la profondeur d'imbrication et fait échouer un test sur
// un écran parfaitement correct.
const source = brut.replace(/\/\*[\s\S]*?\*\//g, "");

/** Retire un bloc équilibré délimité par `debut` et sa fermeture. */
const retirer = (texte: string, debut: number): string => {
  if (debut < 0) return texte;
  let profondeur = 0;
  for (let i = texte.indexOf("{", debut); i < texte.length; i += 1) {
    if (texte[i] === "{") profondeur += 1;
    if (texte[i] === "}") {
      profondeur -= 1;
      if (profondeur === 0) return texte.slice(0, debut) + texte.slice(i + 1);
    }
  }
  return texte.slice(0, debut);
};

// Un commentaire contient des `{` et des `}` : sans ce retrait, un bloc cité
// en commentaire passerait pour une règle.
const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Corps d'une requête de média, chaîne vide si elle n'existe pas.
 *
 * ⚠️ Volontairement pas une exception : une requête absente ferait abandonner le
 * fichier de test entier, et les quatorze tests suivants ne tourneraient plus.
 * Une chaîne vide les fait échouer **un par un**, ce qui dit quelle règle a
 * disparu.
 */
const requete = (condition: string): string => {
  const debut = sansCommentaires.indexOf(`@media (${condition}) {`);
  if (debut < 0) return "";
  let profondeur = 0;
  for (let i = sansCommentaires.indexOf("{", debut); i < sansCommentaires.length; i += 1) {
    if (sansCommentaires[i] === "{") profondeur += 1;
    if (sansCommentaires[i] === "}") {
      profondeur -= 1;
      if (profondeur === 0) return sansCommentaires.slice(debut, i);
    }
  }
  throw new Error(`requête « ${condition} » non fermée`);
};

// Les requêtes de média sont des règles **conditionnelles** : les mélanger aux
// règles inconditionnelles ferait croire que la variante étroite s'applique
// toujours.
// Ordre inverse : retirer un bloc décale tous les index suivants, donc on
// commence par le dernier. `toReversed` ne mute pas la liste d'origine.
const inconditionnel = [...sansCommentaires.matchAll(/@media/g)]
  .toReversed()
  .reduce((texte, trouve) => retirer(texte, trouve.index), sansCommentaires);

const normaliser = (selecteurs: string): ReadonlyArray<string> =>
  selecteurs
    .split(",")
    .map((un) => un.trim())
    .filter((un) => un.length > 0);

/**
 * Déclarations qui s'appliquent à un sélecteur, toutes règles confondues.
 *
 * On **fusionne** dans l'ordre du fichier plutôt que de ne garder le dernier
 * bloc : c'est le comportement du navigateur, et c'est aussi le seul moyen
 * d'interroger un sélecteur qui est ciblé par une règle groupée
 * (`.chat > .notice, .chat > .messages__empty`) ou redéclaré plus bas.
 */
const bloc = (selecteur: string): Record<string, string> => {
  const resultat: Record<string, string> = {};
  // `(?<=[{}])` et non `(?:^|[{}])` : cette forme **consommerait** la
  // accolade fermante, et `matchAll` repartirait après elle — le bloc suivant
  // n'aurait plus de délimiteur à reconnaître et serait ignoré.
  for (const trouve of inconditionnel.matchAll(/(?<=[{}]|^)\s*([^{}]*?)\s*\{([^}]*)\}/g)) {
    const liste = normaliser(trouve[1] ?? "");
    if (!liste.includes(selecteur)) continue;
    for (const ligne of (trouve[2] ?? "").split(";")) {
      const deuxPoints = ligne.indexOf(":");
      if (deuxPoints < 0) continue;
      resultat[ligne.slice(0, deuxPoints).trim()] = ligne.slice(deuxPoints + 1).trim();
    }
  }
  if (Object.keys(resultat).length === 0) {
    throw new Error(`bloc « ${selecteur} » absent de styles.css`);
  }
  return resultat;
};

const token = (nom: string): string => {
  const trouve = new RegExp(`--${nom}:\\s*([^;]+);`).exec(css);
  if (trouve?.[1] === undefined) throw new Error(`token --${nom} absent`);
  return trouve[1].trim();
};

/** Profondeur d'imbrication des `<div>` juste avant `index`. */
const profondeurDiv = (index: number): number => {
  const avant = source.slice(0, index);
  return (avant.match(/<div[\s>]/g)?.length ?? 0) - (avant.match(/<\/div>/g)?.length ?? 0);
};

/**
 * Index de l'élément `.classe`, **sur sa balise ouvrante**.
 *
 * Mesurer sur l'attribut compterait la balise elle-même : `<div className=
 * "messages">` contient `className="messages"` quelques caractères après le
 * `<div`, et le `<div` serait compté comme déjà ouvert. On recule donc jusqu'à
 * la balise.
 */
const positionDe = (classe: string): number => {
  const index = source.indexOf(`className="${classe}"`);
  if (index < 0) throw new Error(`élément .${classe} absent de ChatScreen.tsx`);
  return source.lastIndexOf("<", index);
};

describe("U07 — le composeur reste hors du fil", () => {
  test("composeur et fil sont des frères, pas imbriqués", () => {
    // C'est le cœur de D016.2 : un composeur dans le conteneur défilant part
    // avec le contenu, et le clavier iOS se bat avec le défilement.
    expect(profondeurDiv(positionDe("messages"))).toBe(profondeurDiv(positionDe("composer")));
  });

  test("l'en-tête est lui aussi frère du fil", () => {
    expect(profondeurDiv(positionDe("screen__head"))).toBe(profondeurDiv(positionDe("messages")));
  });

  test("l'en-tête porte le titre et l'état, pas seulement le nom", () => {
    const blocEntete = source.slice(source.indexOf('className="screen__head"'));
    const fin = blocEntete.indexOf("</header>");
    const contenu = blocEntete.slice(0, fin < 0 ? undefined : fin);
    expect(contenu).toContain("agentName(agent)");
    expect(contenu).toContain("headerContext(agent)");
  });
});

describe("U07 — le fil prend la place restante, et seulement celle-là", () => {
  test(".chat est une colonne flex qui peut rétrécir", () => {
    const c = bloc(".chat");
    expect(c["flex-direction"]).toBe("column");
    // Sans `min-height: 0`, un enfant flex refuse de descendre sous la taille
    // de son contenu : `.messages` ne défile alors pas du tout.
    expect(c["min-height"]).toBe("0");
    expect(c["overflow"]).toBe("hidden");
  });

  test("seul le fil défile", () => {
    const fil = bloc(".chat .messages");
    expect(fil["overflow-y"]).toBe("auto");
    expect(fil["flex"]).toBe("1 1 auto");
    expect(fil["min-height"]).toBe("0");
    expect(fil["overscroll-behavior"]).toBe("contain");
  });

  test("en-tête, composeur et état d'envoi ne rétrécissent jamais", () => {
    // `flex: 0 0 auto` : ces trois-là gardent leur place quand la place manque.
    expect(bloc(".chat .screen__head")["flex"]).toBe("0 0 auto");
    expect(bloc(".chat .composer")["flex"]).toBe("0 0 auto");
    expect(bloc(".chat .sendState")["flex"]).toBe("0 0 auto");
  });

  test("l'application ne défile pas en dehors d'elle-même", () => {
    // `100dvh` + `overflow: hidden` : quand le clavier s'ouvre, c'est
    // l'application qui rétrécit. Sinon la page entière remontait.
    expect(bloc(".app")["height"]).toBe("100dvh");
    expect(bloc(".app")["overflow"]).toBe("hidden");
  });
});

describe("U07 — un avertissement ne se fait pas écraser", () => {
  const borne = /^(?:\d+(?:\.\d+)?%|(?:max-)?content|auto)$/;

  test("les notifications du Chat ne rétrécissent pas", () => {
    // `flex-shrink` vaut 1 par défaut : à 320×568, l'avertissement « aucun
    // chemin de session » se retrouvait coupé, texte tronqué, sans signal.
    const c = bloc(".chat > .notice");
    expect(c["flex-shrink"]).toBe("0");
    expect(c["overflow-y"]).toBe("auto");
    // Sans plafond, un avertissement long mange le fil entier.
    expect(borne.test(c["max-height"] ?? "")).toBe(true);
  });

  test("l'état vide est plafonné lui aussi", () => {
    expect(borne.test(bloc(".chat > .messages__empty")["max-height"] ?? "")).toBe(true);
  });
});

describe("U07 — le clavier ne déclenche ni zoom ni chevauchement", () => {
  test("le champ de saisie est à 16 px, sinon Safari zoome", () => {
    // En dessous de 16 px, Safari iOS zoome à la mise au point et
    // l'utilisateur doit redresser lui-même — sur le composeur, à chaque
    // frappe.
    expect(bloc("textarea")["font-size"]).toBe("16px");
    expect(bloc(".composer textarea")["resize"]).toBe("none");
  });

  test("le composeur garde la zone sûre du bas", () => {
    expect(bloc(".composer")["padding"]).toContain("env(safe-area-inset-bottom)");
  });

  test("les actions de l'en-tête restent au minimum tactile", () => {
    expect(token("tap-min")).toBe("44px");
    expect(bloc(".back")["min-height"]).toBe("var(--tap-min)");
    expect(bloc(".back")["white-space"]).toBe("nowrap");
  });

  test("le titre est tronqué, jamais empilé sur trois lignes", () => {
    // Un titre qui se replie fait grandir l'en-tête et pousse le fil hors de
    // l'écran ; le retour se coupait en deux avec.
    for (const selecteur of [".screen__title strong", ".screen__title > div"]) {
      const c = bloc(selecteur);
      expect(c["white-space"]).toBe("nowrap");
      expect(c["text-overflow"]).toBe("ellipsis");
      expect(c["overflow"]).toBe("hidden");
    }
    expect(bloc(".screen__title")["min-width"]).toBe("0");
  });

  test("la fenêtre déclare le redimensionnement au clavier", () => {
    const html = readFileSync(join(import.meta.dir, "..", "index.html"), "utf8");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain("interactive-widget=resizes-content");
    // ⚠️ Pas de `maximum-scale` ni `user-scalable=no` : interdire le zoom
    // casserait la lecture pour qui en a besoin.
    expect(html).not.toContain("user-scalable=no");
    expect(html).not.toContain("maximum-scale");
  });
});

describe("U07 — 320 px de large", () => {
  const etroit = requete("max-width: 360px");

  test("la requête existe : sans elle, rien n'adapte l'en-tête", () => {
    expect(etroit).not.toBe("");
    expect(etroit).toContain(".screen__head");
  });

  test("les actions se resserrent, mais gardent 44 px de haut", () => {
    const action = /\.screen__head \.row__action \{([^}]*)\}/.exec(etroit)?.[1];
    expect(action).toBeDefined();
    expect(action ?? "").toContain("padding: 6px 7px");
    // ⚠️ La requête ne doit toucher **que la largeur**. Réduire la hauteur
    // casserait le minimum tactile de 44 px, qui vient du bouton de base.
    expect(action ?? "").not.toContain("height");
    expect(token("tap-min")).toBe("44px");
  });

  test("le compte de fichiers disparaît, le libellé reste", () => {
    expect(etroit).toContain(".chat__files-count");
    expect(etroit).toMatch(/\.chat__files-count \{\s*display: none;/);
    // Le compte est bien le seul élément masqué : « Fichiers » reste lisible.
    const depart = positionDe("row__action");
    const bouton = source.slice(depart, depart + 700);
    expect(bouton).toContain("chat__files-count");
    expect(bouton).toContain("{files.length}");
  });

  test("le composeur se resserre aussi", () => {
    expect(/\.composer \{([^}]*)\}/.exec(etroit)?.[1]).toContain("padding-left: 8px");
  });
});
