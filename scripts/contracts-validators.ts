/**
 * Génère les validateurs **Ajv standalone** depuis le bundle de schémas (T009).
 *
 * Outil de **build** : `cargo xtask contracts export` le lance. Le module
 * produit (`valider.mjs`) n'a besoin d'aucune dépendance au runtime — le
 * code de validation est embarqué (standalone), comme le veut TECH §5.
 *
 * ⚠️ Le parcours d'Ajv standalone ne voit que les schémas **passés par
 * `addSchema` puis compilés via `getSchema`** — un `compile()` direct est
 * invisible au générateur de code (mesuré). Chaque définition reçoit son
 * `$id` = son nom (identificateur JS valide) : le module exporte
 * `AgentView`, `SessionResponse`, … par nom exact.
 *
 * Usage : bun scripts/contracts-validators.ts <contracts.schema.json> <sortie .mjs>
 */
import Ajv2020 from "ajv/dist/2020";
import standaloneCode from "ajv/dist/standalone/index.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [entree, sortie] = process.argv.slice(2);
if (!entree || !sortie) {
  console.error(
    "usage: bun scripts/contracts-validators.ts <bundle.schema.json> <sortie.mjs>",
  );
  process.exit(2);
}

const bundle = JSON.parse(readFileSync(entree, "utf8"));
const defs = bundle.$defs ?? {};
const noms = Object.keys(defs).sort();
if (noms.length === 0) {
  console.error("bundle sans $defs : rien à générer");
  process.exit(1);
}

const ajv = new Ajv2020({
  code: { source: true },
  strict: false,
  allErrors: false,
  // Les annotations `format: "uint64"` de schemars sont décoratives (la
  // contrainte réelle est `type: integer`) : Ajv les ignore, on silence
  // leurs avertissements — pas la validation.
  logger: false,
});

for (const nom of noms) {
  ajv.addSchema({ ...defs[nom], $id: nom });
}
for (const nom of noms) {
  if (ajv.getSchema(nom) === undefined) {
    console.error(`définition ${nom} : compilation impossible`);
    process.exit(1);
  }
}

const code = standaloneCode(ajv);
const entete = `// Généré par \`cargo xtask contracts export\` — ne pas éditer.\n// Validateurs Ajv standalone (${String(noms.length)} définitions, draft 2020-12).\n`;
mkdirSync(dirname(sortie), { recursive: true });
writeFileSync(sortie, entete + code + "\n");
console.log(`validateurs : ${String(noms.length)} définitions → ${sortie}`);
