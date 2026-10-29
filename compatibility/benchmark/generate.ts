#!/usr/bin/env bun
/**
 * Build the frozen benchmark fixture bundle (task T001, consumed at T065).
 *
 * Everything here is synthetic and deterministic: no Herdr socket, no agent
 * CLI, no user session, no network. The Pi JSONL generator reuses the existing
 * synthetic `ecrireFixture` (seeded LCG, byte-reproducible). Codex/Claude line
 * shapes follow the measured upstream forms recorded in packages/shared/src.
 * SQLite stores are synthetic 120-row-per-session databases for the shared
 * paging engines.
 *
 * Usage:
 *   bun compatibility/benchmark/generate.ts          # (re)generate fixtures/
 *   bun compatibility/benchmark/generate.ts --delta  # write the 32 MiB delta append file
 *
 * The manifest (fixtures/manifest.json) records sha256/byte size per artifact
 * plus the expected hash of the delta file; the T065 harness must regenerate
 * or verify hashes before measuring.
 */
import { createHash } from "node:crypto";
import { mkdirSync, statSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { Database } from "bun:sqlite";
import { dirname, join } from "node:path";
import { ecrireFixture } from "./fixture-pi.ts";

const OUT = new URL("fixtures/", import.meta.url).pathname;
const SEED = 20_240_310; // distinct from any other fixture seed so bundles stay independent
const DP = (p: string): string => {
  mkdirSync(dirname(p), { recursive: true });
  return p;
};

// ---------------------------------------------------------------------------
// Deterministic helper (same LCG family as ecrireFixture)
// ---------------------------------------------------------------------------
const generer = (graine: number): (() => number) => {
  let etat = graine >>> 0;
  return () => {
    etat = (Math.imul(1664525, etat) + 1013904223) >>> 0;
    return etat / 0x1_0000_0000;
  };
};

// Word/phrase table copied from the synthetic fixture vocabulary (not exported
// there deliberately); kept local so the bundle never mutates src.
const MOTS = [
  "contrat", "lecture", "session", "curseur", "opaque", "rafraîchissement",
  "fenêtre", "octets", "décodage", "rendu", "accessibilité", "focus",
  "feuille", "verdict", "catalogne", "résultat", "erreur", "cause",
  "vérification", "mesure", "référence", "p95", "repli", "état",
] as const;

const PHRASES = [
  "Le chemin critique passe par le serveur, jamais par le contenu de la session.",
  "Une mesure sans méthode n'est pas une mesure, c'est une impression.",
  "Le filtre réduit la liste ; il ne choisit rien.",
  "Rien ne part sans avoir été vérifié, et le refus est écrit.",
  "Le composeur reste hors du conteneur défilant, sinon le clavier se bat avec le fil.",
  "Un identifiant interne n'aide jamais personne à comprendre ce qu'il regarde.",
  "La coupure conserve le fil et le brouillon : c'est la règle, pas l'intention.",
  "Un événement nommé prouve que le flux vit ; un `message` seul ne prouve rien.",
  "Le plafond existe pour que la liste remaind lisible, pas pour gonfler le nombre.",
  "La zone sûre du bas garde le champ au-dessus de la barre du téléphone.",
  "Un état qu'on ne sait pas nommer doit se voir, pas disparaître en silence.",
  "Le rebond du cycle de focus empêche `Tab` de sortir de la feuille.",
] as const;

// ---------------------------------------------------------------------------
// Pi sessions (real Pi line shapes written by the existing synthetic fixture)
// ---------------------------------------------------------------------------
const piSessions = (count: number, octetsCibles: number, graineBase: number): string[] => {
  const paths: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const path = DP(`${OUT}pi/pane-${String(i).padStart(2, "0")}.jsonl`);
    const r = ecrireFixture(path, octetsCibles, graineBase + i);
    if (r.octets < octetsCibles) throw new Error(`pi fixture too small: ${path}`);
    paths.push(path);
  }
  return paths;
};

