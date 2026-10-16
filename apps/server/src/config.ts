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
import { join } from "node:path";
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
  /**
   * Base SQLite d'opencode.
   *
   * ⚠️ **Une base, pas un dossier de sessions.** opencode range *tout* dans un
   * seul fichier (`session_v2`, `session_message`, `permission`…), et une
   * session y est désignée par sa clé primaire — l'identifiant qu'Herdr expose
   * (`ses_…`). Il n'y a donc pas de racine à parcourir, et rien à déduire.
   *
   * Surchargeable pour les tests : sans cela, vérifier la lecture exigerait de
   * toucher à la base de la machine.
   */
  readonly opencodeDbPath: string;
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
 * Chemins connus de la CLI Tailscale.
 *
 * ⚠️ **macOS et Linux.** La première version ne listait que des chemins macOS :
 * Tailscale sur Linux (Homebrew, paquet système, Snap) n'était pas trouvé, on
 * retombait sur le PATH, et sous `systemd` le PATH est minimal — ENOENT, liste
 * d'origines vide, et **toute** la PWA en 403. Le défaut ne se voit pas sur la
 * machine où on développe, seulement chez les autres.
 */
const TAILSCALE_PATHS = [
  // macOS
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/tailscale",
  // Linux et autres — `/usr/local/bin` sert aux deux, il n'est listé qu'une fois.
  "/usr/bin/tailscale",
  "/usr/sbin/tailscale",
  "/usr/local/bin/tailscale",
  "/home/linuxbrew/.linuxbrew/bin/tailscale",
  "/snap/bin/tailscale",
  "/opt/bin/tailscale",
];

/**
 * Résout la CLI Tailscale par **chemin absolu**.
 *
 * ⚠️ Lancé par un superviseur (`brew services`, `systemd`), le PATH est minimal
 * et ne contient pas les chemins d'installation usuels :
 * `execFileSync("tailscale", …)` échouait alors en ENOENT, `tailscaleOrigins`
 * renvoyait `[]`, et **toute** la PWA accédée via Tailscale Serve était refusée
 * en 403. Le binaire est aussi embarqué dans l'app macOS ; on l'essaie en
 * dernier recours. Si aucun chemin n'existe, on rend `tailscale` : le PATH est
 * alors le seul recours, et un lancement interactif y arrive.
 */
const resolveTailscaleBin = (): string => {
  for (const chemin of TAILSCALE_PATHS) {
    if (existsSync(chemin)) return chemin;
  }
  return "tailscale"; // dernier recours : PATH (lancement interactif)
};

/** Le port HTTPS par défaut : le navigateur l'**omet** de `Origin`. */
const PORT_HTTPS_DEFAUT = "443";

/**
 * L'origine que le navigateur enverra pour un `host:port` de Serve.
 *
 * ⚠️ **Le port 443 disparaît de `Origin`.** `tailscale serve` sert sur 443 par
 * défaut, et l'adresse est alors `https://<machine>.<tailnet>.ts.net`, sans
 * port. Écrire `https://…:443` produisait une origine **qui ne correspond à
 * rien** : la PWA était refusée en 403 sur toute machine configurée par défaut,
 * alors que la machine de développement utilisait un port explicite (8790) et
 * passait. Un défaut qui ne se voit que sur les autres configurations — donc
 * jamais pendant qu'on le développe.
 */
const origineHttps = (hostPort: string): string | null => {
  const dernier = hostPort.lastIndexOf(":");
  if (dernier === -1) return `https://${hostPort}`;
  if (dernier === 0) return null;
  const port = hostPort.slice(dernier + 1);
  return port === PORT_HTTPS_DEFAUT
    ? `https://${hostPort.slice(0, dernier)}`
    : `https://${hostPort}`;
};

/**
 * `true` si un handler de Serve pointe vers **notre** backend.
 *
 * ⚠️ **On compare l'hôte et le port, jamais la chaîne.** Serve rapporte la cible
 * telle qu'elle a été écrite : `http://localhost:8791` est aussi valide que
 * `http://127.0.0.1:8791`, et une comparaison textuelle refusait la première —
 * donc aucune origine n'était ajoutée, donc 403.
 *
 * Le **port**, lui, est comparé exactement : un autre service proxifié n'a pas à
 * être autorisé. C'est ce qui distingue « la même machine » de « le même
 * backend ».
 */
