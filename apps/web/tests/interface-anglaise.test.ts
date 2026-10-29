/**
 * T072 — l'interface est en anglais : aucune chaîne du code de la PWA ne porte
 * de lettre accentuée.
 *
 * ⚠️ La réécriture de la PWA était repassée au français sans qu'aucun test ne
 * bronche : la décision T072 n'existait que dans le journal. Cette porte la rend
 * exécutable. Elle lit chaque fichier de `src/` (et le service worker) avec
 * l'analyseur de Vite, et ne regarde que ce qui peut s'afficher : les chaînes,
 * les morceaux de gabarits, le texte JSX et les motifs d'expressions
 * régulières. Les commentaires et les identifiants ne sont pas dans cette
 * collecte — ils restent en français, c'est la convention du dépôt.
 *
 * Une lettre accentuée n'est qu'un indice du français : la relecture des mots
 * sans accent (« Lancer », « hier »…) reste humaine. Mais l'indice suffit à
 * arrêter une régression massive comme celle-ci.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseAst } from "vite";

const racine = join(import.meta.dir, "..");

const ACCENTS = /[àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ]/u;

/**
 * Les chaînes accentuées **qui ne s'affichent pas**, chacune avec sa raison.
 * Une entrée = un fichier et le texte exact. Toute autre chaîne accentuée fait
 * échouer la porte.
 */
const PERMISES: ReadonlyArray<{ readonly fichier: string; readonly texte: string }> = [
  {
    // Motif qui reconnaît une erreur du démon Rust **d'avant** son passage à
    // l'anglais (« curseur refusé : … ») ; la forme anglaise est dans le même
    // motif. Rien n'est affiché à partir de ce texte.
    fichier: "src/erreurs-demon.ts",
    texte: "^(curseur refusé|cursor rejected)\\b",
  },
];

/** Une chaîne trouvée, avec sa ligne. */
interface Trouvee {
  readonly ligne: number;
  readonly texte: string;
}

const estNoeud = (valeur: unknown): valeur is Record<string, unknown> & { type: string } =>
  typeof valeur === "object" &&
  valeur !== null &&
  typeof (valeur as { type?: unknown }).type === "string";

/** Les nœuds dont la `source` est un chemin de module, jamais un texte affiché. */
const AVEC_SOURCE = new Set([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "ExportNamedDeclaration",
  "ImportExpression",
]);

const ligneDe = (source: string, position: unknown): number =>
  typeof position === "number" ? source.slice(0, position).split("\n").length : 0;

/** Le texte porté par un nœud, s'il en porte un. */
const texteDe = (noeud: Record<string, unknown> & { type: string }): string | null => {
  if (noeud.type === "Literal") {
    if (typeof noeud["value"] === "string") return noeud["value"];
    const regex = noeud["regex"];
    if (typeof regex === "object" && regex !== null) {
      const motif: unknown = Reflect.get(regex, "pattern");
      return typeof motif === "string" ? motif : null;
    }
    return null;
  }
  if (noeud.type === "TemplateElement") {
    const valeur = noeud["value"];
    if (typeof valeur !== "object" || valeur === null) return null;
    const cuit: unknown = Reflect.get(valeur, "cooked");
    const brut: unknown = Reflect.get(valeur, "raw");
    return typeof cuit === "string" ? cuit : typeof brut === "string" ? brut : null;
  }
  if (noeud.type === "JSXText") {
    return typeof noeud["value"] === "string" ? noeud["value"] : null;
  }
  return null;
};

/** Toutes les chaînes d'un source — commentaires et chemins d'import exclus. */
const chainesDe = (source: string, lang: "ts" | "tsx" | "js"): ReadonlyArray<Trouvee> => {
  const trouvees: Trouvee[] = [];
  const parcours = (valeur: unknown): void => {
    if (Array.isArray(valeur)) {
      for (const enfant of valeur) parcours(enfant);
      return;
    }
    if (!estNoeud(valeur)) return;
    const texte = texteDe(valeur);
    if (texte !== null && texte.trim().length > 0) {
      trouvees.push({ ligne: ligneDe(source, valeur["start"]), texte });
    }
    for (const [cle, enfant] of Object.entries(valeur)) {
      if (cle === "source" && AVEC_SOURCE.has(valeur.type)) continue;
      if (typeof enfant === "object" && enfant !== null) parcours(enfant);
    }
  };
  parcours(parseAst(source, { lang }));
  return trouvees;
};

const accentuees = (source: string, lang: "ts" | "tsx" | "js"): ReadonlyArray<Trouvee> =>
  chainesDe(source, lang).filter((trouvee) => ACCENTS.test(trouvee.texte));

const fichiersSources = (dossier: string): ReadonlyArray<string> =>
  readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((entree) => entree.isFile() && /\.tsx?$/.test(entree.name))
    .map((entree) => join(entree.parentPath, entree.name))
    .toSorted();

const langDe = (chemin: string): "ts" | "tsx" | "js" =>
  chemin.endsWith(".tsx") ? "tsx" : chemin.endsWith(".ts") ? "ts" : "js";

describe("T072 — la porte sait échouer", () => {
  test("une chaîne, un gabarit, un texte JSX et un motif accentués sont trouvés", () => {
    const echantillon = [
      'const a = "Réessayer";',
      "const b = `il y a ${String(2)} min — déjà`;",
      "const c = <p>Fichiers modifiés</p>;",
      "const d = /^ligne trop grande/;",
      "const e = /^curseur refusé/;",
    ].join("\n");
    expect(accentuees(echantillon, "tsx").map((trouvee) => trouvee.texte)).toEqual([
      "Réessayer",
      " min — déjà",
      "Fichiers modifiés",
      "^curseur refusé",
    ]);
  });

  test("les commentaires et les chemins d'import ne sont pas des textes", () => {
    const echantillon = [
      'import { a } from "./réglages.ts";',
      'export { b } from "./données.ts";',
      "// « Réessayer » reste un commentaire",
      "/* Fichiers modifiés */",
      'const c = "Retry";',
    ].join("\n");
    expect(accentuees(echantillon, "ts")).toEqual([]);
    expect(chainesDe(echantillon, "ts").map((trouvee) => trouvee.texte)).toEqual(["Retry"]);
  });
});

describe("T072 — l'interface de la PWA est en anglais", () => {
  const cibles = [...fichiersSources(join(racine, "src")), join(racine, "public", "sw.js")];

  test("la porte lit bien tout le code de l'interface", () => {
    expect(cibles.length).toBeGreaterThan(50);
    expect(cibles.map((chemin) => relative(racine, chemin))).toContain("src/libelles.ts");
  });

  test("aucune chaîne accentuée hors de la liste permise", () => {
    const fautes: string[] = [];
    const permisesVues = new Set<string>();
    for (const chemin of cibles) {
      const fichier = relative(racine, chemin);
      for (const trouvee of accentuees(readFileSync(chemin, "utf8"), langDe(chemin))) {
        const permise = PERMISES.find(
          (entree) => entree.fichier === fichier && entree.texte === trouvee.texte,
        );
        if (permise === undefined) {
          fautes.push(`${fichier}:${String(trouvee.ligne)} ${JSON.stringify(trouvee.texte)}`);
        } else {
          permisesVues.add(`${permise.fichier}|${permise.texte}`);
        }
      }
    }
    expect(fautes).toEqual([]);
    // Une entrée permise qui ne sert plus doit partir : la liste ne grossit pas
    // en silence.
    expect([...permisesVues].toSorted()).toEqual(
      PERMISES.map((entree) => `${entree.fichier}|${entree.texte}`).toSorted(),
    );
  });
});
