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

/** La feuille de style est la source de vérité du thème. */
export const css = readFileSync(join(import.meta.dir, "styles.css"), "utf8");

/** Le minimum du tableau des règles. */
export const MINIMUM = 4.5;

/** Valeur d'un token du thème. */
export const token = (nom: string): string => {
  const trouve = new RegExp(`--${nom}:\\s*([^;]+);`).exec(css);
  if (trouve?.[1] === undefined) throw new Error(`token --${nom} absent`);
  return trouve[1].trim();
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
