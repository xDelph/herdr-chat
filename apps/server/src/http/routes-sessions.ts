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
import { ApiErrorResponse, SessionResponse, TerminalResponse } from "@herdr-remote/shared";
import type { ServerConfig } from "../config.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import { isMissingFile, readTail, tailFrom } from "../sessions/SessionReader.ts";
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
    const sinceParam = url.searchParams.get("since");
    const tailParam = url.searchParams.get("tail");
    const since = sinceParam === null ? undefined : Number.parseInt(sinceParam, 10);
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
            offset: 0,
            pending: "",
          };

          if (since !== undefined && Number.isInteger(since) && since >= 0) {
            const tailed = yield* Effect.result(tailFrom(path, since, ""));
            return {
              kind: "ok" as const,
              path,
              tailed: Result.isFailure(tailed)
                ? empty
                : (Option.getOrUndefined(Result.getSuccess(tailed)) ?? empty),
              truncated: false,
            };
          }

          const finite =
            Number.isInteger(tailBytes) && tailBytes > 0 ? Math.min(tailBytes, 4_194_304) : 262_144;
          const tailed = yield* Effect.result(readTail(path, finite));
          if (Result.isFailure(tailed)) {
            const failure = failureOf(tailed);
            // Absence de fichier → session vide. Autre erreur → vraie panne.
            if (isMissingFile(failure)) {
              return { kind: "ok" as const, path, tailed: empty, truncated: false };
            }
            return yield* Effect.fail(failure);
          }
          const value = Option.getOrUndefined(Result.getSuccess(tailed));
          if (value === undefined) {
            return { kind: "ok" as const, path, tailed: empty, truncated: false };
          }
          return {
            kind: "ok" as const,
            path,
            tailed: { entries: value.entries, offset: value.offset, pending: value.pending },
            truncated: value.truncated,
          };
        }),
      ),
    );
    {
      if (Result.isFailure(result)) {
        const failure = failureOf(result);
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
      return respond(config.logPath, decoderOf(SessionResponse), {
        entries: value.tailed.entries,
        incremental: since !== undefined,
        offset: value.tailed.offset,
        sessionPath: value.path,
        truncated: value.truncated,
      });
    }
  };

  return { session, terminal };
};
