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
import { existsSync } from "node:fs";
import {
  ApiErrorResponse,
  decodeCursor,
  SESSION_TAIL_BYTES,
  SESSION_TAIL_HARD_CAP,
  encodeCursor,
  SessionResponse,
} from "@herdr-remote/shared";
import { sourceSession } from "../agents/SessionLocator.ts";
import type { SourceSession } from "../agents/SessionLocator.ts";
import { moteurOpencode } from "../sessions/OpencodeReader.ts";
import { moteurDevin } from "../sessions/DevinReader.ts";
import type { ServerConfig } from "../config.ts";
import { classifyReadFailure, invalidSession, statusFor } from "../sessions/ReadCause.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import {
  fileSize,
  isMissingFile,
  readBefore,
  readTail,
  SessionPathRejected,
  tailFrom,
} from "../sessions/SessionReader.ts";
import { decoderOf, describe, failureOf, respond } from "./Reply.ts";
import type { RouteRequest } from "./Reply.ts";

/** Emplacement `agent_session` d'un agent, tel que le renvoie Herdr. */
const AgentSessionSlot = Schema.Struct({
  agent_session: Schema.optional(
    Schema.NullOr(Schema.Struct({ kind: Schema.String, value: Schema.String })),
  ),
});

const decodeSessionSlot = Schema.decodeUnknownOption(AgentSessionSlot);

/** Type d'agent, tel que Herdr le nomme. Sert à savoir si un `id` est résoluble. */
const decodeAgentKind = Schema.decodeUnknownOption(
  Schema.Struct({ agent: Schema.optional(Schema.NullOr(Schema.String)) }),
);

/**
 * Chemin du fichier de session, ou `undefined` si l'agent n'en a pas.
 *
 * `kind` n'est lu que s'il vaut `"path"` : Herdr modélise aussi un slot par
 * identifiant, dont la résolution n'est pas vérifiée (D008, `[INCONNU]`). Une
 * capacité non vérifiée n'est pas exposée.
 */
export const sessionSourceOf = (agent: unknown): SourceSession | undefined => {
  const decoded = Option.getOrUndefined(decodeSessionSlot(agent));
  if (decoded === undefined) return undefined;
  const info = decoded.agent_session;
  if (info === undefined || info === null) return undefined;
  // ⚠️ `agent` porte aussi le nom du type : c'est lui qui dit si un `id` est
  // résoluble. La décision est prise dans `sourceSession`, et nulle part ici.
  const kind = Option.getOrUndefined(decodeAgentKind(agent))?.agent ?? null;
  return sourceSession(kind, info);
};

/** Le chemin, quand la session vit dans un **fichier**. `undefined` sinon. */
export const sessionPathOf = (agent: unknown): string | undefined => {
  const source = sessionSourceOf(agent);
  return source?.kind === "fichier" ? source.base : undefined;
};

/** Fabrique les deux routes. `config` n'est lu que pour son `logPath`. */
/** `true` quand le fichier de session n'existe pas encore sur le disque. */
const isMissingFileEmpty = (path: string): boolean => {
  try {
    return !existsSync(path);
  } catch {
    return false;
  }
};

/**
 * Fenetre d'une session opencode, en **lignes**.
 *
 * ⚠️ Le contrat exprime la fenetre d'un fichier en octets (`tail`). Pour une
 * base, un nombre de lignes ; un « 512 Kio de lignes » ne veut rien dire.
 * 400 messages couvrent largement un ecran de telephone, et la pagination
 * anterieure est la pour le reste.
 */
const OPENCODE_TAIL_ROWS = 400;

/**
 * Curseur d'une session opencode : le numero de sequence, porte par `offset`.
 *
 * ⚠️ `dev` et `ino` a zero, volontairement : une base ne se remplace pas en
 * cours de route comme un fichier tourne. La detection de rotation ne se
 * declenche donc jamais, et rien n'est simule pour l'eviter.
 */
const curseurSqlite = (offset: number): string => encodeCursor({ dev: 0, ino: 0, offset });

