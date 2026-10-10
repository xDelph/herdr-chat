/**
 * Configuration du backend.
 *
 * Deux variables d'environnement aux noms **dangereusement proches** ne doivent
 * jamais être confondues (D008, écart E5) :
 *
 * - `HERDR_SOCKET_PATH` → **couche A**, l'API socket de Herdr (ce qu'on utilise)
 * - `HERDR_SOCKET`      → **couche B**, le bus d'agents, hors périmètre MVP
 *
 * On ne lit donc **que** `HERDR_SOCKET_PATH`, jamais l'autre.
 */
import { Context, Effect, Layer, Schema } from "effect";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  detail: Schema.String,
}) {}

export interface ServerConfig {
  /** Chemin du socket de l'API Herdr (couche A). */
  readonly herdrSocketPath: string;
  /** Racine des sessions Pi. Jamais devinée par projet : Herdr fournit le chemin. */
  readonly piSessionsRoot: string;
  /** Port d'écoute. Toujours lié à `127.0.0.1` (T5.1). */
  readonly port: number;
  /**
   * Hôte d'écoute.
   *
   * Par défaut **`127.0.0.1`**, sans exception. Peut être porté à l'adresse
   * Tailscale de la machine (`100.x.y.z`) quand `tailscale serve` n'est pas
   * disponible — voir D010. **Jamais `0.0.0.0`** : le contrôle est explicite.
   */
  readonly hostname: string;
  /** Fenêtre de suppression des envois identiques consécutifs (D007.2). */
  readonly duplicateWindowMs: number;
  /** Répertoire des pièces jointes uploadées (D007.1). */
  readonly uploadDir: string;
  /**
   * Racines **supplémentaires** pour la lecture de fichiers.
   *
   * Les dossiers de travail des projets sont toujours autorisés. Ceux-ci
   * s'ajoutent : captures d'écran, téléchargements, images. Sans eux, une
   * capture prise avec CleanShot est refusée — ce qui rendait la vue fichiers
   * inutilisable pour son usage le plus évident.
   */
  readonly extraFileRoots: ReadonlyArray<string>;
}

export class ServerConfigTag extends Context.Service<ServerConfigTag, ServerConfig>()(
  "herdr-remote/Config",
) {
  static readonly layer = Layer.effect(
    ServerConfigTag,
    Effect.gen(function* () {
      const env = yield* Effect.sync(() => process.env);
      const home = yield* Effect.sync(() => homedir());

      const socketPath = env["HERDR_SOCKET_PATH"] ?? `${home}/.config/herdr/herdr.sock`;
      // 8790 par défaut : 8765 est occupé par `print-cost-report`, et 3000 est pris.
      const portRaw = env["HERDR_REMOTE_PORT"] ?? "8790";
      const port = Number.parseInt(portRaw, 10);

      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        return yield* Effect.fail(
          new ConfigError({ detail: `HERDR_REMOTE_PORT invalide : « ${portRaw} »` }),
        );
      }

      // Écoute : `127.0.0.1` par défaut. Toute autre valeur doit être une
      // adresse Tailscale (`100.` ou `fd7a:`), jamais une adresse publique.
      const bind = env["HERDR_REMOTE_BIND"] ?? "127.0.0.1";
      const isTailnet = bind.startsWith("100.") || bind.startsWith("fd7a:");
      if (bind !== "127.0.0.1" && !isTailnet) {
        return yield* Effect.fail(
          new ConfigError({
            detail:
              `HERDR_REMOTE_BIND = « ${bind} » refusé. Attendu 127.0.0.1 ou une ` +
              `adresse Tailscale (100.x.y.z / fd7a:…). Jamais 0.0.0.0 ni une IP publique.`,
          }),
        );
      }

      /**
       * Dossiers de médias ajoutés par défaut, **s'ils existent**.
       *
       * Le service est local, lié à `127.0.0.1` ou à l'IP Tailscale, et sans
       * en-tête CORS : aucun site web tiers ne peut le lire depuis un
       * navigateur. La liste reste **explicite et bornée** — pas de `$HOME`.
       */
      const mediaDefaults = [
        `${home}/Desktop`,
        `${home}/Downloads`,
        `${home}/Pictures`,
        `${home}/Library/Application Support/CleanShot/media`,
      ];
      const configured = (env["HERDR_REMOTE_FILES_ROOTS"] ?? "")
        .split(":")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

      const extraFileRoots = [...configured, ...mediaDefaults].filter((root) => existsSync(root));

      return ServerConfigTag.of({
        // `HERDR_SOCKET` (couche B) n'est délibérément jamais lu ici.
        herdrSocketPath: socketPath,
        piSessionsRoot: env["PI_SESSIONS_ROOT"] ?? `${home}/.pi/agent/sessions`,
        port,
        hostname: bind,
        duplicateWindowMs: 60_000,
        extraFileRoots,
        uploadDir: env["HERDR_REMOTE_UPLOAD_DIR"] ?? `${home}/.herdr-remote/uploads`,
      });
    }),
  );
}
