/**
 * Tests de lecture des sessions.
 *
 * Les fixtures sont **écrites par le test lui-même** dans un répertoire
 * temporaire : le module de lecture, lui, n'ouvre jamais un fichier en
 * écriture.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAll, readHeader, splitCompleteLines, tailFrom } from "./SessionReader.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "herdr-remote-sessions-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Le lecteur est asynchrone (I/O fichier) : on exécute en Promise, jamais en
// `runSync`, qui ne sait pas piloter un effet asynchrone.
const runOrThrow = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.orDie(effect));
const runResult = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect));

describe("splitCompleteLines", () => {
  test("sépare les lignes complètes de la ligne partielle", () => {
    const { lines, pending } = splitCompleteLines('{"a":1}\n{"b":2}\n{"c":');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(pending).toBe('{"c":');
  });

  test("aucune ligne complète : tout est en attente", () => {
    const { lines, pending } = splitCompleteLines('{"a":');
    expect(lines).toEqual([]);
    expect(pending).toBe('{"a":');
  });

  test("un JSON valide sans \\n final reste en attente (il peut être tronqué)", () => {
    // Piège important : la dernière portion n'est jamais interprétée, même
    // si elle est du JSON syntaxiquement valide.
    const { lines, pending } = splitCompleteLines('{"a":1}\n{"b":2}');
    expect(lines).toEqual(['{"a":1}']);
    expect(pending).toBe('{"b":2}');
  });

  test("ignore les lignes vides", () => {
    const { lines } = splitCompleteLines('{"a":1}\n\n\n{"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("readHeader", () => {
  test("lit version, id, cwd et parentSession", async () => {
    const path = join(dir, "avec-parent.jsonl");
    await writeFile(
      path,
      JSON.stringify({
        type: "session",
        version: 3,
        id: "s1",
        cwd: "/projet",
        parentSession: "/autre/session.jsonl",
        timestamp: "2026-10-09T00:00:00.000Z",
      }) + "\n",
    );

    const header = await runOrThrow(readHeader(path));
    expect(header.version).toBe(3);
    expect(header.id).toBe("s1");
    expect(header.cwd).toBe("/projet");
    expect(header.parentSession).toBe("/autre/session.jsonl");
  });

  test("parentSession absent reste undefined (pas inventé)", async () => {
    const path = join(dir, "sans-parent.jsonl");
    await writeFile(
      path,
      JSON.stringify({ type: "session", version: 3, id: "s2", cwd: "/p" }) + "\n",
    );

    const header = await runOrThrow(readHeader(path));
    expect(header.parentSession).toBeUndefined();
  });

  test("fichier absent → SessionReadError, pas une exception non typée", async () => {
    const result = await runResult(readHeader(join(dir, "inexistant.jsonl")));
    expect(result._tag).toBe("Failure");
  });
});

describe("tailFrom", () => {
  test("lecture incrémentale par offset, sans relire le début", async () => {
    const path = join(dir, "incremental.jsonl");
    await writeFile(path, ['{"type":"a"}', '{"type":"b"}', ""].join("\n"));

    const first = await runOrThrow(tailFrom(path, 0, ""));
    expect(first.entries.map((e) => e.type)).toEqual(["a", "b"]);
    const offset = first.offset;

    await appendFile(path, '{"type":"c"}\n');
    const second = await runOrThrow(tailFrom(path, offset, first.pending));
    expect(second.entries.map((e) => e.type)).toEqual(["c"]);
    expect(second.entries).toHaveLength(1);
  });

  test("une ligne partielle est conservée puis reconstituée", async () => {
    const path = join(dir, "partielle.jsonl");
    await writeFile(path, '{"type":"complete"}\n{"type":"tron');

    const first = await runOrThrow(tailFrom(path, 0, ""));
    expect(first.entries.map((e) => e.type)).toEqual(["complete"]);
    expect(first.pending).toBe('{"type":"tron');

    await appendFile(path, 'quee"}\n');
    const second = await runOrThrow(tailFrom(path, first.offset, first.pending));
    expect(second.entries.map((e) => e.type)).toEqual(["tronquee"]);
    expect(second.pending).toBe("");
  });

  test("aucune nouvelle donnée → aucune entrée, offset inchangé", async () => {
    const path = join(dir, "stable.jsonl");
    await writeFile(path, '{"type":"a"}\n');
    const first = await runOrThrow(tailFrom(path, 0, ""));
    const second = await runOrThrow(tailFrom(path, first.offset, first.pending));
    expect(second.entries).toEqual([]);
    expect(second.offset).toBe(first.offset);
  });

  test("une ligne illisible est conservée brute, pas perdue", async () => {
    const path = join(dir, "illisible.jsonl");
    await writeFile(path, "pas du json du tout\n");

    const result = await runOrThrow(tailFrom(path, 0, ""));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.type).toBe("unknown");
    expect(result.entries[0]?.raw).toBe("pas du json du tout");
  });

  test("parentId est lu comme appartenance à une branche de conversation", async () => {
    const path = join(dir, "branche.jsonl");
    await writeFile(
      path,
      [
        '{"type":"message","id":"a1","parentId":null,"timestamp":"2026-10-09T00:00:00.000Z"}',
        '{"type":"message","id":"b2","parentId":"a1","timestamp":"2026-10-09T00:00:01.000Z"}',
        "",
      ].join("\n"),
    );

    const result = await runOrThrow(readAll(path));
    expect(result.entries[0]?.parentId).toBeNull();
    expect(result.entries[1]?.parentId).toBe("a1");
  });
});
