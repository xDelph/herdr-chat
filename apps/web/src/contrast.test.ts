/**
 * Contrastes du thème — **mesurés**, pas estimés (U03).
 *
 * Le tableau des règles impose 4,5:1 pour le texte normal. Ces tests calculent
 * la luminance relative de chaque couple couleur/fond réellement utilisé et
 * échouent si l'un passe sous le minimum — ou sous la marge déclarée dans
 * `styles.css`.
 *
 * ⚠️ Une valeur estimée à l'œil ne protège rien. Ces nombres viennent de la
 * formule WCAG 2.1, appliquée aux tokens du thème : si quelqu'un change
 * `--muted`, le test tombe ici, pas dans le rapport d'un utilisateur.
 *
 * ⚠️ **Les trois thèmes y passent, et c'est tout l'intérêt.** Le lecteur de token
 * prenait la **première** déclaration du fichier : avec un thème vert et un thème
 * rouge ajoutés après `:root`, il n'aurait jamais lu qu'un seul jeu de couleurs —
 * et les deux autres auraient été déclarés conformes sans avoir été mesurés une
 * seule fois.
 */
import { describe, expect, test } from "bun:test";
import { MINIMUM, ratio, token, tokenDuTheme } from "./contraste.ts";
import { PASTILLE, THEMES, THEME_DEFAUT, type Theme } from "./preferences.ts";

/**
 * Les couples *texte/fond* réellement utilisés, par leur rôle.
 *
 * ⚠️ Les trois derniers — `ok`, `warn`, `err` — ne viennent **jamais** du thème :
 * ce sont les couleurs de sens, partagées. Le test les remesure quand même pour
 * chaque thème, parce que le fond sous elles, lui, change.
 */
const COUPLES: ReadonlyArray<readonly [string, string, string]> = [
  ["text / bg", "text", "bg"],
  ["text / surface", "text", "surface"],
  ["text / surface-2", "text", "surface-2"],
  ["muted / bg", "muted", "bg"],
  ["muted / surface", "muted", "surface"],
  ["muted / surface-2", "muted", "surface-2"],
  ["accent / bg", "accent", "bg"],
  ["accent / surface-2", "accent", "surface-2"],
  ["ok / surface", "ok", "surface"],
  ["warn / surface", "warn", "surface"],
  ["err / surface", "err", "surface"],
];

/** Mesure d'un couple, dans un thème donné. */
const mesure = (theme: Theme, premier: string, fond: string): number =>
  ratio(tokenDuTheme(premier, theme), tokenDuTheme(fond, theme));

/**
 * Toutes les mesures, à plat.
 *
 * ⚠️ Une ligne par couple et par thème, plutôt qu'une boucle dans un seul test :
 * le nom du couple fautif se lit alors dans le **titre** du test qui échoue, et
 * pas seulement dans la trace.
 */
const MESURES: ReadonlyArray<readonly [string, number]> = THEMES.flatMap((theme) =>
  COUPLES.map(([etiquette, premier, fond]): readonly [string, number] => [
    `${theme} · ${etiquette}`,
    mesure(theme, premier, fond),
  ]),
);

describe("U03 — contrastes du thème", () => {
  test.each(MESURES)("%s dépasse le minimum", (_nom, valeur) => {
    expect(valeur).toBeGreaterThanOrEqual(MINIMUM);
  });

  test("le couple le plus faible, tous thèmes confondus, est la marge déclarée", () => {
    /*
      ⚠️ La marge annoncée dans `styles.css` doit être le **pire cas réel** — pas
      celui du thème de base. Mesurer le bleu seul laisserait le vert et le rouge
      passer sous la marge annoncée sans que rien ne le dise, et le commentaire du
      thème mentirait.
    */
    const pire = Math.min(...MESURES.map(([, valeur]) => valeur));
    const annoncee = Number.parseFloat(token("contrast-min"));

    expect(pire).toBeCloseTo(annoncee, 1);
  });

  test("le thème de base est bien celui écrit sur `:root`", () => {
    // Si `THEME_DEFAUT` désignait un thème ayant son propre bloc, la palette de
    // `:root` ne serait plus celle qu'on applique en l'absence d'attribut.
    expect(tokenDuTheme("accent", THEME_DEFAUT)).toBe(token("accent"));
  });

  test("chaque thème a une pastille déclarée dans le CSS", () => {
    // Le type `Record<Theme, string>` le garantit à la compilation ; ce test
    // couvre le cas d'un objet non typé, et surtout l'oubli du token dans le CSS.
    for (const theme of THEMES) {
      expect(token(PASTILLE[theme]).length).toBeGreaterThan(0);
    }
  });

  test("la pastille de chaque thème montre l'accent de CE thème", () => {
    /*
      ⚠️ Les pastilles sont les seules couleurs recopiées du fichier — c'est
      inévitable, le CSS ne sait pas référencer « l'accent du thème vert » quand
      c'est le bleu qui est actif. Une recopie non vérifiée diverge : la pastille
      annoncerait une couleur que le thème n'applique pas, et on choisirait autre
      chose que ce qu'on croit choisir.
    */
    for (const theme of THEMES) {
      expect(`${theme} : ${token(PASTILLE[theme])}`).toBe(
        `${theme} : ${tokenDuTheme("accent", theme)}`,
      );
    }
  });
});
