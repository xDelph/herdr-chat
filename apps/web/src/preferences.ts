/**
 * Préférences d'affichage — le thème et le regroupement de la liste.
 *
 * ⚠️ **Le thème suit le système par défaut.** `auto` ne pose aucun attribut :
 * c'est `prefers-color-scheme` qui décide, dans `styles/tokens.css`. `clair` et
 * `sombre` sont des **surcharges manuelles** (`data-theme="light|dark"` sur
 * `<html>`). Les couleurs de sens — à toi, travaille, terminé, erreur — ont un
 * rôle fixe dans les deux palettes : seul leur ton s'adapte au fond.
 *
 * ⚠️ **Ces préférences sont enregistrées, et c'est voulu.** Le refus du
 * stockage local porte sur le **contenu** (un brouillon non envoyé ne survit
 * pas à un redémarrage, voir `brouillons.ts`). Un choix d'affichage n'est pas du
 * contenu.
 *
 * ⚠️ Une valeur enregistrée inconnue — les anciens thèmes `blue`, `green`,
 * `red` par exemple — retombe sur le défaut sans lever : une préférence
 * illisible ne doit jamais empêcher l'écran de s'afficher.
 */

export const THEMES = ["auto", "clair", "sombre"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_DEFAUT: Theme = "auto";

export const THEME_LABEL: Record<Theme, string> = {
  auto: "Auto",
  clair: "Light",
  sombre: "Dark",
};

const CLE_THEME = "herdr-chat.theme";
const CLE_GROUPEMENT = "herdr-chat.groupement";
const CLE_ORDRE = "herdr-chat.ordre";
const CLE_MARQUES = "herdr-chat.marques";

export const estTheme = (valeur: string | null | undefined): valeur is Theme =>
  valeur !== null && valeur !== undefined && (THEMES as ReadonlyArray<string>).includes(valeur);

export const themeEnregistre = (valeur: string | null | undefined): Theme =>
  estTheme(valeur) ? valeur : THEME_DEFAUT;

/** Valeur de `data-theme` sur `<html>` — `null` : pas d'attribut, le système décide. */
export const attributDeTheme = (theme: Theme): "light" | "dark" | null =>
  theme === "clair" ? "light" : theme === "sombre" ? "dark" : null;

const ecrireStockage = (cle: string, valeur: string): void => {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // Navigation privée : le réglage vaut pour cette session, et c'est tout.
  }
};

const lireStockage = (cle: string): string | null => {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
};

export const lireTheme = (): Theme => themeEnregistre(lireStockage(CLE_THEME));

/**
 * Aligne la couleur de la barre système sur le fond **réellement appliqué**.
 *
 * La valeur est lue dans le CSS (`--ground`), jamais recopiée : deux copies de
 * la même palette finissent toujours par diverger.
 */
export const rafraichirCouleurDeBarre = (): void => {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta === null) return;
  const fond = getComputedStyle(document.documentElement).getPropertyValue("--ground").trim();
  if (fond.length > 0) meta.setAttribute("content", fond);
};

/** Pose le thème (sans l'enregistrer). */
export const poserTheme = (theme: Theme): void => {
  const attribut = attributDeTheme(theme);
  if (attribut === null) delete document.documentElement.dataset["theme"];
  else document.documentElement.dataset["theme"] = attribut;
  rafraichirCouleurDeBarre();
};

/** Applique un thème et le retient. */
export const appliquerTheme = (theme: Theme): void => {
  poserTheme(theme);
  ecrireStockage(CLE_THEME, theme);
};

/**
 * Regroupement de la liste.
 *
 * ⚠️ **« Par projet » ne disperse pas ce qui attend.** Ce qui demande une
 * décision ou travaille reste en tête, groupé par état ; seule la masse — finis
 * et au repos — est rangée par projet (voir `sections.ts`).
 */
export const GROUPEMENTS = ["statut", "projet"] as const;
export type Groupement = (typeof GROUPEMENTS)[number];

export const GROUPEMENT_DEFAUT: Groupement = "statut";

export const GROUPEMENT_LABEL: Record<Groupement, string> = {
  projet: "By project",
  statut: "By status",
};

export const estGroupement = (valeur: string | null | undefined): valeur is Groupement =>
  valeur !== null &&
  valeur !== undefined &&
  (GROUPEMENTS as ReadonlyArray<string>).includes(valeur);

export const groupementEnregistre = (valeur: string | null | undefined): Groupement =>
  estGroupement(valeur) ? valeur : GROUPEMENT_DEFAUT;

export const lireGroupement = (): Groupement => groupementEnregistre(lireStockage(CLE_GROUPEMENT));

export const retenirGroupement = (groupement: Groupement): void => {
  ecrireStockage(CLE_GROUPEMENT, groupement);
};

/**
 * L'ordre des lignes : récent d'abord (le défaut, U04), ou par nom — pour
 * retrouver une conversation dont on connaît le nom. L'ancienne app l'offrait ;
 * la réécriture l'avait figé sur « récent ».
 */
export const ORDRES_LISTE = ["recent", "nom"] as const;
export type OrdreListe = (typeof ORDRES_LISTE)[number];

export const ordreEnregistre = (valeur: string | null | undefined): OrdreListe =>
  valeur === "nom" ? "nom" : "recent";

export const lireOrdre = (): OrdreListe => ordreEnregistre(lireStockage(CLE_ORDRE));

export const retenirOrdre = (ordre: OrdreListe): void => {
  ecrireStockage(CLE_ORDRE, ordre);
};

/**
 * Le rendu des marques d'agents : leurs couleurs d'origine (le défaut), ou la
 * couleur du thème.
 *
 * ⚠️ **Les couleurs d'origine sont le défaut** : un logo sert à reconnaître un
 * agent d'un coup d'œil, ce que l'encre du thème efface. L'option existe pour
 * qui préfère une liste homogène. Les deux rendus sortent des **mêmes tracés** :
 * une règle CSS (`fiabilite.css`) force `fill: currentColor` — les `fill` de
 * `logos.tsx` sont des attributs de présentation, que n'importe quelle règle
 * écrase. Deux jeux de chemins auraient divergé au premier changement de marque.
 */
export const STYLES_MARQUE = ["standard", "theme"] as const;
export type StyleMarque = (typeof STYLES_MARQUE)[number];

export const STYLE_MARQUE_LABEL: Record<StyleMarque, string> = {
  standard: "Standard",
  theme: "Theme color",
};

export const styleMarqueEnregistre = (valeur: string | null | undefined): StyleMarque =>
  valeur === "theme" ? "theme" : "standard";

export const lireStyleMarque = (): StyleMarque => styleMarqueEnregistre(lireStockage(CLE_MARQUES));

/** Pose le rendu des marques (`data-marques` sur `<html>`), sans l'enregistrer. */
export const poserStyleMarque = (style: StyleMarque): void => {
  document.documentElement.dataset["marques"] = style;
};

/** Applique le rendu des marques et le retient. */
export const appliquerStyleMarque = (style: StyleMarque): void => {
  poserStyleMarque(style);
  ecrireStockage(CLE_MARQUES, style);
};
