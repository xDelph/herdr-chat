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
import { open, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

/** Taille maximale servie. Au-delà : refus explicite, jamais une troncature muette. */
/** Réexporté depuis le contrat partagé (S06) — une seule valeur, deux côtés. */
export { MAX_FILE_BYTES } from "@herdr-remote/shared";

import { MAX_FILE_BYTES as MAX_FILE } from "@herdr-remote/shared";

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
 * Points d'observation, pour les tests.
 *
 * Existaient pas en production : sans une couture, on ne peut pas fabriquer la
 * fenêtre entre l'ouverture et le `stat`. Un test qui ne peut pas déclencher la
 * race ne prouve pas que la course est fermée.
 */
export interface FileServiceHooks {
  /** Appelé après l'ouverture, **avant** le `stat`. */
  readonly afterOpen?: () => Promise<void>;
}

/**
 * Lit un fichier sous une racine autorisée.
 *
 * `realpath` résout les liens symboliques : un lien pointant hors des racines
 * est refusé, même si son chemin d'appel paraît légitime.
 */
export const readAllowedFile = (
  requested: string,
  roots: ReadonlyArray<string>,
  hooks: FileServiceHooks = {},
): Effect.Effect<FileResult, FileDenied | FileUnavailable> =>
  Effect.gen(function* () {
    if (roots.length === 0) {
      return yield* Effect.fail(new FileDenied({ reason: "no authorized project" }));
    }

    const resolved = resolve(requested);

    // 1) Vérification **avant** toute I/O sur le chemin résolu.
    if (!isInside(resolved, roots)) {
      return yield* Effect.fail(new FileDenied({ reason: "outside the project folders" }));
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
      return yield* Effect.fail(new FileDenied({ reason: "symlink escaping the project folders" }));
    }

    // 3) Ouverture, puis `stat` et lecture sur **le même descripteur** (S04).
    //
    // ⚠️ Avec `stat(real)` puis `open(real)`, deux opérations séparées se
    // succèdent sur le même *chemin*. Entre les deux, un agent peut remplacer
    // le fichier : le `stat` décrit l'ancien, la lecture renvoie le nouveau. Le
    // contrôle « est-ce un fichier régulier » et la borne de taille s'appliquent
    // alors à un fichier qui n'est plus celui servi.
    //
    // En ouvrant d'abord et en interrogeant le descripteur, ces contrôles
    // portent sur **exactement** l'objet qui sera lu.
    const handle = yield* Effect.tryPromise({
      try: () => open(real, "r"),
      catch: () => new FileUnavailable({ reason: "fichier illisible" }),
    });

    // La couture n'existe que pour les tests ; en production elle est absente et
    // ce `if` est toujours faux.
    if (hooks.afterOpen !== undefined) {
      yield* Effect.promise(() => hooks.afterOpen?.() ?? Promise.resolve());
    }

    const info = yield* Effect.tryPromise({
      try: () => handle.stat(),
      catch: () => new FileUnavailable({ reason: "fichier illisible" }),
    });

    if (!info.isFile()) {
      // Fuite garantie : le descripteur a été ouvert, il faut le rendre.
      yield* Effect.promise(() => handle.close());
      return yield* Effect.fail(new FileDenied({ reason: "not a file" }));
    }

    // 4) Taille bornée.
    if (info.size > MAX_FILE) {
      yield* Effect.promise(() => handle.close());
      return yield* Effect.fail(
        new FileDenied({
          reason: `fichier trop gros (${String(Math.round(info.size / 1024 / 1024))} Mo, maximum ${String(MAX_FILE / 1024 / 1024)} Mo)`,
        }),
      );
    }

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
