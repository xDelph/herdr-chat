/**
 * Préférences d'affichage — quatre réglages, un seul endroit.
 *
 * ⚠️ **Pourquoi ils vivent ensemble, et pourquoi le module a change de nom deux
 * fois.** Le thème, le rendu des marques et le regroupement de la liste sont la
 * **meme mecanique** : une valeur validee, un defaut, une lecture tolerante du
 * stockage, une ecriture protegee. Trois fichiers auraient duplique ces quatre
 * choses — et une validation dupliquee finit toujours par diverger. Le nom du
 * module suit donc ce qu'il contient, plutot que le premier reglage qu'on y a
 * mis (`theme.ts`, puis `apparence.ts`, puis `preferences.ts`).
 *
 * ⚠️ **Deux familles, et il ne faut pas les confondre.** Le theme et les marques
 * sont poses en **attribut sur `<html>`** : le CSS fait le reste, sans qu'aucun
 * composant ne se redessine. Le **regroupement** n'a pas d'attribut — c'est la
 * structure de la liste qui change, donc React doit le savoir. `retenirGroupement`
 * ne fait que l'enregistrer, et l'appelant le garde dans son etat.
 *
 * ⚠️ **Thèmes d'affichage — trois ambiances, un seul jeu de rôles.**
 *
 * ⚠️ **Un thème ne recolore pas les couleurs de *sens*.** « terminé »,
 * « en attente d'une réponse », « en échec » gardent leur définition d'un thème à
 * l'autre. Un thème rouge dont l'échec serait vert, ou un thème vert dont
 * l'attente serait rouge, ne serait plus un thème : ce serait un mensonge
 * d'interface. `styles.css` ne surcharge donc que ce qui décrit l'**ambiance** —
 * fond, surfaces, bordures, accent, texte secondaire — et jamais l'état d'un
 * agent.
 *
 * ⚠️ **Ces préférences sont enregistrées, et c'est le seul état que
 * l'application écrit sur le disque.** Le refus du stockage local porte sur le
 * **contenu** : un brouillon non envoyé ne doit pas survivre à un redémarrage
 * (voir `brouillons.ts`, qui garde la règle inverse et pour cette raison). Un
 * choix d'affichage n'est pas du contenu : le redemander à chaque ouverture
 * serait une corvée pour rien.
 */

/** Les trois ambiances. L'ordre est celui du sélecteur. */
export const THEMES = ["blue", "green", "red"] as const;
export type Theme = (typeof THEMES)[number];

/** Le thème de base : c'est la palette écrite sur `:root` dans `styles.css`. */
export const THEME_DEFAUT: Theme = "blue";

export const THEME_LABEL: Record<Theme, string> = {
  blue: "Blue",
  green: "Green",
  red: "Red",
};

const CLE_THEME = "herdr-chat.theme";
const CLE_MARQUE = "herdr-chat.marques";
const CLE_GROUPEMENT = "herdr-chat.groupement";

/**
 * Token CSS de la pastille de chaque thème, dans le sélecteur de réglages.
 *
 * ⚠️ La table est **typée sur `Theme`** : ajouter un thème sans lui donner de
 * pastille ne compile pas. Mais le compilateur ne peut pas vérifier que le
 * **token** pointe sur la bonne couleur — c'est `contraste.test.ts` qui s'en
 * charge, puisqu'une pastille qui ment ferait choisir autre chose que ce qu'on
 * croit.
 */
export const PASTILLE: Record<Theme, string> = {
  blue: "pastille-blue",
  green: "pastille-green",
  red: "pastille-red",
};

/** Le seul endroit qui décide si une valeur est un thème. */
export const estTheme = (valeur: string | null | undefined): valeur is Theme =>
  valeur !== null && valeur !== undefined && (THEMES as ReadonlyArray<string>).includes(valeur);

/**
 * Thème à appliquer, à partir de ce qui a été enregistré.
 *
 * ⚠️ Une valeur inconnue — thème retiré dans une version ultérieure, stockage
 * modifié à la main — retombe sur le **défaut** et ne lève pas. Une application
 * qui refuse de s'afficher parce qu'une préférence est illisible serait un bien
 * plus grand défaut que la préférence perdue.
 */
