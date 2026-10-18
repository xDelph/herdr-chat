/**
 * Génère les types TypeScript depuis le bundle de schémas (T009).
 *
 * Outil de **build**, pas de runtime : `cargo xtask contracts export` le
 * lance. Les versions des outils sont figées dans `package.json` (pas de
 * `^`) — un export régénéré doit être identique octet pour octet.
 *
 * Usage : bun scripts/contracts-types.ts <contracts.schema.json> <sortie .d.ts>
 */
import { compile } from "json-schema-to-typescript";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [entree, sortie] = process.argv.slice(2);
if (!entree || !sortie) {
  console.error("usage: bun scripts/contracts-types.ts <bundle.schema.json> <sortie.d.ts>");
  process.exit(2);
}

const bundle = JSON.parse(readFileSync(entree, "utf8"));
const noms = Object.keys(bundle.$defs ?? {}).sort();
if (noms.length === 0) {
  console.error("bundle sans $defs : rien à générer");
  process.exit(1);
}

const morceaux: string[] = [
  "// Généré par `cargo xtask contracts export` — ne pas éditer.",
  `// Source : contracts.schema.json (${String(noms.length)} définitions).`,
  "",
];

for (const nom of noms) {
  // Un document par définition : une $ref nommée + les $defs partagés.
  const document = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $ref: `#/$defs/${nom}`,
    $defs: bundle.$defs,
    title: nom,
  };
  const compilee = await compile(document as never, nom, {
    additionalProperties: false,
    bannerComment: "",
  });
  morceaux.push(compilee.trimEnd(), "");
}

mkdirSync(dirname(sortie), { recursive: true });
writeFileSync(sortie, morceaux.join("\n") + "\n");
console.log(`types TS : ${String(noms.length)} définitions → ${sortie}`);