// ---------------------------------------------------------------------------
// Codex rollout-shaped sessions (response_item / event_msg / turn_context)
// ---------------------------------------------------------------------------
const codexSessionLines = (index: number, hasard: () => number): string[] => {
  const lines: string[] = [];
  let ts = 1760532000000;
  let ordinal = 0;
  const stamp = (): string => new Date(ts).toISOString();
  const push = (envelope: Record<string, unknown>): void => {
    ordinal += 1;
    lines.push(`${JSON.stringify({ ...envelope, ordinal })}\n`);
    ts += 1_000 + Math.floor(hasard() * 2_000);
  };
  const question =
    PHRASES[index % PHRASES.length] ?? "travail synthétique";
  // injected context the Codex profile must not present as user prose
  push({
    timestamp: stamp(),
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          text: "# AGENTS.md instructions for repo\n<INSTRUCTIONS>\nrègles synthétiques du dépôt\n</INSTRUCTIONS>",
          type: "input_text",
        },
      ],
    },
  });
  push({
    timestamp: stamp(),
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          text: `<environment_context>\ncwd: /dev/projets/synth-${index}\nshell: zsh\n</environment_context>`,
          type: "input_text",
        },
      ],
    },
  });
  for (let round = 0; round < 6; round += 1) {
    // user prompts arrive through event_msg (measured shape)
    push({
      timestamp: stamp(),
      type: "event_msg",
      payload: {
        type: "item_completed",
        id: `u${index}-${round}`,
        item: { type: "UserMessage", id: `u${index}-${round}`, content: `${question} (r${round}, p${index})` },
      },
    });
    push({
      timestamp: stamp(),
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: `call-${index}-${round + 2}`,
        arguments: `{"chemin":"src/f-${round}.ts"}`,
        name: "edit",
      },
    });
    push({
      timestamp: stamp(),
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: `call-${index}-${round + 2}`,
        output: [{ text: "diff appliqué sur la copie synthétique", type: "input_text" }],
      },
    });
    push({
      timestamp: stamp(),
      type: "event_msg",
      payload: {
        type: "item_completed",
        id: `f${index}-${round}`,
        item: {
          type: "FileChange",
          id: `f${index}-${round}`,
          changes: {
            [`src/f-${round}.ts`]: {
              type: "edit",
              unified_diff: `@@ -1,2 +1,3 @@\n-ancien-${round}\n+nouveau-${round}\n`,
            },
          },
        },
      },
    });
    push({
      timestamp: stamp(),
      type: "event_msg",
      payload: {
        type: "item_completed",
        id: `c${index}-${round}`,
        item: {
          type: "CommandExecution",
          id: `c${index}-${round}`,
          command: ["bash", "-lc", `echo synth-${round}`],
          status: "completed",
          exit_code: 0,
          aggregated_output: "sortie synthétique\n",
        },
      },
    });
    push({
      timestamp: stamp(),
      type: "event_msg",
      payload: {
        type: "item_completed",
        id: `a${index}-${round}`,
        item: {
          type: "AgentMessage",
          id: `a${index}-${round}`,
          phase: "résumé",
          content: [{ text: `réponse synthétique ${round} de la session ${index}`, type: "input_text" }],
        },
      },
    });
    push({
      timestamp: stamp(),
      type: "turn_context",
      payload: { model: "gpt-5", effort: round % 2 === 0 ? "medium" : "high" },
    });
    push({
      timestamp: stamp(),
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: {
          model: "gpt-5",
          model_provider_id: "openai",
          reasoning_effort: round % 2 === 0 ? "medium" : "high",
        },
      },
    });
  }
  return lines;
};

const codexSessions = (count: number, octetsCibles: number): string[] => {
  const paths: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const path = DP(`${OUT}codex/pane-${String(i).padStart(2, "0")}.jsonl`);
    let lines = codexSessionLines(i, generer(SEED + 1_000 + i));
    for (let round = 1; lines.join("").length < octetsCibles; round += 1) {
      lines = lines.concat(codexSessionLines(i, generer(SEED + 1_000 + i * 97 + round)));
    }
    writeFileSync(path, lines.join(""), "utf8");
    paths.push(path);
  }
  return paths;
};

