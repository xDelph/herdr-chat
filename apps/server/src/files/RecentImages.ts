/**
 * Images récentes des dossiers autorisés.
 *
 * **Pourquoi.** Prendre une capture et la regarder sur le téléphone ne
 * fonctionnait pas : il fallait connaître le chemin exact, le taper, et le
 * service refusait tout ce qui n'était pas un dépôt git.
 *
 * Ici, l'application **liste** ce qui existe : captures d'écran, images du
 * bureau, téléchargements. Les plus récentes d'abord. On ouvre, on regarde.
 *
 * Le balayage est **borné** : profondeur limitée, nombre de fichiers limité. Une
 * exploration non bornée de `~/Pictures` bloquerait le serveur.
 */
import { Effect, Schema } from "effect";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Extensions rendues comme images. Le SVG est exclu : il peut porter du script. */
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"] as const;

export const isImageFile = (path: string): boolean =>
  IMAGE_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));

export interface RecentImage {
  readonly modifiedAt: number;
  readonly path: string;
  readonly size: number;
}

export class ScanFailed extends Schema.TaggedError<ScanFailed>()("ScanFailed", {
  reason: Schema.String,
}) {}

/** Bornes du balayage. Volontairement basses : mieux vaut une liste partielle qu'un serveur bloqué. */
const MAX_DEPTH = 3;
const MAX_FILES = 400;
const MAX_PER_ROOT = 120;

/**
 * Dossiers jamais parcourus.
 *
 * ⚠️ Sans cette liste, le balayage descendait dans `node_modules` et mettait
 * **5 secondes** — au point que l'interface affichait « aucune image » avant
 * d'avoir la réponse. On ne cherche pas une capture d'écran dans les
 * dépendances.
 */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  "Pods",
  "__pycache__",
  ".venv",
  "venv",
]);

const walk = async (root: string, depth: number, collected: RecentImage[]): Promise<void> => {
  if (depth > MAX_DEPTH || collected.length >= MAX_FILES) return;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    // Dossier illisible ou disparu : on l'ignore, on n'abandonne pas le reste.
    return;
  }

  let perRoot = 0;
  for (const entry of entries) {
    if (collected.length >= MAX_FILES || perRoot >= MAX_PER_ROOT) return;
    if (entry.startsWith(".") || IGNORED_DIRECTORIES.has(entry)) continue;

    const full = join(root, entry);
    try {
      const info = await stat(full);
      if (info.isDirectory()) {
        await walk(full, depth + 1, collected);
        continue;
      }
      if (!info.isFile() || !isImageFile(full)) continue;
      collected.push({ modifiedAt: info.mtimeMs, path: full, size: info.size });
      perRoot += 1;
    } catch {
      continue;
    }
  }
};

/**
 * Liste les images des racines données, **les plus récentes d'abord**.
 *
 * L'erreur d'une racine n'annule pas les autres : un dossier disparu ne doit pas
 * vider l'écran.
 */
export const listRecentImages = (
  roots: ReadonlyArray<string>,
  limit = 60,
): Effect.Effect<ReadonlyArray<RecentImage>> =>
  Effect.gen(function* () {
    const collected: RecentImage[] = [];
    yield* Effect.forEach(roots, (root) => Effect.promise(() => walk(root, 0, collected)), {
      concurrency: 4,
      discard: true,
    });
    return collected.toSorted((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
  });
