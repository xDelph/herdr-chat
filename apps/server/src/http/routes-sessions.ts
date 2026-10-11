/**
 * Routes de lecture : lecture du pane, et contenu d'une session.
 *
 * **Déplacement seul (A01)** — aucun changement de comportement, prouvé par
 * les 137 tests et par le test d'identité des routes.
 *
 * Ce module regroupe les deux routes qui partagent une règle métier : le
 * contenu vient **toujours** du fichier de session Pi, jamais de Herdr
 * (D008.1). `revision` vaut 0 en permanence côté Herdr et `events.wait`
 * n'implémente pas `pane_output_changed`, donc aucun rattrapage n'est
 * possible de ce côté.
 *
 * ⚠️ `?tail` et `?since` existent parce que sans eux le chat re-téléchargeait
 * 1,8 Mo toutes les 2,5 s (D012.3). B01 remplacera `?since` par un curseur
 * opaque : ce fichier est donc le point d'entrée de cette migration.
 */
import { Effect, Option, Result, Schema } from "effect";
import {
  ApiErrorResponse,
  decodeCursor,
  encodeCursor,
  SessionResponse,
  TerminalResponse,
} from "@herdr-remote/shared";
import type { ServerConfig } from "../config.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import {
  fileSize,
  isMissingFile,
  readTail,
  SessionPathRejected,
  tailFrom,
} from "../sessions/SessionReader.ts";
import { decoderOf, describe, failureOf, respond, run } from "./Reply.ts";
import type { RouteRequest } from "./Reply.ts";

/** Emplacement `agent_session` d'un agent, tel que le renvoie Herdr. */
const AgentSessionSlot = Schema.Struct({
  agent_session: Schema.optional(
    Schema.NullOr(Schema.Struct({ kind: Schema.String, value: Schema.String })),
  ),
});

const decodeSessionSlot = Schema.decodeUnknownOption(AgentSessionSlot);

/**
 * Chemin du fichier de session, ou `undefined` si l'agent n'en a pas.
 *
 * `kind` n'est lu que s'il vaut `"path"` : Herdr modélise aussi un slot par
 * identifiant, dont la résolution n'est pas vérifiée (D008, `[INCONNU]`). Une
 * capacité non vérifiée n'est pas exposée.
 */
export const sessionPathOf = (agent: unknown): string | undefined => {
  const decoded = Option.getOrUndefined(decodeSessionSlot(agent));
  if (decoded === undefined) return undefined;
  const info = decoded.agent_session;
  if (info === undefined || info === null || info.kind !== "path") return undefined;
  return info.value;
};

