/**
 * Tests du service de fichiers — **une surface de sécurité**.
 *
 * Servir des fichiers depuis le disque sur une socket accessible au tailnet est
 * la chose la plus dangereuse de ce projet. Chaque garde-fou est testé, y
 * compris ceux qui ne se déclenchent qu'avec une tentative malveillante.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect, Option, Result, Schema } from "effect";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_FILE_BYTES,
  contentTypeOf,
  isInline,
  isInside,
  readAllowedFile,
} from "../../src/files/FileService.ts";
import type { FileServiceHooks } from "../../src/files/FileService.ts";

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

const read = (path: string, roots: ReadonlyArray<string> = [root], hooks: FileServiceHooks = {}) =>
  Effect.runPromise(Effect.result(readAllowedFile(path, roots, hooks)));

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
    expect(reasonOf(result)).toContain("outside the project folders");
  });

  test("REFUSE une traversée `..`", async () => {
    const result = await read(join(root, "..", "..", "etc", "passwd"));
    expect(Result.isFailure(result)).toBe(true);
  });

  test("REFUSE un lien symbolique sortant", async () => {
    // Le chemin d'appel est sous la racine ; la cible ne l'est pas.
    const result = await read(join(root, "lien-piege.txt"));
    expect(Result.isFailure(result)).toBe(true);
    expect(reasonOf(result)).toContain("project folders");
  });

  test("REFUSE un répertoire", async () => {
    const result = await read(join(root, "nested"));
    expect(Result.isFailure(result)).toBe(true);
    expect(reasonOf(result)).toBe("not a file");
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

describe("descripteur unique — S04", () => {
  /**
   * **Ce que ce test protège.** Avant S04, le service faisait `stat(chemin)`
   * puis `open(chemin)` : deux opérations distinctes. Entre les deux, un agent
   * pouvait substituer le fichier — le contrôle « fichier régulier » et la
   * borne de taille décrivaient alors un fichier qui n'était plus celui servi.
   *
   * Le test reproduit cette fenêtre : le chemin est remplacé **entre** l'ouverture
   * et le `stat`. Avec un descripteur unique, la substitution n'a aucun effet.
   */
  test("remplacer le chemin APRÈS l'ouverture est sans effet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-race-"));
    const cible = join(dir, "cible.txt");
    await writeFile(cible, "ORIGINAL");

    // La substitution a lieu exactement entre l'ouverture et le `stat` — la
    // fenêtre que S04 referme.
    const result = await read(cible, [dir], {
      afterOpen: async () => {
        await rename(cible, join(dir, "ancien.txt"));
        await writeFile(cible, "PIEGE");
      },
    });

    expect(Result.isFailure(result)).toBe(false);
    const file = Result.getOrThrow(result);
    // C'est ORIGINAL qui est servi, pas PIEGE : le contrôle de taille et la
    // lecture portent sur le descripteur, donc sur l'objet réellement ouvert.
    expect(Buffer.from(file.bytes).toString("utf8")).toBe("ORIGINAL");
    expect(file.size).toBe("ORIGINAL".length);

    await rm(dir, { force: true, recursive: true });
  });

  test("la borne de taille suit le fichier réellement ouvert", async () => {
    const dir = await mkdtemp(join(tmpdir(), "herdr-race3-"));
    const cible = join(dir, "cible.txt");
    await writeFile(cible, "PETIT");

    // Après l'ouverture, le chemin est remplacé par un fichier **énorme**.
    // Avec un `stat` postérieur à la substitution, la lecture serait tentée sur
    // ce gros fichier et le service servirait autre chose que ce qu'il a
    // contrôlé. Ici le descripteur reste sur le petit fichier.
    const result = await read(cible, [dir], {
      afterOpen: async () => {
        await rename(cible, join(dir, "ancien.txt"));
        await writeFile(cible, "X".repeat(MAX_FILE_BYTES + 1));
      },
    });

    expect(Result.isFailure(result)).toBe(false);
    expect(Buffer.from(Result.getOrThrow(result).bytes).toString("utf8")).toBe("PETIT");

    await rm(dir, { force: true, recursive: true });
  });

  test("un fichier remplacé entre stat et lecture reste borné par son propre taille", async () => {
    // Un fichier qui grossit après le contrôle doit être lu selon la taille du
    // descripteur, pas selon une taille devenue fausse.
    const dir = await mkdtemp(join(tmpdir(), "herdr-race2-"));
    const cible = join(dir, "grand.txt");
    await writeFile(cible, "x".repeat(1024));
    const result = await read(cible, [dir]);
    expect(Result.isFailure(result)).toBe(false);
    const file = Result.getOrThrow(result);
    expect(file.bytes.length).toBe(1024);
    await rm(dir, { recursive: true, force: true });
  });
});

/** Déballe un succès, pour les assertions. */
const value = <A>(result: Result.Result<A, unknown>): A => {
  const inner = Result.getOrThrow(result);
  return inner;
};