export const themeEnregistre = (valeur: string | null | undefined): Theme =>
  estTheme(valeur) ? valeur : THEME_DEFAUT;

/** Valeur posée dans l'attribut `data-theme` de `<html>`. */
export const attributDeTheme = (theme: Theme): string => theme;

/**
 * Écriture du stockage — tolérante : Safari en navigation privée peut lever.
 *
 * ⚠️ **Un seul point d'écriture pour les deux réglages.** Une exception avalée
 * par l'un et pas par l'autre laisserait le second casser la mise à jour de
 * l'apparence, et le défaut ne se verrait que sur iPhone en navigation privée.
 */
const ecrireStockage = (cle: string, valeur: string): void => {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // Navigation privée : le réglage vaut pour cette session, et c'est tout.
  }
};

/** Lecture du stockage — tolérante, pour la même raison. */
const lireStockage = (cle: string): string | null => {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
};

export const lireTheme = (): Theme => themeEnregistre(lireStockage(CLE_THEME));

/**
 * Couleur de la barre système, **lue dans le CSS**.
 *
 * ⚠️ La valeur n'est pas recopiée ici. Deux copies de la même palette divergent
 * toujours, et la barre système resterait bleue sous un thème vert sans que rien
 * ne le signale — le genre d'écart qu'aucun test ne rattrape parce qu'il ne casse
 * rien.
 */
export const couleurDeBarre = (racine: Element): string =>
  getComputedStyle(racine).getPropertyValue("--bg").trim();

/**
 * Aligne la couleur de la barre système sur le thème en vigueur.
 *
 * ⚠️ **Appelée deux fois, et ce n'est pas une precaution inutile.** Quand le
 * serveur envoie son `index.html`, la feuille de style peut ne pas être encore
 * appliquée : `--bg` est alors vide, et la barre système resterait sur la
 * couleur écrite en dur dans `index.html` — bleue, sous un thème vert, jusqu'à
 * ce que quelqu'un change de thème à la main. `main.tsx` la rappelle donc sur
 * `load`, une fois le CSS en place. L'**attribut**, lui, est posé tout de suite :
 * c'est lui qui décide de l'apparence.
 */
export const rafraichirCouleurDeBarre = (): void => {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) return;
  const fond = couleurDeBarre(document.documentElement);
  if (fond.length > 0) meta.setAttribute("content", fond);
};

/**
 * Applique un thème et le retient.
 *
 * L'attribut est posé **même pour le thème de base** : `data-theme="blue"` ne
 * correspond à aucun bloc CSS (la palette de base EST `:root`), et c'est voulu —
 * mais l'attribut reste lisible dans l'inspecteur, ce qui évite de se demander
 * quel thème est actif.
 */
export const appliquerTheme = (theme: Theme): void => {
  document.documentElement.dataset["theme"] = attributDeTheme(theme);
  rafraichirCouleurDeBarre();
  ecrireStockage(CLE_THEME, theme);
};

/**
 * Rendu des **marques d'agents** : couleurs d'origine, ou couleur du thème.
 *
 * ⚠️ **Les couleurs d'origine sont le défaut, et c'est un choix de l'utilisateur
 * avant d'être le mien.** Une marque est dessinée dans ses couleurs : les
 * remplacer par l'accent du thème rend la liste homogène, ce qui plaît sur un
 * écran — mais fait perdre la reconnaissance immédiate, qui est justement la
 * raison d'afficher un logo plutôt qu'un point coloré. L'option existe donc, et
 * son défaut est le logo tel que son éditeur le publie.
 *
 * ⚠️ Les deux rendus sortent des **mêmes tracés** : le CSS écrase les `fill`
 * (voir `styles.css`). Deux jeux de chemins auraient divergé au premier
 * changement de marque.
 */
export const STYLES_MARQUE = ["standard", "theme"] as const;
export type StyleMarque = (typeof STYLES_MARQUE)[number];

export const STYLE_MARQUE_DEFAUT: StyleMarque = "standard";

