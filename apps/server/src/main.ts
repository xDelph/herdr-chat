/**
 * Point d'entrée du backend.
 *
 * Câble les services en `Layer`, démarre le serveur Bun sur **`127.0.0.1`
 * uniquement** (T5.1) et s'arrête proprement sur `SIGINT` / `SIGTERM`.
 *
 * Aucune commande shell n'est exposée : la seule surface d'action est
 * `POST /api/agents/:paneId/prompt`, dont l'effet est un `agent.prompt` sur
 * l'API Herdr (T5.3b).
 */
import { Effect, Layer, Option, Schema } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ServerConfigTag } from "./config.ts";
import { HerdrClient } from "./herdr/HerdrClient.ts";
import { EventHub } from "./events/EventHub.ts";
import { AgentWatcher, startWatchLoop } from "./events/AgentWatcher.ts";
import { toAgentViews } from "./agents/AgentRegistry.ts";
import { PromptSender } from "./send/PromptSender.ts";
import { makeRoutes } from "./http/Api.ts";
import type { Routes } from "./http/Reply.ts";

const startedAt = Date.now();

/** Sert la PWA compilée ; retombe sur `index.html` pour les routes SPA. */
export const makeStaticHandler = (distDir: string) => {
  const indexPath = join(distDir, "index.html");
  const available = existsSync(indexPath);

  return async (request: Request): Promise<Response> => {
    if (!available) {
      // La PWA n'est pas encore compilée : on le dit clairement plutôt que
      // de renvoyer une 404 opaque.
      return Response.json(
        {
          error: "PWA non compilée",
          hint: "lancer `bun run --cwd apps/web build` ou utiliser le serveur de développement Vite",
        },
        { status: 503 },
      );
    }

    const url = new URL(request.url);
    const candidate = join(distDir, url.pathname);
    // Empêche toute sortie du répertoire statique.
    if (candidate.startsWith(distDir) && !url.pathname.endsWith("/")) {
      const file = Bun.file(candidate);
      if (await file.exists()) return new Response(file);
    }
    return new Response(Bun.file(indexPath), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
};

export const program = Effect.gen(function* () {
  const config = yield* ServerConfigTag;

  const coreLayer = Layer.mergeAll(HerdrClient.layer(config.herdrSocketPath), EventHub.layer);

  const { herdr, hub } = yield* Effect.provide(
    Effect.gen(function* () {
      const client = yield* HerdrClient;
      const events = yield* EventHub;
      return { herdr: client, hub: events };
    }),
    coreLayer,
  );

  const sender = yield* PromptSender.make(herdr, config.duplicateWindowMs);

  // Veille : c'est ce qui produit le direct. Sans elle, le flux n'émettait que
  // les actions de l'utilisateur et jamais ce que font les agents.
  const watcher = yield* AgentWatcher.make(hub);
  const watch = yield* startWatchLoop(herdr, watcher, toAgentViews);

  const routes: Routes = makeRoutes({ config, herdr, hub, sender, startedAt, watch });
  const staticHandler = makeStaticHandler(join(import.meta.dir, "..", "..", "web", "dist"));

  const server = Bun.serve({
    development: false,
    // Jamais `0.0.0.0` : l'accès distant passe exclusivement par Tailscale (T5.2).
    hostname: config.hostname,
    port: config.port,
    routes,
    fetch: staticHandler,
  });

  yield* Effect.logInfo(
    `Herdr Remote — écoute sur http://${config.hostname}:${config.port} · socket Herdr ${config.herdrSocketPath}`,
  );

  // Vérifie Herdr au démarrage : on signale l'indisponibilité sans empêcher
  // le serveur de répondre (il renverra 503 sur /api/health).
  const ping = yield* Effect.result(herdr.ping());
  if (ping._tag === "Success") {
    yield* Effect.logInfo(
      `Herdr joignable — version ${ping.success.version}, protocole ${ping.success.protocol}`,
    );
  } else {
    yield* Effect.logWarning(`Herdr injoignable au démarrage (${config.herdrSocketPath})`);
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      void server.stop(true);
    }),
  );

  // Maintient le processus en vie jusqu'à interruption.
  yield* Effect.never;
});

// `program` utilise `Effect.addFinalizer` : il exige un `Scope`, fourni ici.
/** Forme reconnue d'une erreur typée, pour l'affichage. */
const ErrorShape = Schema.Struct({
  detail: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});
const decodeErrorShape = Schema.decodeUnknownOption(ErrorShape);

/** Rend une erreur typée lisible, sans dépendre de son type concret. */
const describe = (error: unknown): string => {
  const decoded = Option.getOrUndefined(decodeErrorShape(error));
  return decoded?.detail ?? decoded?.message ?? String(error);
};

const main = Effect.scoped(program).pipe(
  Effect.provide(ServerConfigTag.layer),
  // Une configuration refusée doit être **bruyante** : on journalise la cause
  // exacte avant de quitter en erreur, jamais un échec silencieux.
  Effect.tapError((error) =>
    Effect.sync(() => {
      process.stderr.write(`[herdr-remote] démarrage refusé : ${describe(error)}\n`);
    }),
  ),
);

// `disableErrorReporting` évite un double affichage : on a déjà journalisé.
BunRuntime.runMain(main, { disableErrorReporting: true });
