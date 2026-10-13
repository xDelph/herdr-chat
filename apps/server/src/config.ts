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
import { DEFAULT_BACKEND_PORT, DUPLICATE_WINDOW_MS } from "@herdr-remote/shared";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { defaultLogPath } from "./logging/LogFile.ts";

export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
  detail: Schema.String,
}) {}

export interface ServerConfig {
  /** Chemin du socket de l'API Herdr (couche A). */
  readonly herdrSocketPath: string;
  /** Racine des sessions Pi. Jamais devinée par projet : Herdr fournit le chemin. */
  readonly sessionRoots: ReadonlyArray<string>;
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
  /**
   * Chemin du journal d'erreurs.
   *
   * Injecté plutôt que calculé : la constante `~/.herdr-remote/…` faisait que
   * **chaque test écrivait dans le journal de l'utilisateur** (mesuré : les
   * entrées `[server]` des tests atterrissent à côté des vraies pannes). Un
   * test passe un répertoire temporaire.
   */
  readonly logPath: string;
  /**
   * Origine **exacte** de la PWA, pour le contrôle CSRF (S02).
   *
   * Comparées caractère par caractère : un motif laxiste laisserait passer
   * `https://macbook.ts.net.evil.com`.
   *
   * ⚠️ **Pourquoi une liste.** La PWA est servie par ce serveur, mais on peut
   * l'ouvrir par plusieurs adresses qui pointent pourtant sur lui :
   * `127.0.0.1`, `localhost`, le nom Tailscale. Le navigateur envoie l'origine
   * de la page, et une seule valeur refusait les deux autres — l'envoi depuis le
   * téléphone devenait impossible sans que l'erreur dise laquelle.
   *
   * Ce n'est **pas** un élargissement : une page tierce ne peut pas forger un
   * en-tête `Origin`, et chacune de ces adresses sert ce serveur. La liste est
   * déclarée à la main dans l'environnement, jamais devinée.
   */
  readonly publicOrigins: ReadonlyArray<string>;
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

/**
 * Origines HTTPS de la machine sur son tailnet.
 *
 * ⚠️ Tailscale Serve expose la PWA en `https://<machine>.<tailnet>.ts.net`, et
 * le navigateur envoie **cette** origine. La liste blanche ne la connaissant
 * pas, toute requête mutante était refusée en 403 — l'envoi de message ne
 * fonctionnait plus.
 *
 * On interroge `tailscale` une seule fois, au démarrage. Son absence n'est pas
 * une erreur : la liste locale suffit alors.
 */
const tailscaleOrigins = (port: number): string[] => {
  try {
    const json = execFileSync("tailscale", ["serve", "status", "--json"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const parsed: unknown = JSON.parse(json);

    const status = Option.getOrUndefined(
      Schema.decodeUnknownOption(
        Schema.Struct({
          Web: Schema.optional(
            Schema.Record(
              Schema.String,
              Schema.Struct({
                Handlers: Schema.Record(
                  Schema.String,
                  Schema.Struct({ Proxy: Schema.optional(Schema.String) }),
                ),
              }),
            ),
          ),
        }),
      )(parsed),
    );
    if (status?.Web === undefined) return [];

    const expected = `http://127.0.0.1:${String(port)}`;
    return (
      Object.entries(status.Web)
        // On ne retient que l'entrée qui pointe vers **notre** backend : une autre
        // machine ou un autre service proxifié n'a pas à être autorisé.
        .filter(([, entry]) =>
          Object.values(entry.Handlers).some((handler) => handler.Proxy === expected),
        )
        .map(([hostPort]) => `https://${hostPort}`)
    );
  } catch {
    // Tailscale absent ou Serve non configuré : la liste locale suffit.
    return [];
  }
};

export class ServerConfigTag extends Context.Service<ServerConfigTag, ServerConfig>()(
  "herdr-remote/Config",
) {
  static readonly layer = Layer.effect(
    ServerConfigTag,
    Effect.gen(function* () {
      const env = yield* Effect.sync(() => process.env);
      const home = yield* Effect.sync(() => homedir());

      const socketPath = env["HERDR_SOCKET_PATH"] ?? `${home}/.config/herdr/herdr.sock`;
      // Port **local** : `tailscale serve` retransmet le port HTTPS 8790 vers
      // 8791. 8765 reste interdit (occupé par `print-cost-report`), 3000 aussi
      // (OrbStack). Défaut et validation vivent dans `packages/shared/src/port.ts`
      // et le même défaut est relu par le proxy de développement.
      const portRaw = env["HERDR_REMOTE_PORT"] ?? String(DEFAULT_BACKEND_PORT);
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
              `HERDR_REMOTE_BIND = “${bind}” refused. Expected 127.0.0.1 or a ` +
              `Tailscale address (100.x.y.z / fd7a:…). Never 0.0.0.0 or a public IP.`,
          }),
        );
      }

      /**
       * Racines **supplémentaires**, vides par défaut.
       *
       * ⚠️ J'avais ajouté Bureau, Téléchargements, Images et le dossier média
       * de CleanShot. C'était trop : l'application exposait les fichiers
       * personnels de la machine au lieu de ce qui **appartient au travail des
       * agents**.
       *
       * Seuls les dossiers de travail des projets sont lus. Ce qu'un agent
       * produit, ou ce qu'un outil capture, vit là.
       */
      const extraFileRoots = (env["HERDR_REMOTE_FILES_ROOTS"] ?? "")
        .split(":")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && existsSync(entry));

      return ServerConfigTag.of({
        // `HERDR_SOCKET` (couche B) n'est délibérément jamais lu ici.
        herdrSocketPath: socketPath,
        // ⚠️ Un dossier par agent : chaque type écrit ses sessions chez lui. La
        // liste est le seul endroit qui décide de ce qui est lisible.
        sessionRoots: [
          env["PI_SESSIONS_ROOT"] ?? `${home}/.pi/agent/sessions`,
          env["CODEX_SESSION_ROOT"] ?? `${home}/.codex/sessions`,
        ],
        port,
        hostname: bind,
        duplicateWindowMs: DUPLICATE_WINDOW_MS,
        logPath: env["HERDR_REMOTE_LOG_PATH"] ?? defaultLogPath(),
        publicOrigins: [
          ...(env["HERDR_REMOTE_PUBLIC_ORIGINS"] ?? env["HERDR_REMOTE_PUBLIC_ORIGIN"] ?? "")
            .split(",")
            .map((origine) => origine.trim())
            .filter((origine) => origine.length > 0),
          // Origine locale, toujours légitime.
          `http://127.0.0.1:${String(port)}`,
          // Origines HTTPS de Tailscale Serve, **lues dans sa configuration**.
          // Sans elles, l'envoi d'un message est refusé en 403 dès qu'on passe
          // par Serve : le navigateur envoie l'origine du proxy, pas celle du
          // backend. Le port compte : Serve peut écouter ailleurs (8790 → 8791).
          ...tailscaleOrigins(port),
        ],
        extraFileRoots,
      });
    }),
  );
}
