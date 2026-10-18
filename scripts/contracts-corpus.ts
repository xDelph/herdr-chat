/**
 * Valide le corpus gelé avec les **validateurs générés** (T009) — la preuve
 * C01 côté JS : accepté/refusé identiquement à serde.
 *
 * Lancé par `cargo xtask contracts check`. Les cibles hors périmètre des
 * DTO HTTP (famille fil Herdr, codec cursor, legacy push — exclues nommément
 * à T007) sont passées ici comme telles : elles ne sont ni validées ni
 * comptées comme couvertes.
 *
 * Usage : bun scripts/contracts-corpus.ts <dir generated> <corpus.json>
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [repertoire, corpus_chemin] = process.argv.slice(2);
if (!repertoire || !corpus_chemin) {
  console.error("usage: bun scripts/contracts-corpus.ts <dir generated> <corpus.json>");
  process.exit(2);
}

const { cibles } = JSON.parse(readFileSync(`${repertoire}/cibles.json`, "utf8"));
const corpus = JSON.parse(readFileSync(corpus_chemin, "utf8"));
const valideurs = await import(pathToFileURL(`${repertoire}/valider.mjs`).href);

/** Les cibles exclues à T007 — la même liste fermée, justifiée. */
const EXCLUES: ReadonlySet<string> = new Set([
  "AgentInfo",
  "AgentListPayload",
  "AgentSessionInfo",
  "EventWait.supported",
  "HerdrReply",
  "Method.vocabulary",
  "PaneInfo",
  "PaneLayout",
  "PaneLayoutPane",
  "PaneLayoutRect",
  "PaneReadPayload",
  "PongPayload",
  "PushStore.legacy",
  "PushStore.legacy.null-expiration",
  "SessionCursor",
  "SnapshotPane",
  "SnapshotPayload",
  "SubscribeHttpPrefixRule",
  "TabInfo",
  "WorkspaceInfo",
  "WorkspaceWorktreeInfo",
]);

let couvertes = 0;
let exclues_rencontrees = 0;
const divergences: string[] = [];

for (const echantillon of corpus.samples) {
  const { target, expect, value, id } = echantillon;
  const schema = cibles[target];
  if (schema === undefined) {
    if (!EXCLUES.has(target)) {
      divergences.push(`${id} : cible ${target} ni mappée ni exclue`);
    } else {
      exclues_rencontrees += 1;
    }
    continue;
  }
  const valideur = valideurs[schema];
  if (typeof valideur !== "function") {
    divergences.push(`${id} : pas de validateur pour ${schema}`);
    continue;
  }
  const accepte = Boolean(valideur(value));
  const attendu = expect === "accept";
  if (accepte !== attendu) {
    divergences.push(
      `${id} (${target}) : attendu ${expect}, JS ${accepte ? "accepte" : "refuse"} — ${JSON.stringify(value)}`,
    );
  } else {
    couvertes += 1;
  }
}

if (divergences.length > 0) {
  console.error(`corpus JS : ${String(divergences.length)} divergences serde/JS :`);
  for (const divergence of divergences.slice(0, 20)) console.error(`  - ${divergence}`);
  process.exit(1);
}
console.log(
  `corpus JS : ${String(couvertes)} échantillons acceptés/refusés comme serde, ${String(exclues_rencontrees)} exclusions rencontrées — identique (C01)`,
);
