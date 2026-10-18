/**
 * Confinement des assets web (S05).
 *
 * Le serveur retombe sur `index.html` pour toute route inconnue — c'est ce qui
 * permet à un rechargement sur `#/agent/…` de fonctionner. Mais ce repli rend
 * la fuite triviale : sans confinement, `/../../etc/passwd` servirait le
 * fichier au lieu de tomber sur `index.html`.
 *
 * Chaque cas négatif vérifie qu'**aucun contenu hors du build** n'est livré.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWithin, resolveAsset } from "../../src/http/AssetGuard.ts";

let TMP = "";
let BUILD = "";
let OUTSIDE = "";
let indexHtml = "";

beforeAll(async () => {
  TMP = await mkdtemp(join(tmpdir(), "herdr-assets-"));
  BUILD = join(TMP, "dist");
  OUTSIDE = join(TMP, "outside");
  await mkdir(join(BUILD, "assets"), { recursive: true });
  await mkdir(OUTSIDE, { recursive: true });
  indexHtml = join(BUILD, "index.html");
  await writeFile(indexHtml, "<html>app</html>");
  await writeFile(join(BUILD, "sw.js"), "service-worker");
  await writeFile(join(BUILD, "assets", "index-CXgPPgVH.js"), "bundle");
  await writeFile(join(OUTSIDE, "secret.txt"), "SECRET-INTERNE");
});

afterAll(async () => {
  await rm(TMP, { force: true, recursive: true });
});

describe("isWithin — segments, jamais préfixe", () => {
  test("un fils direct passe", () => {
    expect(isWithin("/a/b", "/a/b/c")).toBe(true);
  });

  test("la racine passe", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true);
  });

  /** Le piège : `/dist-malveillant` est un frère de `/dist`, pas un fils. */
  test("un dossier au préfixe similar est refusé", () => {
    expect(isWithin("/x/dist", "/x/dist-malveillant")).toBe(false);
    expect(isWithin("/x/dist", "/x/dist_evil/a.js")).toBe(false);
  });

  test("un parent est refusé", () => {
    expect(isWithin("/a/b/c", "/a/b")).toBe(false);
  });
});

describe("resolveAsset — ce qui est servi reste dans le build", () => {
  test("un asset normal est servi", async () => {
    const asset = await resolveAsset(BUILD, "/sw.js");
    expect(asset).toBeDefined();
    expect(asset?.endsWith("sw.js")).toBe(true);
  });

  test("un asset imbriqué est servi", async () => {
    const asset = await resolveAsset(BUILD, "/assets/index-CXgPPgVH.js");
    expect(asset).toBeDefined();
  });

  test("une traversée `../` est refusée", async () => {
    expect(await resolveAsset(BUILD, "/../outside/secret.txt")).toBeUndefined();
    expect(await resolveAsset(BUILD, "/assets/../../outside/secret.txt")).toBeUndefined();
  });

  test("une traversée encodée est refusée aussi", async () => {
    // `%2e%2e%2f` vaut `../` une fois interprété par le système de fichiers.
    // C'est le piège classique d'un décodage effectué après la normalisation.
    expect(await resolveAsset(BUILD, "/%2e%2e%2foutside%2fsecret.txt")).toBeUndefined();
    expect(await resolveAsset(BUILD, "/..%2f..%2foutside%2fsecret.txt")).toBeUndefined();
  });

  test("un dossier frère au préfixe similar est refusé", async () => {
    await mkdir(join(TMP, "dist-malveillant"), { recursive: true });
    await writeFile(join(TMP, "dist-malveillant", "vole.js"), "VOL");
    // `startsWith(BUILD)` aurait laissé passer `/…/dist-malveillant/vole.js` :
    // c'est le piège que la comparaison par segments ferme.
    expect(await resolveAsset(BUILD, "/../dist-malveillant/vole.js")).toBeUndefined();
  });

  test("un lien symbolique sortant est refusé", async () => {
    const link = join(BUILD, "sortie.txt");
    try {
      await symlink(join(OUTSIDE, "secret.txt"), link);
    } catch {
      return;
    }
    // Le chemin est dans le build, sa cible non plus : rien ne doit être livré.
    expect(await resolveAsset(BUILD, "/sortie.txt")).toBeUndefined();
  });

  test("un lien symbolique interne est servi", async () => {
    const link = join(BUILD, "vers-sw.js");
    try {
      await symlink(join(BUILD, "sw.js"), link);
    } catch {
      return;
    }
    expect(await resolveAsset(BUILD, "/vers-sw.js")).toBeDefined();
  });

  test("un fichier absent donne undefined : l'appelant sert index.html", async () => {
    expect(await resolveAsset(BUILD, "/route-inconnue")).toBeUndefined();
  });

  test("un build absent donne undefined, jamais de fuite", async () => {
    expect(await resolveAsset(join(TMP, "pas-de-build"), "/sw.js")).toBeUndefined();
  });

  test("remonter au-delà de la racine est refusé", async () => {
    expect(await resolveAsset(BUILD, "/../../../etc/passwd")).toBeUndefined();
    expect(await resolveAsset(BUILD, "/..")).toBeUndefined();
  });

  test("un chemin encodé invalide ne lève pas", async () => {
    // `%` isolé : `decodeURIComponent` lève. Le handler ne doit pas tomber.
    expect(await resolveAsset(BUILD, "/%")).toBeUndefined();
  });
});
