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

const css = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8");
const brut = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");

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

  test("le shell utilise le flux viewport et seule sa liste défile", () => {
    // Éviter fixed/sticky sur le shell dans les PWA iOS autonomes : WebKit
    // peut les déplacer au scroll. Le flex garde le footer hors du scroller.
    //
    // ⚠️ **Un seul élément possède la boîte viewport, et c'est `#root`.** Avant,
    // `#root` valait `100dvh` et `.app` recalculait la même chose : deux
    // propriétaires pour une seule mesure. En mode installé sur iOS, `100dvh`
    // est calculé COURT (la hauteur de la barre d'état, ~54 px) — d'où la bande
    // blanche en bas de l'écran. La mesure vient maintenant de
    // `--app-viewport-height`, écrite depuis `window.innerHeight`, et `.app` se
    // contente de remplir la racine.
    expect(bloc("#root")["height"]).toBe("var(--app-viewport-height, 100dvh)");
    expect(bloc("#root")["top"]).toBe("var(--app-viewport-top, 0px)");
    expect(bloc(".app")["height"]).toBe("100%");
    expect(bloc(".app")["position"]).toBe("relative");
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

  test("le composeur dégage la barre d'accueil iOS, sans jamais créer de vide", () => {
    /*
      ⚠️ Ce test interdisait `safe-area-inset-bottom`. Il avait raison **à
      l'époque** : la boîte du shell était trop courte, donc l'inset s'ajoutait
      à un vide déjà présent et l'aggravait. Maintenant que le shell atteint le
      vrai bord bas, l'inset fait le contraire — il empêche l'indicateur
      d'accueil de recouvrir le champ.

      Deux garanties opposées, donc, et les deux sont testées :
      - l'inset est un **margin** (il pousse le champ), jamais une hauteur ;
      - il est **plancher** à 10 px, donc il ne peut pas rapetisser la pastille.
    */
    const composeur = bloc(".composer");
    expect(composeur["margin"]).toBe("6px 12px max(10px, env(safe-area-inset-bottom))");
    expect(composeur["padding"]).not.toContain("safe-area-inset-bottom");
    // Le bouton flottant est dans le pied de page : même remède, même endroit.
    expect(bloc(".app__footer")["padding"]).toContain("env(safe-area-inset-bottom)");
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

  test("le compte de fichiers passe dans le nom accessible", () => {
    /*
      ⚠️ U21 : « Fichiers · 16 » et « Modèle » sont devenus des **icônes**.
      Deux boutons à libellé occupaient la moitié de l'en-tête à 320 px et
      affamaient le titre.
      L'information n'est pas perdue : le compte est dans le nom accessible, donc
      lu par un lecteur d'écran, et l'écran de fichiers le montre.
    */
    const ecran = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");
    expect(ecran).toContain("aria-label={`Files changed (${String(files.length)})`}");
    expect(ecran).not.toContain("chat__files-count");
    expect(ecran).toContain('aria-label="Model and thinking"');
    expect(ecran).not.toContain(">Model<");
  });

  test("le composeur se resserre aussi", () => {
    expect(/\.composer \{([^}]*)\}/.exec(etroit)?.[1]).toContain("padding-left: 8px");
  });
});

describe("U19 — la conversation se lit comme un document", () => {
  test("ta demande est une bulle, la réponse de l'agent n'en a pas", () => {
    /*
      ⚠️ C'est le changement qui pèse le plus sur la lecture. Une réponse est
      longue, structurée, avec des listes et du code ; l'enfermer dans une bulle
      rétrécit sa largeur et hache le texte. Sur fond nu, elle occupe toute la
      largeur et se lit comme un document — c'est aussi la disposition de Codex.
    */
    const bulle = bloc(".bubble--user");
    expect(bulle["align-self"]).toBe("flex-end");
    expect(bulle.background).toBe("var(--surface-2)");

    const reponse = bloc(".bubble--assistant");
    expect(reponse.background).toBe("none");
    expect(reponse["align-self"]).toBe("stretch");
    expect(reponse["max-width"]).toBe("100%");
  });

  test("un groupe d'outils est une ligne, pas un cadre", () => {
    // Une session réelle compte des centaines d'appels : encadrés un par un,
    // les réponses disparaissent dans le bruit.
    expect(bloc(".group")["border"]).toBe("none");
    // Aucun filet non plus : l'espacement sépare (U26).
    expect(bloc(".group__head")["border"]).toBe("none");
    // Et la ligne s'annonce comme dépliable par un chevron **dans** la première
    // ligne — en `::after` du bouton, il tombait sur une troisième ligne.
    expect(bloc(".group__chevron")["margin-left"]).toBe("auto");
    expect(css).not.toContain(".group__head::after");
  });

  test("le composeur est une pastille flottante, pas une barre", () => {
    const composeur = bloc(".composer");
    // ⚠️ U26 : `--radius-field` (22 px) et non `--radius-pill`. Un galet de
    // 56 px de haut pour un champ d'une ligne, ce n'est pas iOS.
    expect(composeur["border-radius"]).toBe("var(--radius-field)");
    expect(composeur.background).toBe("var(--surface-2)");
    // Pas de filet de séparation : la pastille se détache déjà.
    expect(composeur["border-top"]).toBeUndefined();
    // Et il reste un enfant de la colonne : c'est ce qui l'empêche de partir
    // avec le contenu en défilant.
    expect(bloc(".chat .composer")["flex"]).toBe("0 0 auto");
  });

  test("les métadonnées passent sous le message", () => {
    // Au-dessus, elles s'interposent entre deux messages qu'on enchaîne.
    const blocs = readFileSync(join(import.meta.dir, "..", "src", "Blocks.tsx"), "utf8");
    const corps = blocs.slice(blocs.indexOf("const MessageBubble"));
    expect(corps.indexOf("bubble__role")).toBeGreaterThan(corps.indexOf("BlockView"));
    expect(bloc(".bubble__role")["display"]).toBe("block");
  });

  test("la flèche de retour est un glyphe, avec un nom accessible", () => {
    // « ‹ Retour » en toutes lettres occupait la largeur du titre à 320 px.
    const ecran = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");
    expect(ecran).toContain('aria-label="Back"');
    expect(ecran).not.toContain("‹ Back");
    // La cible tactile reste au minimum, même sans texte.
    expect(bloc(".chat .back")["min-width"]).toBe("var(--tap-min)");
    expect(bloc(".chat .back")["border"]).toBe("none");
  });
});

describe("U20 — le bouton d'envoi suit la forme d'iOS", () => {
  const ecran = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");

  test("un rond, pas un bouton à libellé", () => {
    // ⚠️ « Envoyer » en toutes lettres occupait un tiers de la largeur de la
    // pastille à 320 px, alors que l'action est évidente et unique.
    const bouton = bloc(".composer .send");
    expect(bouton["border-radius"]).toBe("var(--radius-pill)");
    expect(bouton["min-height"]).toBe("var(--tap-min)");
    expect(bouton["min-width"]).toBe("var(--tap-min)");
    // Le libellé a quitté l'écran : ce qui reste est la flèche.
    expect(ecran).toContain('<span aria-hidden="true">↑</span>');
    expect(ecran).not.toContain('"Envoyer"}');
  });

  test("la cible tactile reste à 44 px, même pour une forme", () => {
    // Le minimum ne se négocie pas : un rond de 32 px serait joli et
    // inatteignable au pouce.
    expect(bloc(".composer .send")["min-width"]).toBe("var(--tap-min)");
  });

  test("le libellé disparaît de l'écran mais reste lu", () => {
    expect(ecran).toContain('aria-label="Send"');
    expect(ecran).toContain('aria-hidden="true"');
  });

  test("il est éteint quand le champ est vide", () => {
    // Comportement d'iOS : il dit avant l'appui qu'il n'y a rien à envoyer. Un
    // bouton actif qui ne fait rien laisse croire à une panne.
    expect(ecran).toContain('phase !== "ready" || sending || draft.trim().length === 0');
    expect(bloc(".composer .send:disabled").background).toBe("var(--surface)");
  });
});

describe("U21 — un travail se raconte, puis se replie", () => {
  const blocs = readFileSync(join(import.meta.dir, "..", "src", "Blocks.tsx"), "utf8");

  test("un bloc de travail s'ouvre pendant l'activité et se replie à la réponse finale", () => {
    // ⚠️ Le repli ne dépend plus d'un remontage (`key`), mais d'une règle
    // explicite : `open` vaut `enCours` tant que l'utilisateur n'a pas tranché.
    expect(blocs).toContain("const open = manuel ?? enCours;");
    expect(blocs).toContain("setManuel((valeur) => !(valeur ?? enCours))");
    // Et l'ancienne dépendance accidentelle reste présente pour l'instant.
    expect(blocs).toContain("`latest-work-${enCours && item === items.at(-1)}`");
  });

  test("l'échec annoncé par le badge a un répondant visible", () => {
    // Sinon l'en-tête annonce « échec » et rien à l'écran ne dit **lequel**.
    expect(blocs).toContain("ligne.enEchec");
    expect(blocs).toContain("ligne__verbe--echec");
    const actions = readFileSync(join(import.meta.dir, "..", "src", "actions.ts"), "utf8");
    expect(actions).toContain("precedente.enEchec = true");
  });

  test("une ligne de travail est repliée par défaut", () => {
    // Même quand le groupe est ouvert : trois détails dépliés noient le résumé.
    expect(blocs).toContain("const [open, setOpen] = useState(false);");
  });

  test("les jetons sont ceux du travail, et sous le titre", () => {
    expect(blocs).toContain("coutDuGroupe(item.messages)");
    expect(blocs).toContain("jetonsCourts(cout.jetons)");
    // Et ils ont quitté la ligne des métadonnées d'un message.
    const bulle = blocs.slice(blocs.indexOf("const MessageBubble"));
    expect(bulle.slice(0, 900)).not.toContain('meta["tokens"]');
    expect(bulle.slice(0, 900)).not.toContain('meta["model"]');
  });

  test("l'en-tête du chat porte le titre de la conversation", () => {
    const ecran = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");
    expect(ecran).toContain("{agent.title ?? agentName(agent)}");
    // Le contexte reste dessous : de quel agent et de quel projet il s'agit.
    expect(ecran).toContain("headerContext(agent)");
  });

  test("les lignes internes ont leurs styles", () => {
    // Une ligne compacte, pas un cadre : c'est tout l'objet du changement.
    expect(bloc(".ligne__head")["min-height"]).toBe("36px");
    expect(bloc(".ligne__cible--lien")["text-decoration"]).toBe("underline");
    expect(bloc(".group__jetons").color).toBe("var(--muted)");
  });
});

describe("U22 — le changement se mesure sur la ligne", () => {
  const blocs2 = readFileSync(join(import.meta.dir, "..", "src", "Blocks.tsx"), "utf8");

  test("les lignes `+` et `−` sont affichées", () => {
    expect(blocs2).toContain('className="ligne__delta"');
    expect(blocs2).toContain("+{action.delta.added}");
    expect(blocs2).toContain("−{action.delta.removed}");
  });

  test("elles se taisent quand il n'y a rien à mesurer", () => {
    // ⚠️ `+0 −0` sur une commande laisserait croire à un changement constaté.
    expect(blocs2).toContain("action.delta === null ? null :");
  });

  test("les couleurs sont celles du diff lui-même", () => {
    // Le lien se fait sans y penser : `+` vert, `−` rouge, comme dans le diff.
    expect(bloc(".ligne__delta--plus").color).toBe("var(--ok)");
    expect(bloc(".ligne__delta--moins").color).toBe("var(--err)");
  });

  test("le diff d'une édition est atteignable", () => {
    // ⚠️ Il existait dans le code sans être joignable : `details: []` sur un
    // appel d'édition laissait « Fichier modifié » sans rien à déplier.
    const actions = readFileSync(join(import.meta.dir, "..", "src", "actions.ts"), "utf8");
    expect(actions).toContain("details: [block]");
    expect(blocs2).toContain("detailsAffiches.length > 0");
  });
});

describe("U23 — la ligne compacte s'applique PAR BLOC, pas par message", () => {
  const blocs3 = readFileSync(join(import.meta.dir, "..", "src", "Blocks.tsx"), "utf8");

  test("un bloc de travail devient une ligne, quel que soit son message", () => {
    /*
      ⚠️ **Le défaut que ce test ferme.** Une ligne compacte se décidait au
      niveau du message entier : `isToolOnly` exigeait que **tous** les blocs
      soient des appels d'outil. Or la forme la plus courante d'une session
      réelle est `text + thinking + toolCall` — 565 messages sur 1080 mesurés.
      Ces messages n'étaient donc **jamais** groupés, et la réflexion comme les
      éditions gardaient leur ancien bloc encadré.

      La décision doit se prendre **bloc par bloc**.
    */
    expect(blocs3).toContain("if (estBlocDeTravail(block)) {");
    expect(blocs3).toContain("return <VueDetail block={block} />;");
  });

  test("le détail ne repasse jamais par la ligne", () => {
    // Sinon : la ligne affiche son détail, qui redevient une ligne, qui
    // redemande son détail — une boucle infinie.
    expect(blocs3).toContain("const VueDetail = memo(");
    const corps = blocs3.slice(blocs3.indexOf('<div className="ligne__body">'));
    expect(corps.slice(0, 300)).toContain("<VueDetail");
    expect(corps.slice(0, 300)).not.toContain("<BlockView");
  });

  test("les quatre sortes de travail passent par la ligne", () => {
    const actions = readFileSync(join(import.meta.dir, "..", "src", "actions.ts"), "utf8");
    const garde = actions.slice(actions.indexOf("export const estBlocDeTravail"));
    for (const sorte of ["thinking", "toolCall", "toolResult", "bashExecution"]) {
      expect(garde).toContain(`block.kind === "${sorte}"`);
    }
  });

  test("la réflexion garde son icône et son verbe", () => {
    const actions = readFileSync(join(import.meta.dir, "..", "src", "actions.ts"), "utf8");
    expect(actions).toContain('icone: "brain"');
    expect(actions).toContain('singulier: "Réflexion"');
  });
});

describe("U23 — la marque dans la liste, le modèle dans l'en-tête", () => {
  const ecran = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");
  const ligne = readFileSync(join(import.meta.dir, "..", "src", "ConversationRow.tsx"), "utf8");

  test("la marque est dans la LIGNE DE CONVERSATION, devant le projet", () => {
    /*
      ⚠️ **Pas dans l'en-tête de la conversation.** La marque sert a *choisir* :
      une fois la conversation ouverte, on sait deja laquelle on regarde. Dans la
      liste, elle tombe sous l'oeil pendant qu'on parcourt.
    */
    expect(ligne).toContain("<AgentBadge kind={conversation.agent} />");
    const origine = ligne.slice(ligne.indexOf('className="conv__origine"'));
    // La marque vient AVANT le nom du projet, pas apres ni en dessous.
    expect(origine.indexOf("AgentBadge")).toBeGreaterThan(-1);
    expect(origine.indexOf("AgentBadge")).toBeLessThan(origine.indexOf("conv__projet"));
  });

  test("l'en-tête de la conversation ne porte AUCUNE marque", () => {
    // ⚠️ Le titre d'Herdr porte deja son propre signe (`π - pixel`) : une
    // seconde marque a cote se lirait comme un doublon.
    expect(ecran).not.toContain("AgentBadge");
  });

  test("le modèle et le raisonnement forment la troisième ligne de l'en-tête", () => {
    expect(ecran).toContain("{headerReglages(currentModel, currentThinking)}");
  });

  test("la marque s'aligne au centre, pas sur la ligne de base du texte", () => {
    /*
      ⚠️ `.conv__origine` aligne ses enfants sur la **ligne de base** du texte.
      Sans `align-self: center`, la pastille descend s'asseoir sur cette ligne et
      la marque trace sous le titre. Un test qui verifierait seulement la taille
      de la pastille passerait sans rien voir.
    */
    expect(bloc(".agent-badge")["align-self"]).toBe("center");
  });

  test("la marque n'usurpe pas la zone tactile d'un bouton", () => {
    // Elle est décorative : 20 px, à peine plus que le texte qu'elle précède.
    // C'est la ligne entière qui est touchable, et elle fait au moins 44 px.
    const marque = bloc(".agent-badge");
    expect(marque["height"]).toBe("20px");
    expect(marque["width"]).toBe("20px");
    expect(bloc(".conv")["min-height"]).toBe("var(--tap-min)");
  });

  test("les cinq marques existent, et sont normalisees dans une meme boite", () => {
    /*
      ⚠️ Chacune garde son `viewBox` d'origine dans `logos.tsx` : c'est le
      `transform` qui les ramene toutes a 24x24. Sans lui, la pastille
      changerait de taille d'un agent a l'autre — 800x800 pour pi, 16,65 pour
      OpenAI, 21,5 pour Cognition.
    */
    const logos = readFileSync(join(import.meta.dir, "..", "src", "logos.tsx"), "utf8");
    for (const kind of ["pi", "codex", "claude", "opencode", "devin"]) {
      expect(logos).toContain(`${kind}: (`);
    }
    expect(logos.match(/<g transform="translate\(/g)?.length).toBe(5);
    const badge = readFileSync(join(import.meta.dir, "..", "src", "AgentBadge.tsx"), "utf8");
    // ⚠️ Le `fill` porté par le `<svg>` est le **défaut des tracés sans
    // remplissage** : c'est le repli neutre, qui ne représente aucune marque.
    expect(badge).toContain('fill="currentColor"');
    expect(badge).toContain('viewBox="0 0 24 24"');
  });

  test("le CSS peut reprendre les `fill` des marques", () => {
    /*
      ⚠️ **C'est ce qui permet deux rendus sans dupliquer les tracés.** Un
      attribut de présentation SVG est la forme la plus faible de style : une
      règle CSS le bat. Si quelqu'un passait les couleurs en `style="fill: …"`
      inline, le mode « couleur du thème » cesserait de fonctionner — sans que
      rien d'autre ne casse, donc sans que personne ne s'en aperçoive.
    */
    const logos = readFileSync(join(import.meta.dir, "..", "src", "logos.tsx"), "utf8");
    expect(logos).not.toContain('style="fill');
    expect(logos).toContain('fill="#D97757"');
    expect(logos).toContain('fill="#FFFFFF"');
  });
});

describe("U23 — le sélecteur de thème", () => {
  const feuille = readFileSync(join(import.meta.dir, "..", "src", "SettingsSheet.tsx"), "utf8");

  test("les trois thèmes sont proposés, et l'état choisi est DIT", () => {
    expect(feuille).toContain("THEMES.map((option) => (");
    // ⚠️ `aria-pressed` : la couleur seule ne dirait rien à un lecteur d'écran.
    expect(feuille).toContain("aria-pressed={theme === option}");
  });

  test("le thème est appliqué tout de suite, et retenu", () => {
    expect(feuille).toContain("appliquerTheme(suivant)");
  });

  test("chaque choix porte sa pastille", () => {
    expect(feuille).toContain("theme__pastille--${option}");
  });

  test("les trois pastilles ont leur couleur, et elle ne vient pas du thème actif", () => {
    // ⚠️ Il faut voir ce qu'on choisit : la pastille verte doit être verte même
    // quand c'est le bleu qui est appliqué. Elles ne peuvent donc pas passer par
    // `--accent`, qui vaut la couleur du thème en cours.
    for (const theme of ["blue", "green", "red"]) {
      expect(bloc(`.theme__pastille--${theme}`)["background"]).toBe(`var(--pastille-${theme})`);
    }
  });

  test("un choix reste touchable au doigt", () => {
    expect(bloc(".theme__choix")["min-height"]).toBe("var(--tap-min)");
  });
});

/**
 * U19 — la barre des panes d'un onglet, et l'étiquette du pane.
 *
 * ⚠️ **Ce qui est vérifié ici est structurel**, et c'est ce qui casserait en
 * silence : la barre doit être **hors du conteneur défilant** (sinon elle
 * défile avec les messages et disparaît), elle doit porter le libellé de
 * l'étiquette **partagée** (sinon l'écran et la notification divergeraient), et
 * la ligne de liste doit la montrer sans avoir recalculé quoi que ce soit.
 */
describe("U19 — les panes d'un onglet", () => {
  const ecran = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");
  const ligne = readFileSync(join(import.meta.dir, "..", "src", "ConversationRow.tsx"), "utf8");

  test("la barre est sous l'en-tête, pas dans le fil", () => {
    // ⚠️ Le bas de l'écran est la zone stabilisée pour le clavier iOS : la barre
    // y aurait touché. Et dans `.messages`, elle aurait défilé avec le fil.
    expect(ecran).toContain("<TabPanes agents={voisins} courant={agent.paneId}");
    const barre = ecran.indexOf("<TabPanes");
    const fil = ecran.indexOf('className="messages"');
    expect(fil).toBeGreaterThan(-1);
    expect(barre).toBeLessThan(fil);
  });

  test("l'en-tête nomme le pane avec la fonction PARTAGÉE", () => {
    // ⚠️ `etiquetteDePane` vient du paquet partagé : le même texte que la ligne
    // de liste et que la notification. La recalculer ici aurait suffi à faire
    // dire à l'écran autre chose que ce que dit le téléphone.
    // ⚠️ Dans `headerContext`, qui la place **juste après le statut** : la ligne
    // est tronquée sur iPhone, et en queue l'étiquette serait la première coupée.
    const labels = readFileSync(join(import.meta.dir, "..", "src", "labels.tsx"), "utf8");
    expect(labels).toContain("const etiquette = etiquetteDePane(agent);");
    expect(ecran).toContain("headerContext(agent)");
  });

  test("la ligne de liste aussi, et avec les libellés qu'elle a déjà", () => {
    expect(ligne).toContain("etiquetteDePane({");
    expect(ligne).toContain('className="conv__pane"');
  });

  test("les voisins sont triés par rang de disposition", () => {
    // ⚠️ Pas par identifiant : l'ordre de la barre doit être celui qu'on voit sur
    // le Mac, sinon « le troisième » ne désigne rien de stable.
    const app = readFileSync(join(import.meta.dir, "..", "src", "v2", "AppShell.tsx"), "utf8");
    expect(app).toContain("paneRank ?? Number.MAX_SAFE_INTEGER");
    expect(app).toContain("candidat.tabId === agentAffiche.tabId");
  });

  test("la barre est un vrai bouton, donc touchable", () => {
    expect(bloc(".panes")["min-height"]).toBe("var(--tap-min)");
    expect(bloc(".panes__pane")["min-height"]).toBe("var(--tap-min)");
  });

  test("le current se dit aussi autrement que par la couleur", () => {
    expect(bloc('.panes__pane[aria-current="true"]')["border-bottom-color"]).toBe("var(--accent)");
  });

  test("l'étiquette du pane ne prend pas la place du projet", () => {
    // C'est un complément : plus petit, et en chiffres tabulaires pour que
    // « pane 3 » et « pane 11 » s'alignent.
    expect(bloc(".conv__pane")["font-size"]).toBe("12px");
    expect(bloc(".conv__pane")["font-variant-numeric"]).toBe("tabular-nums");
  });
});
