/**
 * Routes fichiers : lecture d'un fichier de projet, et images récentes.
 *
 * **Déplacement seul (A01)** — aucun changement de comportement, vérifié par
 * les 137 tests et par le test d'identité des routes.
 *
 * ⚠️ Les racines autorisées sont résolues **à chaque requête** depuis le
 * snapshot Herdr : aucune racine globale, aucune variable d'environnement. Un
 * projet qui disparaît cesse immédiatement d'être lisible.
 *
 * S04 renforcera ce module : il faut aujourd'hui ouvrir, `stat`er et lire **le
 * même descripteur**, pour qu'un fichier remplacé entre l'ouverture et la
 * lecture ne change pas de contenu sous les pieds du serveur.
 */
import { Effect, Option, Result, Schema } from "effect";
import { ApiErrorResponse, RecentImagesResponse } from "@herdr-remote/shared";
import { checkoutPathOf } from "../agents/AgentRegistry.ts";
import type { ServerConfig } from "../config.ts";
import { FileDenied, FileUnavailable, isInline, readAllowedFile } from "../files/FileService.ts";
import { listRecentImages } from "../files/RecentImages.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import { decodeSnapshot, decoderOf, failureOf, respond } from "./Reply.ts";
import type { RouteRequest } from "./Reply.ts";

export const makeFileRoutes = (config: ServerConfig, herdr: HerdrApi) => {
  const file = async (request: RouteRequest): Promise<Response> => {
    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const url = new URL(request.url);
          const requested = url.searchParams.get("path");
          if (requested === null || requested.length === 0) {
            return yield* Effect.fail(new FileDenied({ reason: "missing `path` parameter" }));
          }

          const payload = yield* herdr.snapshot();
          const snapshot = Option.getOrUndefined(decodeSnapshot(payload["snapshot"]));
          if (snapshot === undefined) {
            return yield* Effect.fail(new FileUnavailable({ reason: "Herdr illisible" }));
          }

          // Dossiers de projet + médias configurés. Les seconds sont bornés et
          // explicites : captures d'écran, téléchargements, images.
          const roots = [
            ...snapshot.workspaces
              .map((workspace) => checkoutPathOf(workspace, snapshot.panes ?? []))
              .filter((root): root is string => root !== null),
            ...config.extraFileRoots,
          ];

          return yield* readAllowedFile(requested, roots);
        }),
      ),
    );

    if (Result.isFailure(result)) {
      const failure = failureOf(result);
      // Le typage ne garantit pas la forme : on vérifie avant de lire `reason`.
      const known = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Struct({ reason: Schema.String }))(failure),
      );
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: known?.reason ?? "fichier indisponible" },
        403,
      );
    }

    const value = Option.getOrUndefined(Result.getSuccess(result));
    if (value === undefined) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "fichier illisible" },
        500,
      );
    }

    // Ce qui n'est pas dans la liste blanche est **téléchargé**, jamais rendu.
    return new Response(new Uint8Array(value.bytes), {
      headers: {
        "cache-control": "no-store",
        "content-disposition": isInline(value.name)
          ? `inline; filename="${value.name}"`
          : `attachment; filename="${value.name}"`,
        "content-length": String(value.size),
        "content-type": value.contentType,
      },
    });
  };

  /**
   * Images récentes des dossiers autorisés.
   *
   * C'est ce qui remplace « connaître le chemin par cœur » : on ouvre l'app, on
   * voit ses dernières captures.
   */
  const images = async (): Promise<Response> => {
    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const payload = yield* herdr.snapshot();
          const snapshot = Option.getOrUndefined(decodeSnapshot(payload["snapshot"]));
          if (snapshot === undefined) {
            return yield* Effect.fail({ message: "Herdr illisible" });
          }
          const roots = [
            ...snapshot.workspaces
              .map((workspace) => checkoutPathOf(workspace, snapshot.panes ?? []))
              .filter((root): root is string => root !== null),
            ...config.extraFileRoots,
          ];
          return yield* listRecentImages(roots);
        }),
      ),
    );

    if (Result.isFailure(result)) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "balayage impossible" },
        502,
      );
    }
    const found = Option.getOrUndefined(Result.getSuccess(result)) ?? [];
    return respond(config.logPath, decoderOf(RecentImagesResponse), { images: found });
  };

  return { file, images };
};