/** Fabrique les deux routes. `config` n'est lu que pour son `logPath`. */
export const makeSessionRoutes = (config: ServerConfig, herdr: HerdrApi) => {
  const terminal = (request: RouteRequest): Promise<Response> =>
    run(
      config.logPath,
      Effect.gen(function* () {
        const paneId = request.params["paneId"] ?? "";
        return yield* herdr.readAgent(paneId);
      }),
      (body) => respond(config.logPath, decoderOf(TerminalResponse), body),
    );

  /**
   * Contenu d'une session.
   *
   * Deux modes, et le second est indispensable :
   * - **premier affichage** : `?tail=<octets>` lit la fin du fichier. Sur une
   *   session de 1,8 Mo, tout renvoyer avant la première peinture rend l'écran
   *   inutilisable.
   * - **rafraîchissement** : `?since=<offset>` ne renvoie que le nouveau. Sans
   *   cela, le chat re-téléchargeait 1,8 Mo toutes les 2,5 s.
   */
  const session = async (request: RouteRequest): Promise<Response> => {
    const url = new URL(request.url);
    const tailParam = url.searchParams.get("tail");
    // B01 : le curseur est **opaque** et remplace `?since=`. Un offset nu ne
    // dit pas quel fichier il désigne : après rotation, il pointerait ailleurs,
    // sans erreur visible. Un curseur malformé est un 400, jamais un 0 deviné.
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam === null ? undefined : decodeCursor(cursorParam);
    if (cursorParam !== null && cursor === undefined) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "curseur invalide" },
        400,
      );
    }
    const tailBytes = tailParam === null ? 262_144 : Number.parseInt(tailParam, 10);

    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const paneId = request.params["paneId"] ?? "";
          const payload = yield* herdr.getAgent(paneId);
          const path = sessionPathOf(payload["agent"]);
          if (path === undefined) {
            return { kind: "no-session" as const };
          }
          // Contenu depuis le JSONL Pi — jamais depuis Herdr (D008.1).
          /*
          ⚠️ Un agent fraîchement lancé a un `agent_session` valide vers un
          fichier que Pi **n'a pas encore créé** : le JSONL naît au premier
          message. Ce n'est pas une panne, c'est une session vide. Le dire
          évite une erreur rouge en boucle et un agent qui « ne donne rien ».
        */
          const empty = {
            entries: [] as const,
            hasMore: false,
            identity: { dev: 0, ino: 0 },
            offset: 0,
            pending: "",
          };

          if (cursor !== undefined) {
            // Rotation ou troncature : le curseur ne décrit plus ce fichier.
            // Le client doit **remplacer** sa vue, pas y ajouter — sinon il
            // afficherait des entrées qui ne sont plus dans le fichier.
            const taille = yield* Effect.result(fileSize(path, config.piSessionsRoot));
            if (Result.isFailure(taille)) {
              const failure = Result.getFailure(taille);
              if (isMissingFile(failure)) {
                return { kind: "ok" as const, path, reset: true, tailed: empty, truncated: false };
              }
              return yield* Effect.fail(failure);
            }
            const current = taille.success;
            const rejoueDepuis =
              cursor.dev === current.identity.dev && cursor.ino === current.identity.ino;
            const pasTronque = cursor.offset <= current.size;
            if (!rejoueDepuis || !pasTronque) {
              // Curseur invalide : on **relit la fin** et on l'annonce.
              const rafraichit = yield* Effect.result(
                readTail(path, 262_144, config.piSessionsRoot),
              );
              const valeur = Option.getOrUndefined(Result.getSuccess(rafraichit));
              return {
                kind: "ok" as const,
                path,
                reset: true,
                tailed: valeur ?? empty,
                truncated: valeur?.truncated ?? false,
              };
            }
            const tailed = yield* Effect.result(
              tailFrom(path, cursor.offset, "", config.piSessionsRoot),
            );
            return {
              kind: "ok" as const,
              path,
              reset: false,
              tailed: Result.isFailure(tailed)
                ? empty
                : (Option.getOrUndefined(Result.getSuccess(tailed)) ?? empty),
              truncated: false,
            };
          }

          const finite =
            Number.isInteger(tailBytes) && tailBytes > 0 ? Math.min(tailBytes, 4_194_304) : 262_144;
          const tailed = yield* Effect.result(readTail(path, finite, config.piSessionsRoot));
          if (Result.isFailure(tailed)) {
            const failure = failureOf(tailed);
            // Absence de fichier → session vide. Autre erreur → vraie panne.
            if (isMissingFile(failure)) {
              return { kind: "ok" as const, path, reset: false, tailed: empty, truncated: false };
            }
            return yield* Effect.fail(failure);
          }
          const value = Option.getOrUndefined(Result.getSuccess(tailed));
          if (value === undefined) {
            return { kind: "ok" as const, path, reset: false, tailed: empty, truncated: false };
          }
          return {
            kind: "ok" as const,
            path,
            reset: false,
            tailed: {
              entries: value.entries,
              hasMore: value.hasMore,
              identity: value.identity,
              offset: value.offset,
              pending: value.pending,
            },
            truncated: value.truncated,
          };
        }),
      ),
    );
    {
      if (Result.isFailure(result)) {
        const failure = failureOf(result);
        // Un chemin refusé (S03) est une **décision**, pas une panne : 403 et la
        // cause exacte, là où tout le reste reste un 502.
        if (failure instanceof SessionPathRejected) {
          return respond(
            config.logPath,
            decoderOf(ApiErrorResponse),
            { error: failure.detail },
            403,
          );
        }
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          { error: failure === undefined ? "échec inconnu" : describe(failure) },
          502,
        );
      }
      const value = Option.getOrUndefined(Result.getSuccess(result));
      if (value === undefined) {
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          { error: "résultat de session illisible" },
          500,
        );
      }
      if (value.kind === "no-session") {
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          { error: "aucun chemin de session exploitable pour cet agent" },
          404,
        );
      }
      // Le curseur repart toujours de l'identité **lue**, pas de celle
      // demandée : c'est la seule qui décrit le fichier réellement ouvert.
      const cursorOut = encodeCursor({
        dev: value.tailed.identity.dev,
        ino: value.tailed.identity.ino,
        offset: value.tailed.offset,
      });
      return respond(config.logPath, decoderOf(SessionResponse), {
        cursor: cursorOut,
        entries: value.tailed.entries,
        hasMore: value.tailed.hasMore || value.truncated,
        incremental: cursor !== undefined,
        reset: value.reset,
        sessionPath: value.path,
      });
    }
  };

  return { session, terminal };
};
