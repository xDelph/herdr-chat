/**
 * Mesure de contraste — **source unique** (U03, U16).
 *
 * ⚠️ Le calcul était écrit dans le fichier de test lui-même. Un second fichier
 * qui veut mesurer un couple aurait recopié la formule — et deux recopies de la
 * formule WCAG finissent toujours par divergir, silencieusement, sur une
 * couleur de moins.
 *
 * La mesure ne se discute pas : c'est la formule WCAG 2.1 appliquée aux tokens
 * **réellement déclarés** dans `styles.css`. Une valeur estimée à l'œil ne
 * protège rien.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_DEFAUT, type Theme } from "./preferences.ts";

/**
 * La feuille de style — **commentaires retirés**.
 *
 * ⚠️ Ce n'est pas du confort. Les commentaires de ce fichier parlent des tokens
 * et des sélecteurs (« `:root[data-theme="blue"]` n'existe pas », « si
 * quelqu'un change `--muted`… ») : lus tels quels, ils feraient passer un test
 * sur une règle qui n'existe pas, et échouer un autre sur une règle qui existe.
 * Ce qui se mesure, ce sont les **règles**. Exporter la version nettoyée évite
 * que chaque fichier de test réinvente son propre découpage.
 */
export const css = readFileSync(join(import.meta.dir, "styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Le minimum du tableau des règles. */
export const MINIMUM = 4.5;

/** Valeur d'un token du thème — celle de `:root`, c'est-à-dire du thème de base. */
export const token = (nom: string): string => {
  const trouve = new RegExp(`--${nom}:\\s*([^;]+);`).exec(css);
  if (trouve?.[1] === undefined) throw new Error(`token --${nom} absent`);
  return trouve[1].trim();
};

/**
 * Corps du bloc CSS d'un sélecteur.
 *
 * Les blocs de thème ne contiennent aucune accolade imbriquée : la première
 * accolade fermante est donc bien la bonne.
 */
const corpsDe = (selecteur: string): string => {
  const debut = css.indexOf(selecteur);
  if (debut < 0) throw new Error(`bloc CSS absent : ${selecteur}`);
  const ouvrante = css.indexOf("{", debut);
  const fermante = css.indexOf("}", ouvrante);
  return css.slice(ouvrante + 1, fermante);
};

/**
 * Valeur d'un token **pour un thème donné**.
 *
 * ⚠️ `token()` prend la **première** déclaration du fichier : avec trois thèmes,
 * il ne lirait jamais que celui de base, et les deux autres passeraient le test
 * de contraste **sans que personne ne les ait mesurés**. C'est le genre de
 * vérification qui a l'air de servir et ne sert à rien — exactement ce que U03
 * existe pour empêcher.
 *
 * ⚠️ Un token que le thème ne surcharge pas **hérite** de `:root` : c'est la
 * règle CSS ordinaire, et on la suit au lieu de la refuser.
 */
export const tokenDuTheme = (nom: string, theme: Theme): string => {
  const corps = theme === THEME_DEFAUT ? corpsDe(":root {") : corpsDe(`data-theme="${theme}"`);
  const trouve = new RegExp(`--${nom}:\\s*([^;]+);`).exec(corps);
  return trouve?.[1]?.trim() ?? token(nom);
};

/** Luminance relative — formule WCAG 2.1. */
const luminance = (hex: string): number => {
  const hexa = hex.replace("#", "");
  const canal = (offset: number): number => {
    const valeur = Number.parseInt(hexa.slice(offset, offset + 2), 16) / 255;
    return valeur <= 0.03928 ? valeur / 12.92 : ((valeur + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
};

/** Rapport de contraste entre deux couleurs hexadécimales. */
export const ratio = (premier: string, second: string): number => {
  const a = luminance(premier);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
