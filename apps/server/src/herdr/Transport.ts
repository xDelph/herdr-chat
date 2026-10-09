/**
 * Transport vers le socket Unix de Herdr.
 *
 * Le transport est une **interface injectable** : les tests fournissent une
 * implémentation en mémoire, et aucun test n'exige qu'Herdr tourne sur la
 * machine. C'est une exigence explicite de T3.2.
 *
 * Transport vérifié : **JSON newline-delimited**, un objet par ligne
 * (`docs/PROTOCOL.md` §2.2).
 */
import { Context, Effect, Layer, Schema } from "effect";
import { connect } from "node:net";

/** Échec de transport : socket absent, connexion refusée, flux coupé. */
export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  cause: Schema.Defect(),
  detail: Schema.String,
  socketPath: Schema.String,
}) {}

/**
 * Envoie une ligne et renvoie **la première ligne** de réponse.
 *
 * Une connexion par requête, comme la spike E1–E4 : le serveur Herdr traite
 * chaque paire requête/réponse sur la connexion, et une connexion dédiée évite
 * tout état partagé entre appels concurrents.
 */
const sendOverUnixSocket = (socketPath: string, line: string, timeoutMs: number) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        const socket = connect(socketPath);
        let buffer = "";
        let settled = false;

        const fail = (detail: string) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          reject(new Error(detail));
        };

        const timer = setTimeout(() => fail(`délai de ${timeoutMs} ms dépassé`), timeoutMs);

        socket.on("connect", () => {
          socket.write(`${line}\n`);
        });

        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const newline = buffer.indexOf("\n");
          if (newline === -1) return;
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.end();
          resolve(buffer.slice(0, newline));
        });

        socket.on("error", (error: Error) => {
          clearTimeout(timer);
          fail(error.message);
        });

        socket.on("close", () => {
          clearTimeout(timer);
          fail("connexion fermée avant toute réponse");
        });
      }),
    catch: (cause) =>
      new TransportError({
        cause,
        detail: cause instanceof Error ? cause.message : String(cause),
        socketPath,
      }),
  }).pipe(Effect.withSpan("Transport.send"));

/** Ligne brute envoyée, ligne brute reçue. */
export interface Transport {
  readonly send: (line: string) => Effect.Effect<string, TransportError>;
}

export class TransportTag extends Context.Service<TransportTag, Transport>()(
  "herdr-remote/herdr/Transport",
) {
  /** Implémentation réelle : socket Unix, une connexion par requête. */
  static readonly layer = (socketPath: string, timeoutMs = 15_000) =>
    Layer.succeed(
      TransportTag,
      TransportTag.of({
        send: (line) => sendOverUnixSocket(socketPath, line, timeoutMs),
      }),
    );

  /** Implémentation de test : file d'attente de réponses ou échec forcé. */
  static readonly layerTest = (responses: ReadonlyArray<string | TransportError>) =>
    Layer.effect(
      TransportTag,
      Effect.gen(function* () {
        const queue = yield* Effect.sync(() => [...responses]);
        return TransportTag.of({
          send: () =>
            Effect.gen(function* () {
              const next = yield* Effect.sync(() => queue.shift());
              if (next === undefined) {
                return yield* Effect.fail(
                  new TransportError({
                    cause: "file de réponses vide",
                    detail: "aucune réponse de test disponible",
                    socketPath: "(test)",
                  }),
                );
              }
              if (typeof next === "string") return next;
              return yield* Effect.fail(next);
            }),
        });
      }),
    );
}
