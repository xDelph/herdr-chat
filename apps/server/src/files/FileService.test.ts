/**
 * Tests du service de fichiers — **une surface de sécurité**.
 *
 * Servir des fichiers depuis le disque sur une socket accessible au tailnet est
 * la chose la plus dangereuse de ce projet. Chaque garde-fou est testé, y
 * compris ceux qui ne se déclenchent qu'avec une tentative malveillante.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect, Option, Result, Schema } from "effect";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_FILE_BYTES,
  contentTypeOf,
  isInline,
  isInside,
  readAllowedFile,
} from "./FileService.ts";

let root: string;
let outside: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "herdr-files-"));
  outside = await mkdtemp(join(tmpdir(), "herdr-outside-"));
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(root, "notes.md"), "# titre");
  await writeFile(join(root, "nested", "deep.txt"), "dedans");
  await writeFile(join(outside, "secret.txt"), "SECRET");
  // Lien symbolique sortant : un chemin d'appel légitime, une cible interdite.
  await symlink(join(outside, "secret.txt"), join(root, "lien-piege.txt"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const read = (path: string, roots: ReadonlyArray<string> = [root]) =>
  Effect.runPromise(Effect.result(readAllowedFile(path, roots)));

/**
 * Extrait la raison d'un échec.
 *
 * ⚠️ `Result.getFailure` renvoie un **`Option`** en Effect 4. Le déballer avec
 * `Result.getOrUndefined` produit `undefined` et masque la cause — le piège de
 * D011, revu ici.
 */
const reasonOf = (result: Result.Result<unknown, unknown>): string => {
  const failure = Option.getOrUndefined(Result.getFailure(result));
  // Décodage plutôt qu'assertion : une forme inattendue donne « ? », jamais une
  // exception dans un test.
  const decoded =
    failure === undefined
      ? undefined
      : Option.getOrUndefined(
          Schema.decodeUnknownOption(Schema.Struct({ reason: Schema.String }))(failure),
        );
  return decoded?.reason ?? "?";
};

describe("isInside", () => {
  test("accepte un fichier sous la racine", () => {
    expect(isInside(join(root, "a.txt"), [root])).toBe(true);
  });

  test("accepte la racine elle-même", () => {
    expect(isInside(root, [root])).toBe(true);
  });

  test("REFUSE un dossier frère dont le nom commence pareil", () => {
    // Le piège classique : sans séparateur final, `/projet-malveillant` passe
    // pour un enfant de `/projet`.
    expect(isInside(`${root}-malveillant/f.txt`, [root])).toBe(false);
  });

  test("refuse un chemin hors racine", () => {
    expect(isInside(join(outside, "secret.txt"), [root])).toBe(false);
  });

  test("aucune racine → rien n'est autorisé", () => {
    expect(isInside(join(root, "a.txt"), [])).toBe(false);
  });
});

describe("contentTypeOf / isInline", () => {
  test("les images sont rendues", () => {
    expect(contentTypeOf("/x/a.png")).toBe("image/png");
    expect(isInline("/x/a.png")).toBe(true);
  });

  test("le SVG n'est PAS rendu — il peut porter du script", () => {
    expect(isInline("/x/a.svg")).toBe(false);
    expect(contentTypeOf("/x/a.svg")).toBe("application/octet-stream");
  });

  test("un type inconnu est téléchargé, jamais interprété", () => {
    expect(isInline("/x/a.sh")).toBe(false);
  });
});

describe("readAllowedFile — garde-fous", () => {
  test("lit un fichier légitime", async () => {
    const result = await read(join(root, "notes.md"));
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(value(result).name).toBe("notes.md");
      expect(value(result).contentType).toContain("text/plain");
    }
  });

  test("lit un fichier dans un sous-dossier", async () => {
    expect(Result.isSuccess(await read(join(root, "nested", "deep.txt")))).toBe(true);
  });

  test("REFUSE un fichier hors des racines", async () => {
    const result = await read(join(outside, "secret.txt"));
    expect(Result.isFailure(result)).toBe(true);
    expect(reasonOf(result)).toContain("hors des dossiers");
  });

  test("REFUSE une traversée `..`", async () => {
    const result = await read(join(root, "..", "..", "etc", "passwd"));
    expect(Result.isFailure(result)).toBe(true);
  });

  test("REFUSE un lien symbolique sortant", async () => {
    // Le chemin d'appel est sous la racine ; la cible ne l'est pas.
    const result = await read(join(root, "lien-piege.txt"));
    expect(Result.isFailure(result)).toBe(true);
    expect(reasonOf(result)).toContain("dossiers de projet");
  });

  test("REFUSE un répertoire", async () => {
    const result = await read(join(root, "nested"));
    expect(Result.isFailure(result)).toBe(true);
    expect(reasonOf(result)).toBe("ce n'est pas un fichier");
  });

  test("REFUSE quand aucune racine n'est autorisée", async () => {
    expect(Result.isFailure(await read(join(root, "notes.md"), []))).toBe(true);
  });

  test("fichier introuvable → erreur explicite, jamais un vide", async () => {
    const result = await read(join(root, "absent.txt"));
    expect(Result.isFailure(result)).toBe(true);
    expect(reasonOf(result)).toContain("introuvable");
  });

  test("la taille maximale est bornée et annoncée", () => {
    expect(MAX_FILE_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});

/** Déballe un succès, pour les assertions. */
const value = <A>(result: Result.Result<A, unknown>): A => {
  const inner = Result.getOrThrow(result);
  return inner;
};