export const STYLE_MARQUE_LABEL: Record<StyleMarque, string> = {
  standard: "Standard",
  theme: "Match theme",
};

/** Le seul endroit qui décide si une valeur est un rendu de marque. */
export const estStyleMarque = (valeur: string | null | undefined): valeur is StyleMarque =>
  valeur !== null &&
  valeur !== undefined &&
  (STYLES_MARQUE as ReadonlyArray<string>).includes(valeur);

/** Rendu des marques à appliquer, ou le défaut. Jamais d'exception. */
export const styleMarqueEnregistre = (valeur: string | null | undefined): StyleMarque =>
  estStyleMarque(valeur) ? valeur : STYLE_MARQUE_DEFAUT;

/** Valeur posée dans l'attribut `data-marques` de `<html>`. */
export const attributDeStyleMarque = (style: StyleMarque): string => style;

export const lireStyleMarque = (): StyleMarque => styleMarqueEnregistre(lireStockage(CLE_MARQUE));

/** Applique le rendu des marques et le retient. */
export const appliquerStyleMarque = (style: StyleMarque): void => {
  document.documentElement.dataset["marques"] = attributDeStyleMarque(style);
  ecrireStockage(CLE_MARQUE, style);
};

/**
 * Regroupement de la liste des conversations.
 *
 * ⚠️ **Pourquoi ce reglage existe, et pourquoi son defaut ne change pas.** Le
 * regroupement par **etat** repond a « qu'est-ce qui m'attend ? » : un agent
 * bloque passe en tete, et c'est la seule categorie qui appelle une action. Le
 * regroupement par **projet** repond a « ou en est tel chantier ? », ce qui devient
 * necessaire quand le nombre d'agents grandit — dix onglets etales dans trois
 * sections ne disent plus a quel projet ils appartiennent.
 *
 * ⚠️ **Le second ne remplace pas le premier : il le precede.** Ce qui demande une
 * action (bloque) ou signale une activite (au travail) reste en tete et **n'est
 * pas decoupe par projet** — le decouper obligerait a ouvrir chaque groupe pour
 * trouver ce qui attend, ce qui annule la raison de le mettre en tete. Seul le
 * reste — finis, au repos — est range par projet : c'est la masse, et c'est elle
 * qui devient illisible quand les agents se multiplient.
 *
 * ⚠️ Une premiere version rangeait *tout* par projet. Corrige apres usage : un
 * agent bloque se retrouvait disperse dans le sien, alors qu'il etait le seul a
 * demander une reponse.
 */
export const GROUPEMENTS = ["statut", "projet"] as const;
export type Groupement = (typeof GROUPEMENTS)[number];

export const GROUPEMENT_DEFAUT: Groupement = "statut";

export const GROUPEMENT_LABEL: Record<Groupement, string> = {
  statut: "By status",
  projet: "By workspace",
};

/** Le seul endroit qui decide si une valeur est un regroupement. */
export const estGroupement = (valeur: string | null | undefined): valeur is Groupement =>
  valeur !== null &&
  valeur !== undefined &&
  (GROUPEMENTS as ReadonlyArray<string>).includes(valeur);

/**
 * Regroupement à appliquer, ou le défaut. Jamais d'exception, comme les autres :
 * une préférence illisible ne doit pas empêcher l'écran de s'afficher.
 */
export const groupementEnregistre = (valeur: string | null | undefined): Groupement =>
  estGroupement(valeur) ? valeur : GROUPEMENT_DEFAUT;

export const lireGroupement = (): Groupement => groupementEnregistre(lireStockage(CLE_GROUPEMENT));

/**
 * Retient le regroupement.
 *
 * ⚠️ **« Retenir », et pas « appliquer »** — les autres réglages posent un
 * attribut, celui-ci n'a rien à poser : la structure de la liste est construite
 * par un composant, qui doit donc garder la valeur dans son état. Un nom qui
 * dirait « appliquer » laisserait croire qu'un attribut suffit, et le réglage
 * aurait l'air de ne rien faire.
 */
export const retenirGroupement = (groupement: Groupement): void => {
  ecrireStockage(CLE_GROUPEMENT, groupement);
};
