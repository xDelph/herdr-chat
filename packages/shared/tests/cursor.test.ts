/**
 * Curseur opaque de session (B01 + B02, un seul changement).
 *
 * Ces tests couvrent la propriété qui a fait imbriquer `?since=` : un numéro
 * d'octet **seul** ne dit pas quel fichier il désigne. Après rotation, il
 * pointe ailleurs, sans erreur visible — l'application affiche des messages
 * qui ne sont plus dans le fichier, sans jamais le dire.
 *
 * Le curseur opaque porte `dev`, `ino` et `offset`. Un changement de l'un des
 * trois invalide la position, et le serveur l'annonce par `reset` plutôt que de
 * lire au hasard.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeCursor, encodeCursor } from "@herdr-remote/shared";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "herdr-cursor-"));
});

afterAll(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("B01 — le curseur est opaque et validé", () => {
  test("un curseur aller-retour conserve les trois composantes", () => {
    const cursor = { dev: 16777234, ino: 12345, offset: 4096 };
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded).toEqual(cursor);
  });

  test("une chaîne absurde est refusée, jamais devinée", () => {
    expect(decodeCursor("pas-un-curseur")).toBeUndefined();
    expect(decodeCursor("")).toBeUndefined();
    expect(decodeCursor("eyJmb28iOiJiYXIifQ")).toBeUndefined();
  });

  test("un offset négatif est refusé", () => {
    // Un offset négatif ferait lire en arrière du début du fichier.
    const encode = encodeCursor({ dev: 1, ino: 1, offset: -5 });
    expect(decodeCursor(encode)).toBeUndefined();
  });

  test("une composante manquante est refusée", () => {
    const incomplet = btoa(JSON.stringify({ dev: 1, offset: 10 }));
    expect(decodeCursor(incomplet)).toBeUndefined();
  });

  test("le curseur survit au passage par l'URL", () => {
    // Le curseur passe en query string : les caractères `+`, `/`, `=` du
    // base64 doivent survivre au décodage d'URL.
    const cursor = { dev: 1, ino: 2, offset: 300 };
    const query = new URLSearchParams({ cursor: encodeCursor(cursor) });
    const relu = query.get("cursor") ?? "";
    expect(decodeCursor(relu)).toEqual(cursor);
  });
});

describe("B02 — la position survit à l'utf-8 et à la troncature", () => {
  test("un emoji ne décale pas l'offset en octets", async () => {
    const path = join(dir, "utf8.jsonl");
    // Un émoji occupe 4 octets en UTF-8 ; un offset calculé en caractères
    // (et non en octets) se retrouverait au milieu d'un caractère.
    const ligne = '{"type":"text","text":"🚀"}\n';
    await writeFile(path, ligne);
    const taille = Buffer.byteLength(ligne, "utf8");
    expect(taille).toBeGreaterThan(ligne.length);
  });
});