const pointeVersBackend = (proxy: string | undefined, port: number): boolean => {
  if (proxy === undefined) return false;
  try {
    const cible = new URL(proxy);
    const hote = cible.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const local = hote === "127.0.0.1" || hote === "localhost" || hote === "::1";
    return local && cible.port === String(port);
  } catch {
    return false;
  }
};

/**
 * Origines HTTPS de cette machine sur son tailnet, **dérivées de la
 * configuration de Serve**.
 *
 * ⚠️ **Pure et exportée, exprès.** C'est la partie qu'on peut vérifier sans
 * Tailscale, et c'est là que vivait le défaut. Lire le format et fabriquer
 * l'origine sont deux choses ; les mêler obligeait à avoir un tailnet configuré
 * pour vérifier quoi que ce soit.
 */
export const originesDeServe = (statut: unknown, port: number): string[] => {
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
    )(statut),
  );

  // Serve non configuré, ou format inattendu : la liste locale suffit.
  if (status?.Web === undefined) return [];

  const origines: string[] = [];
  for (const [hostPort, entry] of Object.entries(status.Web)) {
    if (!Object.values(entry.Handlers).some((handler) => pointeVersBackend(handler.Proxy, port)))
      continue;
    const origine = origineHttps(hostPort);
    if (origine !== null) origines.push(origine);
  }
  return origines;
};

/**
 * Interroge la CLI Tailscale, **une seule fois**, au démarrage.
 *
 * ⚠️ Son absence n'est pas une erreur : sans Serve, la liste locale suffit.
 * C'est un confort, pas une dépendance.
 */
const tailscaleOrigins = (port: number): string[] => {
  try {
    const json = execFileSync(resolveTailscaleBin(), ["serve", "status", "--json"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const parsed: unknown = JSON.parse(json);
    return originesDeServe(parsed, port);
  } catch {
    // Tailscale absent ou Serve non configuré : la liste locale suffit.
    return [];
  }
};

/**
 * Un hôte mis en forme pour une URL.
 *
 * ⚠️ Une adresse IPv6 se met **entre crochets** dans une URL : `fd7a:…:1` seule
 * donnerait `http://fd7a:…:1:8791`, qui n'est pas analysable — et le mode
 * `HERDR_REMOTE_BIND` accepte justement une adresse `fd7a:` du tailnet.
 */
export const hoteUrl = (hote: string): string =>
  hote.includes(":") && !hote.startsWith("[") ? `[${hote}]` : hote;

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
        opencodeDbPath:
          env["OPENCODE_DB"] ?? join(home, ".local", "share", "opencode", "opencode.db"),
        duplicateWindowMs: DUPLICATE_WINDOW_MS,
        logPath: env["HERDR_REMOTE_LOG_PATH"] ?? defaultLogPath(),
        publicOrigins: [
          ...(env["HERDR_REMOTE_PUBLIC_ORIGINS"] ?? env["HERDR_REMOTE_PUBLIC_ORIGIN"] ?? "")
            .split(",")
            .map((origine) => origine.trim())
            .filter((origine) => origine.length > 0),
          // Origine locale, toujours légitime. `localhost` n'a pas à être listé :
          // le garde accepte **tout le loopback**, tous ports confondus.
          `http://127.0.0.1:${String(port)}`,
          // ⚠️ **Sans Serve, le mode documenté (D010) est d'écouter directement
          // sur l'adresse Tailscale** et d'ouvrir `http://100.x.y.z:8791`. Le
          // navigateur envoie alors *cette* origine : sans elle, chaque envoi
          // était refusé en 403 dans le seul mode qui reste quand Serve n'est
          // pas disponible — c'est-à-dire précisément quand on en a besoin.
          ...(isTailnet ? [`http://${hoteUrl(bind)}:${String(port)}`] : []),
          // Origines HTTPS de Tailscale Serve, **lues dans sa configuration**.
          // Sans elles, l'envoi d'un message est refusé en 403 dès qu'on passe
          // par Serve : le navigateur envoie l'origine du proxy, pas celle du
          // backend. Le port compte — Serve peut écouter ailleurs (8790 → 8791)
          // et le port 443 disparaît de l'origine, voir `origineHttps`.
          ...tailscaleOrigins(port),
        ],
        extraFileRoots,
      });
    }),
  );
}
