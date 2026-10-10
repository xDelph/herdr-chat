/**
 * Service de fichiers — lire les artefacts produits par les agents.
 *
 * **Pourquoi.** Un agent produit des captures, des rapports, des images. Ils
 * vivent sur le Mac et étaient **inaccessibles depuis le téléphone** : le
 * backend ne servait que le build de la PWA. Un sous-agent a même passé une
 * tâche entière à *décrire* une capture d'écran, parce que le coordinateur ne
 * pouvait pas la voir.
 *
 * **Sécurité — c'est le cœur du sujet.** Servir des fichiers depuis le disque
 * sur une socket accessible au tailnet est une surface dangereuse. Quatre
 * garde-fous, tous appliqués dans l'ordre :
 *
 * 1. **racines autorisées** — uniquement les dossiers de travail des projets
 *    connus, résolus à chaud depuis le snapshot Herdr. Pas de racine globale.
 * 2. **résolution puis vérification** — le chemin est résolu *avant* d'être
 *    comparé. Une comparaison textuelle se contourne avec `..` ou un lien
 *    symbolique ; `resolve` + préfixe ne se contourne pas.
 * 3. **fichiers réguliers uniquement** — jamais de répertoire, jamais de
 *    périphérique, jamais de FIFO.
 * 4. **taille bornée** — un fichier trop gros est refusé, pas tronqué en
 *    silence.
 */
import { Effect, Schema } from "effect";
import { realpathSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

/** Taille maximale servie. Au-delà : refus explicite, jamais une troncature muette. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

/**
 * Types servis **avec** rendu navigateur.
 *
 * Liste blanche volontaire : tout ce qui n'y figure pas est servi en
 * `application/octet-stream`, donc **téléchargé, jamais interprété**. Un SVG est
 * exclu : il peut porter du script.
 */
const INLINE_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".json": "text/plain; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".diff": "text/plain; charset=utf-8",
  ".patch": "text/plain; charset=utf-8",
};

export const contentTypeOf = (path: string): string => {
  const extension = extname(path).toLowerCase();
  return INLINE_TYPES[extension] ?? "application/octet-stream";
};

/** `true` si le type est rendu par le navigateur plutôt que téléchargé. */
export const isInline = (path: string): boolean => extname(path).toLowerCase() in INLINE_TYPES;

/**
 * Vérifie qu'un chemin résolu est bien **sous** une racine autorisée.
 *
 * Le `sep` final est indispensable : sans lui, `/projets/herdr-pwa-malveillant`
 * passerait pour un enfant de `/projets/herdr-pwa`.
 */
export const isInside = (candidate: string, roots: ReadonlyArray<string>): boolean =>
  roots.some((root) => {
    const normalized = resolve(root);
    return candidate === normalized || candidate.startsWith(normalized + sep);
  });

export interface FileResult {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly name: string;
  readonly size: number;
}

export class FileDenied extends Schema.TaggedError<FileDenied>()("FileDenied", {
  reason: Schema.String,
}) {}

export class FileUnavailable extends Schema.TaggedError<FileUnavailable>()("FileUnavailable", {
  reason: Schema.String,
}) {}

/**
 * Lit un fichier sous une racine autorisée.
 *
 * `realpath` résout les liens symboliques : un lien pointant hors des racines
 * est refusé, même si son chemin d'appel paraît légitime.
 */
export const readAllowedFile = (
  requested: string,
  roots: ReadonlyArray<string>,
): Effect.Effect<FileResult, FileDenied | FileUnavailable> =>
  Effect.gen(function* () {
    if (roots.length === 0) {
      return yield* Effect.fail(new FileDenied({ reason: "aucun projet autorisé" }));
    }

    const resolved = resolve(requested);

    // 1) Vérification **avant** toute I/O sur le chemin résolu.
    if (!isInside(resolved, roots)) {
      return yield* Effect.fail(new FileDenied({ reason: "hors des dossiers de projet" }));
    }

    // 2) Résolution des liens symboliques, puis re-vérification.
    const real = yield* Effect.tryPromise({
      try: () => realpath(resolved),
      catch: () => new FileUnavailable({ reason: "fichier introuvable" }),
    });

    // ⚠️ Les racines doivent être résolues **aussi**. Sur macOS, `/var` est un
    // lien vers `/private/var` : comparer un chemin réel à une racine non
    // résolue refuse des fichiers parfaitement légitimes. C'est le test
    // « lit un fichier légitime » qui a révélé ce défaut.
    // Race de résolution synchrone : quelques racines seulement, et une racine
    // disparue ne doit pas faire échouer la lecture des autres.
    const realRoots = yield* Effect.sync(() =>
      roots.map((root) => {
        try {
          return realpathSync(root);
        } catch {
          return root;
        }
      }),
    );
    if (!isInside(real, realRoots)) {
      return yield* Effect.fail(new FileDenied({ reason: "lien sortant des dossiers de projet" }));
    }

    // 3) Fichier régulier uniquement.
    const info = yield* Effect.tryPromise({
      try: () => stat(real),
      catch: () => new FileUnavailable({ reason: "fichier introuvable" }),
    });
    if (!info.isFile()) {
      return yield* Effect.fail(new FileDenied({ reason: "ce n'est pas un fichier" }));
    }

    // 4) Taille bornée.
    if (info.size > MAX_FILE_BYTES) {
      return yield* Effect.fail(
        new FileDenied({
          reason: `fichier trop gros (${String(Math.round(info.size / 1024 / 1024))} Mo, maximum ${String(MAX_FILE_BYTES / 1024 / 1024)} Mo)`,
        }),
      );
    }

    const handle = yield* Effect.tryPromise({
      try: () => open(real, "r"),
      catch: () => new FileUnavailable({ reason: "fichier illisible" }),
    });
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        try {
          const buffer = Buffer.alloc(info.size);
          const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
          return new Uint8Array(buffer.subarray(0, bytesRead));
        } finally {
          await handle.close();
        }
      },
      catch: () => new FileUnavailable({ reason: "lecture interrompue" }),
    });

    return {
      bytes,
      contentType: contentTypeOf(real),
      name: real.split(sep).pop() ?? "fichier",
      size: info.size,
    };
  });

/** Rend une erreur de fichier lisible, sans divulguer la structure du disque. */
export const describeFileError = (error: FileDenied | FileUnavailable): string => error.reason;