// ---------------------------------------------------------------------------
// Claude Code-shaped sessions (user/assistant + tool_use/tool_result)
// ---------------------------------------------------------------------------
const claudeSessionLines = (
  index: number,
  hasard: () => number,
  base: number,
): string[] => {
  const lines: string[] = [];
  let ts = 1760532000000;
  let uuidCounter = 0;
  const stamp = (): string => new Date(ts).toISOString();
  const uuid = (): string => `synthetic-${base}-${String(uuidCounter++).padStart(3, "0")}`;
  for (let round = 0; round < 8; round += 1) {
    lines.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: `liste et corrige (${round}, p${index})` },
        timestamp: stamp(),
        uuid: uuid(),
      }) + "\n",
    );
    ts += 1_000 + Math.floor(hasard() * 2_000);
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: `réponse synthétique ${round} de la session ${index}` },
            { type: "tool_use", id: `callu-${index}-${round}`, name: "Read", input: { path: `src/f-${round}.ts` } },
          ],
          model: "claude-sonnet-4-6",
        },
        timestamp: stamp(),
        uuid: uuid(),
      }) + "\n",
    );
    ts += 1_000 + Math.floor(hasard() * 2_000);
    lines.push(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: `callu-${index}-${round}`,
              content: "contenu de fichier synthétique",
              is_error: false,
            },
          ],
        },
        timestamp: stamp(),
        uuid: uuid(),
      }) + "\n",
    );
    ts += 1_000 + Math.floor(hasard() * 2_000);
    // accounting line type that must NOT enter the conversation
    lines.push(
      JSON.stringify({
        type: "api-request-blob",
        message: { role: "user", content: "<system-reminder>contexte synthétique injecté</system-reminder>" },
        timestamp: stamp(),
        uuid: uuid(),
      }) + "\n",
    );
    ts += 1_000 + Math.floor(hasard() * 2_000);
  }
  return lines;
};

const claudeSessions = (count: number, octetsCibles: number): string[] => {
  const paths: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const path = DP(`${OUT}claude/pane-${String(i).padStart(2, "0")}.jsonl`);
    let lines = claudeSessionLines(i, generer(SEED + 2_000 + i), i);
    for (let round = 1; lines.join("").length < octetsCibles; round += 1) {
      lines = lines.concat(claudeSessionLines(i, generer(SEED + 2_000 + i * 131 + round), i * 100 + round));
    }
    writeFileSync(path, lines.join(""), "utf8");
    paths.push(path);
  }
  return paths;
};

// ---------------------------------------------------------------------------
// opencode store (synthetic session_v2 / session_message)
// ---------------------------------------------------------------------------
type OpenCodeRow = [string, string, string, number, number, string];

const opencodeRows = (
  sessionIndex: number,
  rows: number,
  hasard: () => number,
): OpenCodeRow[] => {
  const rowsOut: OpenCodeRow[] = [];
  let seq = 0;
  let time = 1760532000000;
  for (let r = 0; r < rows; r += 1) {
    const kind = r % 6;
    time += 1_000 + Math.floor(hasard() * 1_500);
    seq += 1;
    const id = `msg_${sessionIndex}_${seq}`;
    let type = "assistant";
    let data: Record<string, unknown>;
    if (kind === 0) {
      type = "user";
      data = {
        session_id: `ses_${sessionIndex}`,
        text: `${PHRASES[r % PHRASES.length]} (s${sessionIndex})`,
        time: { created: time },
        model: { id: "synth-1", providerID: "synthetic", variant: "high" },
      };
    } else if (kind === 1) {
      type = "assistant";
      data = {
        content: [
          { text: PHRASES[(r + 3) % PHRASES.length], type: "reasoning" },
          { text: `réponse synthétique s${sessionIndex} r${r}`, type: "text" },
          {
            type: "tool",
            id: `tool_${sessionIndex}_${seq}`,
            name: "read",
            state: { input: { path: `src/f-${r}.ts` }, status: "completed", content: [{ type: "text", text: "sortie synthétique" }] },
          },
        ],
        model: { id: "synth-1", providerID: "synthetic", variant: "default" },
        time: { created: time },
      };
    } else if (kind === 2) {
      type = "assistant";
      data = {
        content: [
          { text: `réponse synthétique s${sessionIndex} r${r}`, type: "text" },
          {
            type: "file",
            uri: "data:image/png;base64," + Buffer.from(`png-${sessionIndex}-${r}`, "utf8").toString("base64"),
          },
        ],
        model: { id: "synth-1", providerID: "synthetic", variant: "max" },
        time: { created: time },
      };
    } else if (kind === 3) {
      type = "idle"; // non-conversation accounting row
      data = { outcome: { code: "ok" }, time: { created: time } };
    } else if (kind === 4) {
      type = "system";
      data = { metadata: { notice: "instructions" }, time: { created: time } };
    } else {
      type = "model-switched";
      data = { model: { id: "synth-1", providerID: "synthetic" }, time: { created: time } };
    }
    rowsOut.push([id, `ses_${sessionIndex}`, type, seq, time, JSON.stringify(data)]);
  }
  return rowsOut;
};

