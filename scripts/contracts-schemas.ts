/**
 * Génère les schémas Effect depuis le bundle de schémas Rust (T057).
 *
 * **Pourquoi ce fichier existe.** Le contrat HTTP vivait en **deux**
 * définitions : `packages/shared/src/api.ts` (schemas Effect écrits à la main)
 * et les DTO Rust. Une seule des deux pouvait bouger — et c'est exactement le
 * défaut qui a produit le bug `reachable`. Cette génération fait du bundle
 * Rust la **source**, et la façade TS une conséquence.
 *
 * Outil de **build**, pas de runtime : `cargo xtask contracts export` le
 * lance. La sortie est déterministe (noms triés, aucun horodatage) : deux
 * exports doivent être identiques octet pour octet.
 *
 * ⚠️ **Ce qui n'est pas reconnu échoue bruyamment**, avec le nom du schéma et
 * la clé fautive. Un générateur qui « saute » silencieusement une forme
 * produirait un schéma plus permissif que le vrai — c'est-à-dire un client qui
 * accepte ce que le serveur refuse.
 *
 * Usage : bun scripts/contracts-schemas.ts <contracts.schema.json> <sortie .ts>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [entree, sortie] = process.argv.slice(2);
if (!entree || !sortie) {
  console.error("usage: bun scripts/contracts-schemas.ts <bundle.schema.json> <sortie.ts>");
  process.exit(2);
}

type Schema = Record<string, unknown>;

const bundle = JSON.parse(readFileSync(entree, "utf8")) as { $defs?: Record<string, Schema> };
const definitions = bundle.$defs ?? {};
const noms = Object.keys(definitions).sort();
if (noms.length === 0) {
  console.error("bundle sans $defs : rien à générer");
  process.exit(1);
}

/** Le nom d'une définition référencée, ou une erreur nommée. */
const reference = (valeur: string, contexte: string): string => {
  const prefixe = "#/$defs/";
  if (!valeur.startsWith(prefixe)) {
    throw new Error(`${contexte} : référence non locale « ${valeur} »`);
  }
  return valeur.slice(prefixe.length);
};

/** Un littéral TS (chaîne JSON — échappement compris). */
const litteral = (valeur: unknown): string => JSON.stringify(valeur);

/**
 * Le corps d'un schéma, en expression Effect.
 *
 * Les formes reconnues sont celles que schemars produit réellement
 * (mesurées sur le bundle) : objet, tableau, `$ref`, `enum`, `const`,
 * `anyOf` (nullabilité et unions), `oneOf` (littéraux). Toute autre forme
 * lève.
 */
const expression = (schema: Schema | boolean, contexte: string): string => {
  // Un schéma booléen est du JSON Schema pur : `true` = n'importe quoi,
  // `false` = rien. C'est la forme de `detail: unknown` du journal client.
  if (schema === true) return "Schema.Unknown";
  if (schema === false) return "Schema.Never";
  if (typeof schema.$ref === "string") {
    return reference(schema.$ref, contexte);
  }
  if (Array.isArray(schema.enum)) {
    const valeurs = schema.enum.map(litteral).join(", ");
    return `Schema.Literals([${valeurs}])`;
  }
  if (schema.const !== undefined) {
    return `Schema.Literal(${litteral(schema.const)})`;
  }
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf as Schema[];
    // Union de littéraux (`oneOf` de `const`) : `Literals` garde le décodage
    // strict ET un message d'erreur unique.
    if (branches.every((branche) => branche.const !== undefined)) {
      const valeurs = branches.map((branche) => branche.const);
      return `Schema.Literals([${valeurs.map(litteral).join(", ")}])`;
    }
    // Sinon c'est une union de FORMES (l'enveloppe SSE `{event, data}` par
    // exemple) : on compose les branches telles quelles.
    const rendues = branches.map((branche, rang) => expression(branche, `${contexte}.oneOf[${rang}]`));
    return rendues.length === 1 ? rendues[0] : `Schema.Union([${rendues.join(", ")}])`;
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as Schema[];
    const nonNulles = branches.filter((branche) => branche.type !== "null");
    const aNull = nonNulles.length !== branches.length;
    if (nonNulles.length === 0) {
      return "Schema.Null";
    }
    const rendues = nonNulles.map((branche, rang) => expression(branche, `${contexte}.anyOf[${rang}]`));
    if (aNull) {
      if (rendues.length !== 1) {
        // `anyOf [A, B, null]` : la nullabilité s'applique à l'union.
        return `Schema.NullOr(Schema.Union([${rendues.join(", ")}]))`;
      }
      return `Schema.NullOr(${rendues[0]})`;
    }
    return rendues.length === 1 ? rendues[0] : `Schema.Union([${rendues.join(", ")}])`;
  }
  const type = schema.type;
  if (type === "string") return "Schema.String";
  if (type === "boolean") return "Schema.Boolean";
  if (type === "integer" || type === "number") return "Schema.Number";
  if (type === "null") return "Schema.Null";
  if (type === "array") {
    if (schema.items === undefined) {
      throw new Error(`${contexte} : tableau sans items (interdit — tout élément doit être typé)`);
    }
    return `Schema.Array(${expression(schema.items as Schema, `${contexte}[]`)})`;
  }
  if (type === "object" || schema.properties !== undefined) {
    return objet(schema, contexte);
  }
  throw new Error(`${contexte} : forme non reconnue (${JSON.stringify(schema).slice(0, 120)})`);
};

/** Un objet : `Schema.Struct` avec ses champs requis et omissibles. */
const objet = (schema: Schema, contexte: string): string => {
  const proprietes = (schema.properties ?? {}) as Record<string, Schema>;
  const requis = new Set<string>((schema.required as string[] | undefined) ?? []);
  const champs = Object.keys(proprietes)
    .sort()
    .map((nom) => {
      const rendue = expression(proprietes[nom], `${contexte}.${nom}`);
      const omissible = !requis.has(nom);
      return `  ${JSON.stringify(nom)}: ${omissible ? `Schema.optional(${rendue})` : rendue},`;
    });
  return `Schema.Struct({\n${champs.join("\n")}\n})`;
};

const morceaux: string[] = [
  "// Généré par `cargo xtask contracts export` — ne pas éditer.",
  `// Source : contracts.schema.json (${String(noms.length)} définitions).`,
  "// Schemas Effect : le client décode avec EUX, comme le serveur sérialise avec le contrat.",
  'import { Schema } from "effect";',
  "",
];

for (const nom of noms) {
  const schema = definitions[nom];
  morceaux.push(
    `/** ${String(schema.description ?? nom).replace(/\*\//g, "* /").split("\n")[0] ?? nom} */`,
    `export const ${nom} = ${expression(schema, nom)};`,
    `export type ${nom} = typeof ${nom}.Type;`,
    "",
  );
}

mkdirSync(dirname(sortie), { recursive: true });
writeFileSync(sortie, `${morceaux.join("\n").trimEnd()}\n`, "utf8");
console.log(`schemas Effect générés : ${String(noms.length)} définitions → ${sortie}`);