export const makeSessionRoutes = (config: ServerConfig, herdr: HerdrApi) => {
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
    const beforeParam = url.searchParams.get("before");
    // B01 : le curseur est **opaque** et remplace `?since=`. Un offset nu ne
    // dit pas quel fichier il désigne : après rotation, il pointerait ailleurs,
    // sans erreur visible. Un curseur malformé est un 400, jamais un 0 deviné.
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam === null ? undefined : decodeCursor(cursorParam);
    if (cursorParam !== null && cursor === undefined) {
      return respond(config.logPath, decoderOf(ApiErrorResponse), { error: "invalid cursor" }, 400);
    }
    const before = beforeParam === null ? undefined : decodeCursor(beforeParam);
    if (
      (beforeParam !== null && before === undefined) ||
      (before !== undefined && cursor !== undefined)
    ) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "invalid previous-page cursor" },
        400,
      );
    }
    // 512 Kio, pas 256 : la fenêtre du contrat partagé (D013.3).
    const tailBytes = tailParam === null ? SESSION_TAIL_BYTES : Number.parseInt(tailParam, 10);

    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const paneId = request.params["paneId"] ?? "";
          const payload = yield* herdr.getAgent(paneId);
          const source = sessionSourceOf(payload["agent"]);
          if (source === undefined) {
            return { kind: "no-session" as const };
          }
          /*
            ⚠️ **opencode sort ici**, avant tout ce qui suppose un fichier :
            fenêtre d'octets, identité `dev`/`ino`, détection de rotation. Sa
            session vit dans une base SQLite, et son curseur avance par numéro
            de séquence. Traiter les deux par le même chemin aurait demandé de
            simuler un fichier ; on ne simule pas.
          */
          if (source.kind === "sqlite") {
            return { kind: "sqlite" as const, source };
          }
          const path = source.base;
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

          if (before !== undefined) {
            const taille = yield* Effect.result(fileSize(path, config.sessionRoots));
            if (Result.isFailure(taille)) {
              const failure = Result.getFailure(taille);
              if (isMissingFile(failure)) return { kind: "cursor-stale" as const };
              return yield* Effect.fail(failure);
            }
            const current = taille.success;
            if (
              before.dev !== current.identity.dev ||
              before.ino !== current.identity.ino ||
              before.offset > current.size
            ) {
              return { kind: "cursor-stale" as const };
            }
            const page = yield* Effect.result(
              readBefore(path, before.offset, SESSION_TAIL_BYTES, config.sessionRoots),
            );
            if (Result.isFailure(page)) return yield* Effect.fail(Result.getFailure(page));
            const older = Option.getOrUndefined(Result.getSuccess(page));
            if (older === undefined) return { kind: "cursor-stale" as const };
            return {
              kind: "ok" as const,
              path,
              reset: false,
              tailed: {
                entries: older.entries,
                hasMore: older.hasMore,
                identity: older.identity,
                offset: before.offset,
                pending: "",
              },
              truncated: older.hasMore,
              previousCursor: older.hasMore
                ? encodeCursor({
                    dev: older.identity.dev,
                    ino: older.identity.ino,
                    offset: older.offset,
                  })
                : undefined,
            };
          }

          if (cursor !== undefined) {
            // Rotation ou troncature : le curseur ne décrit plus ce fichier.
            // Le client doit **remplacer** sa vue, pas y ajouter — sinon il
            // afficherait des entrées qui ne sont plus dans le fichier.
            const taille = yield* Effect.result(fileSize(path, config.sessionRoots));
            if (Result.isFailure(taille)) {
              const failure = Result.getFailure(taille);
              if (isMissingFile(failure)) {
                // Absente : le JSONL naît au premier message. Ce n'est pas une
                // panne, et l'annoncer comme telle fit crier tout nouvel agent.
                return {
                  kind: "ok" as const,
                  path,
                  reset: true,
                  tailed: empty,
                  truncated: false,
                };
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
                readTail(path, SESSION_TAIL_BYTES, config.sessionRoots),
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
              tailFrom(path, cursor.offset, "", config.sessionRoots),
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
            Number.isInteger(tailBytes) && tailBytes > 0
              ? Math.min(tailBytes, SESSION_TAIL_HARD_CAP)
              : SESSION_TAIL_BYTES;
          const tailed = yield* Effect.result(readTail(path, finite, config.sessionRoots));
          if (Result.isFailure(tailed)) {
            const failure = failureOf(tailed);
            // Absence de fichier → session vide. Autre erreur → vraie panne.
            if (isMissingFile(failure)) {
              return {
                kind: "ok" as const,
                path,
                reset: false,
                tailed: empty,
                truncated: false,
              };
            }
            return yield* Effect.fail(failure);
          }
          const value = Option.getOrUndefined(Result.getSuccess(tailed));
          if (value === undefined) {
            return {
              kind: "ok" as const,
              path,
              reset: false,
              tailed: empty,
              truncated: false,
            };
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
              startOffset: value.startOffset,
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
        // B03 : la cause est nommée. Un 502 indifférencié ferait croire à une
        // panne réseau là où c'est une permission refusée, et l'utilisateur
        // relancerait pour rien.
        const classified = classifyReadFailure(failure);
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          {
            cause: classified.cause,
            error: classified.cause === "io" ? describe(failure) : classified.message,
          },
          statusFor(classified.cause),
        );
      }
      const value = Option.getOrUndefined(Result.getSuccess(result));
      if (value === undefined) {
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          {
            cause: "invalide",
            error: invalidSession("unreadable result").message,
          },
          422,
        );
      }
      if (value.kind === "sqlite") {
        const { base, sessionId } = value.source;
        if (!existsSync(base)) {
          // Une base absente est une panne de configuration, pas une session
          // vide. La confondre ferait passer une installation cassée pour un
          // agent muet.
          return respond(
            config.logPath,
            decoderOf(ApiErrorResponse),
            { error: `${value.source.magasin} database not found: ${base}` },
            503,
          );
        }
        /*
          ⚠️ **Deux magasins, un seul chemin.** opencode et devin ont chacun
          leur table et leur decodeur ; le choix se fait ici, une fois, et tout
          ce qui suit est identique.
        */
        const moteur = value.source.magasin === "devin" ? moteurDevin : moteurOpencode;
        /*
          ⚠️ **Une session sans ligne n'est pas une panne : c'est une session qui
          n'a pas commencé.**

          Mesure du 2026-10-16, sur un agent devin réellement lancé : Herdr
          expose `stellar-tortoise`, et cette cle n'existe PAS encore dans
          `sessions`. Le verrou `stellar-tortoise.lock` porte le pid du processus
          `devin acp` vivant — l'identifiant est donc juste, mais la ligne n'est
          ecrite qu'**au premier message**. C'est exactement le JSONL de Pi, qui
          nait au premier message.

          Un `404` ici traitait un agent qui demarre comme une panne : c'etait un
          seuil de panique trop zele. On rend donc une session **vide**, comme le
          fait deja le chemin fichier pour un JSONL absent — meme cause, meme
          silence, et la conversation s'emplit a la premiere demande.
        */
        if (!moteur.sessionExiste(base, sessionId)) {
          return respond(config.logPath, decoderOf(SessionResponse), {
            cause: "absente",
            cursor: curseurSqlite(0),
            entries: [],
            hasMore: false,
            incremental: cursor !== undefined,
            previousCursor: undefined,
            reset: false,
            sessionPath: base,
          });
        }
        /*
          ⚠️ Le budget de la fenêtre est en **lignes**, pas en octets. Le
          contrat exprime la fenêtre d'un fichier en kilo-octets ; pour une base,
          « 512 Kio de lignes » ne veut rien dire. On garde donc un nombre de
          messages, et le champ `tail` de la requête est ignoré ici — ce qui est
          documenté plutôt que silencieux.
        */
        const page = moteur.pageSession(value.source, {
          avant: before?.offset,
          depuis: cursor?.offset,
          lignes: OPENCODE_TAIL_ROWS,
        });
        return respond(config.logPath, decoderOf(SessionResponse), {
          cause: "vide",
          cursor: curseurSqlite(page.curseur),
          entries: page.entries,
          hasMore: page.hasMore,
          incremental: cursor !== undefined,
          previousCursor:
            page.previousSeq === undefined ? undefined : curseurSqlite(page.previousSeq),
          reset: false,
          sessionPath: base,
        });
      }
      if (value.kind === "no-session") {
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          { error: "no usable session path for this agent" },
          404,
        );
      }
      if (value.kind === "cursor-stale") {
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          {
            error: "the session changed; reload the conversation to continue",
          },
          409,
        );
      }
      // Le curseur repart toujours de l'identité **lue**, pas de celle
      // demandée : c'est la seule qui décrit le fichier réellement ouvert.
      const cursorOut = encodeCursor({
        dev: value.tailed.identity.dev,
        ino: value.tailed.identity.ino,
        offset: value.tailed.offset,
      });
      const previousCursor =
        value.previousCursor ??
        (value.tailed.hasMore
          ? encodeCursor({
              dev: value.tailed.identity.dev,
              ino: value.tailed.identity.ino,
              offset:
                ("startOffset" in value.tailed ? value.tailed.startOffset : undefined) ??
                value.tailed.offset,
            })
          : undefined);
      // Une session sans aucune entrée se distingue d'une session absente :
      // les deux sont benignes, mais seule la seconde mérite d'être rejouée
      // sans alarme et sans bannière d'erreur.
      if (value.tailed.entries.length === 0 && !value.truncated) {
        const cause = isMissingFileEmpty(value.path) ? "absente" : "vide";
        return respond(config.logPath, decoderOf(SessionResponse), {
          cause,
          cursor: cursorOut,
          entries: [],
          hasMore: false,
          incremental: cursor !== undefined,
          previousCursor,
          reset: value.reset,
          sessionPath: value.path,
        });
      }
      return respond(config.logPath, decoderOf(SessionResponse), {
        cause: "vide",
        cursor: cursorOut,
        entries: value.tailed.entries,
        hasMore: value.tailed.hasMore || value.truncated,
        incremental: cursor !== undefined,
        previousCursor,
        reset: value.reset,
        sessionPath: value.path,
      });
    }
  };

  return { session };
};