const opencodeDb = (sessions: number, rowsPerSession: number): string => {
  const path = DP(`${OUT}opencode/opencode.db`);
  try {
    unlinkSync(path);
  } catch { /* first run */ }
  const db = new Database(path, { create: true });
  try {
    db.exec("PRAGMA page_size = 4096");
    db.exec(
      "CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)",
    );
    db.exec(
      "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL)",
    );
    db.exec("CREATE INDEX idx_opencode_msg_session_seq ON session_message(session_id, seq)");
    const insSession = db.prepare(
      "INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?)",
    );
    const insMessage = db.prepare(
      "INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (let s = 1; s <= sessions; s += 1) {
      const rowsOut = opencodeRows(s, rowsPerSession, generer(SEED + 3_000 + s));
      db.transaction(() => {
        insSession.run(
          `ses_${s}`,
          `/dev/projets/synth-${s}`,
          `Session synthétique ${s}`,
          rowsOut[0][4],
          rowsOut[rowsOut.length - 1][4],
        );
        for (const row of rowsOut) insMessage.run(...row);
      })();
    }
  } finally {
    db.close();
  }
  return path;
};

// ---------------------------------------------------------------------------
// Devin store (synthetic sessions / message_nodes)
// ---------------------------------------------------------------------------
const PAIRS_A = ["burly", "tidy", "calm", "eager", "quick", "lucky", "smart", "brave", "fond", "able"];
const PAIRS_B = ["stop", "rook", "moon", "lark", "pine", "wolf", "trout", "brick", "ember", "stone"];
const pairWords = (i: number): string => {
  // 50 ids = 10 × 5 without collision (A cycles 10, B cycles the session block).
  const a = PAIRS_A[(i - 1) % PAIRS_A.length] ?? "z";
  const b = PAIRS_B[Math.floor((i - 1) / PAIRS_A.length) % PAIRS_B.length] ?? "y";
  return `${a}-${b}`;
};

const devinDb = (sessions: number, rowsPerSession: number): string => {
  const path = DP(`${OUT}devin/devin.db`);
  try {
    unlinkSync(path);
  } catch { /* first run */ }
  const db = new Database(path, { create: true });
  try {
    db.exec("PRAGMA page_size = 4096");
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)");
    db.exec(
      "CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, node_id INTEGER NOT NULL, parent_node_id INTEGER, chat_message TEXT NOT NULL, created_at INTEGER NOT NULL, metadata TEXT, UNIQUE(session_id, node_id))",
    );
    db.exec("CREATE INDEX idx_devin_nodes_session_row ON message_nodes(session_id, row_id)");
    const insSession = db.prepare("INSERT INTO sessions VALUES (?, ?)");
    const insNode = db.prepare(
      "INSERT INTO message_nodes (session_id, node_id, parent_node_id, chat_message, created_at) VALUES (?, ?, NULL, ?, ?)",
    );
    for (let s = 1; s <= sessions; s += 1) {
      const hasard = generer(SEED + 4_000 + s);
      let node = 0;
      let time = 1760532000000;
      db.transaction(() => {
        insSession.run(pairWords(s), `Session devin synthétique ${s}`);
        for (let r = 0; r < rowsPerSession; r += 1) {
          node += 1;
          time += 1_000 + Math.floor(hasard() * 1_500);
          const kind = r % 4;
          let chat: Record<string, unknown>;
          if (kind === 0) {
            chat = {
              role: "user",
              content: `${PHRASES[r % PHRASES.length]} devin s${s}`,
              metadata: { created_at: new Date(time).toISOString() },
            };
          } else if (kind === 1 || kind === 3) {
            chat = {
              role: "assistant",
              content: `réponse devin synthétique s${s} r${r}`,
              thinking: { signature: "", thinking: PHRASES[(r + 5) % PHRASES.length] },
              tool_calls: [],
              metadata: {
                created_at: new Date(time).toISOString(),
                finish_reason: "stop",
                generation_model: "swe-1-6-slow",
              },
            };
          } else {
            chat = {
              role: "system",
              content: "<system_info>contexte injecté synthétique</system_info>",
              metadata: { created_at: new Date(time).toISOString() },
            };
          }
          insNode.run(`ses_${s}`, node, JSON.stringify(chat), time);
        }
      })();
    }
  } finally {
    db.close();
  }
  return path;
};

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------
const hashOf = (path: string): { sha256: string; bytes: number } => {
  const buf = readFileSync(path);
  return { bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (process.argv.includes("--delta")) {
  const path = DP(`${OUT}delta/append-pi.jsonl`);
  ecrireFixture(path, 32 * 1024 * 1024, 21_050_318);
  const h = hashOf(path);
  console.log(`delta: ${path}`);
  console.log(JSON.stringify({ ...h, seed: 21_050_318 }));
  process.exit(0);
}

const startedAt = new Date().toISOString();
const pi5 = piSessions(5, 40_000, SEED); // small pool: first-second pane workloads
const pi50 = piSessions(50, 40_000, SEED + 10_000); // 50-pane workload
const codex10 = codexSessions(10, 30_000);
const claude10 = claudeSessions(10, 30_000);
const opencode = opencodeDb(50, 120);
const devin = devinDb(50, 120);
const largeBase = piSessions(1, 2 * 1024 * 1024, SEED + 20_000);

const files: Array<{ path: string; sha256: string; bytes: number; purpose: string }> = [];
const add = (path: string, purpose: string): void =>
  files.push({
    bytes: statSync(path).size,
    path: path.replace(OUT, "fixtures/"),
    purpose,
    sha256: hashOf(path).sha256,
  });
for (const p of [...pi5, ...pi50]) add(p, "pi JSONL session (synthetic; ecrireFixture)");
for (const p of codex10) add(p, "codex rollout-shaped JSONL (synthetic)");
for (const p of claude10) add(p, "claude user/assistant JSONL (synthetic)");
add(opencode, "opencode synthetic store: session_v2/session_message, 50×120 rows");
add(devin, "devin synthetic store: sessions/message_nodes, 50×120 rows");
add(largeBase[0] ?? "", "pi base JSONL (2 MiB) for the 32 MiB delta catch-up scenario");

const deltaPath = `${OUT}delta/append-pi.jsonl`;
let deltaSha256 = "pending (run: bun compatibility/benchmark/generate.ts --delta, then re-run main)";
let deltaBytes = 32 * 1024 * 1024;
try {
  const actual = hashOf(deltaPath);
  deltaSha256 = actual.sha256;
  deltaBytes = actual.bytes;
} catch { /* delta not generated yet */ }
const DELTA_BUNDLE = {
  generator: "bun compatibility/benchmark/generate.ts --delta",
  note: "Not committed: regenerated deterministically (seed 21050318) and hash-verified before each T065 measurement run.",
  path: "fixtures/delta/append-pi.jsonl",
  seed: 21_050_318,
  byteTarget: 32 * 1024 * 1024,
  bytes: deltaBytes,
  sha256Expected: deltaSha256,
};

const manifest: Record<string, unknown> = {
  schemaVersion: 1,
  generatedAtUtc: startedAt,
  host: `${process.platform}/${process.arch}`,
  bunVersion: Bun.version,
  command: "bun compatibility/benchmark/generate.ts",
  seed: SEED,
  devOnly: true,
  warning: "Synthetic data only. No Herdr socket, no agent CLI, no user session, no real push/VAPID material touched.",
  files,
  delta: DELTA_BUNDLE,
  scenarios: [
    { id: "panes-1", note: "single pane: first session of each family" },
    { id: "panes-10", note: "10 sessions read concurrently across families" },
    { id: "panes-50", note: "50 sessions, up to 8 clients" },
    { id: "clients-1-4-8", note: "concurrent HTTP clients 1/4/8 (harness built at T065)" },
    { id: "cold-warm", note: "first read per source (cold resolution) vs cache-warmed read" },
    { id: "delta32MiB", note: "base file + deterministic 32 MiB append; reconnect then full catch-up" },
    { id: "lockDB", note: "opencode store opened with a held write transaction during reads (busy 3 s)" },
    { id: "sse-idle", note: "quiet journal feed with 8 idle connections (harness-built)" },
  ],
};

const manifestPath = DP(`${OUT}manifest.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`fixtures: ${files.length} files; manifest: ${manifestPath}`);
console.log("delta hash is recorded once `generate.ts --delta` is run; see manifest note.");
