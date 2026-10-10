/**
 * API HTTP locale.
 *
 * **Décision D009** : le routage utilise les routes natives de Bun
 * (`Bun.serve({ routes })`) et non `HttpRouter` d'Effect 4. Motif : l'API
 * `HttpRouter` (params ambiants, `make`/`add`) est instable en 4.0.2 et coûte
 * plus qu'elle ne rapporte pour 7 routes. **Effect structure tout le cœur**
 * (services, `Layer`, erreurs typées, concurrence, `Ref`) ; Bun ne fait que le
 * transport. Le spec demande qu'Effect structure le backend, ce qui est le cas.
 *
 * Le flux temps réel est en **SSE**, pas en WebSocket (voir D009) : c'est ce
 * qui donne le rattrapage après coupure, qu'Herdr ne peut pas fournir.
 */
import { Effect, Option, Result, Schema } from "effect";
import type { Cause } from "effect";
import {
  AGENT_KINDS,
  ApiErrorResponse,
  HealthResponse,
  RecentImagesResponse,
  LaunchAgentRequest,
  LaunchAgentResponse,
  OverviewResponse,
  PromptSentResponse,
  PromptSuppressedResponse,
  SessionResponse,
  SnapshotPayload,
  TerminalResponse,
} from "@herdr-remote/shared";
import { buildOverview, checkoutPathOf, toWorkspaceViews } from "../agents/AgentRegistry.ts";
import { FileDenied, FileUnavailable } from "../files/FileService.ts";
import type { ServerConfig } from "../config.ts";
import type { WatchLoop } from "../events/AgentWatcher.ts";
import type { EventHubApi } from "../events/EventHub.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import type { PromptSenderApi } from "../send/PromptSender.ts";
import { readTail, tailFrom } from "../sessions/SessionReader.ts";
import { isInline, readAllowedFile } from "../files/FileService.ts";
import { listRecentImages } from "../files/RecentImages.ts";

export interface ApiDeps {
  readonly config: ServerConfig;
  readonly herdr: HerdrApi;
  readonly hub: EventHubApi;
  readonly sender: PromptSenderApi;
  readonly watch: WatchLoop;
  readonly startedAt: number;
}

/** Corps de requête attendu pour l'envoi d'un prompt. */
const PromptBody = Schema.Struct({ text: Schema.String });

/** Emplacement `agent_session` d'un agent, tel que le renvoie Herdr. */
const AgentSessionSlot = Schema.Struct({
  agent_session: Schema.optional(
    Schema.NullOr(Schema.Struct({ kind: Schema.String, value: Schema.String })),
  ),
});

const decodeSnapshot = Schema.decodeUnknownOption(SnapshotPayload);
const decodePromptBody = Schema.decodeUnknownOption(PromptBody);
const decodeSessionSlot = Schema.decodeUnknownOption(AgentSessionSlot);

export const sessionPathOf = (agent: unknown): string | undefined => {
  const decoded = Option.getOrUndefined(decodeSessionSlot(agent));
  if (decoded === undefined) return undefined;
  const info = decoded.agent_session;
  if (info === undefined || info === null || info.kind !== "path") return undefined;
  return info.value;
};

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Sérialise une réponse **en la validant contre le contrat partagé**.
 *
 * C'est la garantie structurelle : le serveur ne peut plus émettre une réponse
 * que le client refusera de décoder. Le bug initial — `reachable` absent de la
 * branche succès de `/api/health` — aurait été attrapé ici, immédiatement, au
 * lieu de se manifester sur l'iPhone comme « Herdr injoignable ».
 */
/**
 * Construit un décodeur pour un schéma concret.
 *
 * On ne peut pas écrire `respond<A>(schema: Schema.Schema<A>)` : la signature
 * réelle de `decodeUnknownOption` exige un `ConstraintDecoder`, et un
 * `Schema<A>` générique ne s'y conforme pas.
 */
const decoderOf =
  <S extends Parameters<typeof Schema.decodeUnknownOption>[0]>(schema: S) =>
  (payload: unknown): S["Type"] | undefined =>
    Option.getOrUndefined(Schema.decodeUnknownOption(schema)(payload));

const respond = (
  decodeBody: (payload: unknown) => unknown,
  body: unknown,
  status = 200,
): Response => {
  const value = decodeBody(body);
  if (value === undefined) {
    return json(
      {
        error: "le serveur a produit une réponse hors contrat",
        hint: "voir packages/shared/src/api.ts — le contrat fait foi",
      },
      500,
    );
  }
  return json(value, status);
};

/** Rend lisible n'importe quelle erreur typée d'Effect. */
const describe = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
    return JSON.stringify(error);
  }
  return String(error);
};

const describeCause = (cause: Cause.Cause<unknown>): string =>
  cause.reasons.map((reason) => describe(reason)).join(" ; ");

/**
 * Extrait l'**échec** typé d'un `Result`.
 *
 * ⚠️ Piège Effect 4 : `Result.getOrUndefined` renvoie la valeur de **succès**
 * (ou `undefined` sur un échec). Pour lire l'erreur il faut `Result.getFailure`,
 * qui renvoie un `Option<E>`. Utiliser `getOrUndefined` pour lire une erreur
 * produit silencieusement `undefined` et masque la cause réelle.
 */
const failureOf = (result: Result.Result<unknown, unknown>): unknown =>
  Option.getOrUndefined(Result.getFailure(result));

/**
 * Exécute un effet et le convertit en `Response`.
 *
 * Un échec **non typé** (défaut) devient un 500 explicite : on ne renvoie
 * jamais un 200 sur une erreur.
 */
const run = async <A, E>(
  effect: Effect.Effect<A, E>,
  onSuccess: (value: A) => Response,
): Promise<Response> => {
  const result = await Effect.runPromise(Effect.result(effect));
  if (Result.isSuccess(result)) {
    const value = Option.getOrUndefined(Result.getSuccess(result));
    return value === undefined ? json({ error: "résultat illisible" }, 500) : onSuccess(value);
  }
  const failure = failureOf(result);
  return json({ error: failure === undefined ? "échec inconnu" : describe(failure) }, 500);
};

/**
 * Requête minimale dont un handler a besoin.
 *
 * Volontairement plus étroite que `Bun.BunRequest` : cela évite toute assertion
 * de type dans les tests, qui peuvent construire un objet littéral conforme.
 */
export interface RouteRequest {
  readonly params: Record<string, string | undefined>;
  readonly headers: { get(name: string): string | null };
  readonly url: string;
  json(): Promise<unknown>;
}

export interface Routes {
  readonly [path: string]: (request: RouteRequest) => Response | Promise<Response>;
}

export const makeRoutes = (deps: ApiDeps): Routes => {
  const { config, herdr, hub, sender, watch, startedAt } = deps;

  const health = (): Promise<Response> =>
    Effect.gen(function* () {
      const ping = yield* Effect.result(herdr.ping());
      // Herdr injoignable n'est pas une erreur du backend : on répond 503 avec
      // `reachable: false`, jamais une 200 qui laisserait croire que tout va bien.
      if (Result.isFailure(ping)) {
        return respond(
          decoderOf(HealthResponse),
          {
            herdr: { reachable: false, socket: config.herdrSocketPath },
            ok: false,
            uptimeMs: Date.now() - startedAt,
          },
          503,
        );
      }
      const value = Option.getOrUndefined(Result.getSuccess(ping));
      if (value === undefined) {
        return respond(decoderOf(ApiErrorResponse), { error: "réponse `ping` illisible" }, 500);
      }
      return respond(decoderOf(HealthResponse), {
        herdr: {
          protocol: value.protocol,
          reachable: true,
          socket: config.herdrSocketPath,
          version: value.version,
        },
        ok: true,
        uptimeMs: Date.now() - startedAt,
      });
    }).pipe(Effect.runPromise);

  /**
   * Vue d'accueil.
   *
   * Servie depuis le **cache du veilleur** quand il est chaud : l'iPhone
   * rafraîchit souvent, et Herdr n'a pas à payer un snapshot complet pour
   * chaque client. Le cache est alimenté toutes les 2 s par la boucle de veille.
   */
  const overview = (): Promise<Response> =>
    run(
      Effect.gen(function* () {
        const [cached, lastAt] = yield* Effect.all([watch.lastAgents(), watch.lastAt()]);
        // Le cache n'est utilisé que s'il est **frais ET non vide**. La condition
        // précédente (`cached.length >= 0`) était toujours vraie : un cache vide
        // aurait été servi comme une vue valide à zéro agent.
        const fresh = lastAt > 0 && Date.now() - lastAt < 15_000 && cached.length > 0;

        if (fresh) {
          const payload = yield* herdr.snapshot();
          const snapshot = Option.getOrUndefined(decodeSnapshot(payload["snapshot"]));
          if (snapshot !== undefined) {
            return {
              agents: cached,
              herdrProtocol: snapshot.protocol,
              herdrVersion: snapshot.version,
              withoutSession: cached.filter((agent) => agent.sessionPath === null).length,
              // ⚠️ Le cache servait des vues de projet SANS agents ni panes :
              // `agentPanes` était donc toujours vide, et l'interface croyait
              // que chaque projet était vide.
              workspaces: toWorkspaceViews(snapshot.workspaces, cached, snapshot.panes ?? []),
            };
          }
        }

        const payload = yield* herdr.snapshot();
        const snapshot = Option.getOrUndefined(decodeSnapshot(payload["snapshot"]));
        if (snapshot === undefined) {
          return yield* Effect.fail({ message: "snapshot Herdr illisible (forme inattendue)" });
        }
        return yield* buildOverview({
          agents: snapshot.agents,
          panes: snapshot.panes,
          protocol: snapshot.protocol,
          // Explicite : avec `exactOptionalPropertyTypes`, une propriété absente
          // n'est pas la même chose qu'une propriété valant `undefined`.
          tabs: snapshot.tabs,
          version: snapshot.version,
          workspaces: snapshot.workspaces,
        });
      }),
      (body) => respond(decoderOf(OverviewResponse), body),
    );

  const terminal = (request: RouteRequest): Promise<Response> =>
    run(
      Effect.gen(function* () {
        const paneId = request.params["paneId"] ?? "";
        return yield* herdr.readAgent(paneId);
      }),
      (body) => respond(decoderOf(TerminalResponse), body),
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
          if (since !== undefined && Number.isInteger(since) && since >= 0) {
            const tailed = yield* tailFrom(path, since, "");
            return { kind: "ok" as const, path, tailed, truncated: false };
          }
          const finite =
            Number.isInteger(tailBytes) && tailBytes > 0 ? Math.min(tailBytes, 4_194_304) : 262_144;
          const tailed = yield* readTail(path, finite);
          return { kind: "ok" as const, path, tailed, truncated: tailed.truncated };
        }),
      ),
    );
    {
      if (Result.isFailure(result)) {
        const failure = failureOf(result);
        return respond(
          decoderOf(ApiErrorResponse),
          { error: failure === undefined ? "échec inconnu" : describe(failure) },
          502,
        );
      }
      const value = Option.getOrUndefined(Result.getSuccess(result));
      if (value === undefined) {
        return respond(
          decoderOf(ApiErrorResponse),
          { error: "résultat de session illisible" },
          500,
        );
      }
      if (value.kind === "no-session") {
        return respond(
          decoderOf(ApiErrorResponse),
          { error: "aucun chemin de session exploitable pour cet agent" },
          404,
        );
      }
      return respond(decoderOf(SessionResponse), {
        entries: value.tailed.entries,
        incremental: since !== undefined,
        offset: value.tailed.offset,
        sessionPath: value.path,
        truncated: value.truncated,
      });
    }
  };

  const prompt = async (request: RouteRequest): Promise<Response> => {
    const raw: unknown = await request.json().catch(() => undefined);
    const body = Option.getOrUndefined(decodePromptBody(raw));
    if (body === undefined) {
      return respond(
        decoderOf(ApiErrorResponse),
        { error: "corps invalide : `text` (chaîne) requis" },
        400,
      );
    }
    const paneId = request.params["paneId"] ?? "";

    const result = await Effect.runPromise(Effect.result(sender.send(paneId, body.text)));

    if (Result.isSuccess(result)) {
      const outcome = Option.getOrUndefined(Result.getSuccess(result));
      if (outcome === undefined) {
        return respond(decoderOf(ApiErrorResponse), { error: "résultat d'envoi illisible" }, 500);
      }
      await Effect.runPromise(hub.publish("prompt", { paneId, ...outcome }));
      return respond(decoderOf(PromptSentResponse), outcome);
    }

    const failure = failureOf(result);
    // Un double envoi n'est pas une erreur serveur : c'est un no-op assumé (D007.2).
    if (failure !== undefined && isDuplicate(failure)) {
      await Effect.runPromise(
        hub.publish("prompt-suppressed", { paneId, reason: "envoi identique consécutif" }),
      );
      return respond(decoderOf(PromptSuppressedResponse), {
        reason: "envoi identique déjà confirmé dans la fenêtre",
        status: "suppressed",
      });
    }
    return respond(
      decoderOf(ApiErrorResponse),
      { error: `envoi non confirmé : ${failure === undefined ? "inconnu" : describe(failure)}` },
      502,
    );
  };

  /**
   * Flux SSE avec rattrapage.
   *
   * `EventSource` rejoue `Last-Event-ID` à la reconnexion : le client reçoit
   * exactement les événements manqués. Si le journal a été tronqué, un
   * événement `resync` est émis plutôt que de laisser un trou silencieux.
   */
  /**
   * Lance un agent dans un projet.
   *
   * **C'est la seule opération qui crée quelque chose chez Herdr.** Deux étapes,
   * imposées par Herdr : d'abord un onglet (le pane doit être à son invite
   * shell), puis l'agent dedans.
   *
   * Le projet n'est jamais touché s'il a déjà un agent : lancer un second agent
   * dans le même dossier est une décision de l'utilisateur, pas un effet de bord
   * d'un clic.
   */
  const launchAgent = async (request: RouteRequest): Promise<Response> => {
    const workspaceId = request.params["workspaceId"] ?? "";
    const raw: unknown = await request.json().catch(() => undefined);
    const body = decoderOf(LaunchAgentRequest)(raw);
    if (body === undefined) {
      return respond(decoderOf(ApiErrorResponse), { error: "corps invalide : `kind` requis" }, 400);
    }
    if (!(AGENT_KINDS as ReadonlyArray<string>).includes(body.kind)) {
      // Liste blanche : on n'accepte que les types que Herdr sait démarrer.
      return respond(
        decoderOf(ApiErrorResponse),
        { error: `type d'agent inconnu : « ${body.kind} »`, hint: AGENT_KINDS.join(", ") },
        400,
      );
    }

    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const payload = yield* herdr.snapshot();
          const snapshot = Option.getOrUndefined(decodeSnapshot(payload["snapshot"]));
          if (snapshot === undefined) {
            return yield* Effect.fail({ message: "snapshot Herdr illisible" });
          }
          const workspace = snapshot.workspaces.find((w) => w.workspace_id === workspaceId);
          if (workspace === undefined) {
            // Aucun identifiant brut dans un message destiné à l'écran.
            return yield* Effect.fail({ message: "ce projet n'existe plus" });
          }

          // Les noms affichés sont ceux que l'utilisateur reconnaît, jamais des
          // identifiants internes.
          const label = workspace.label ?? "ce projet";

          if (snapshot.agents.some((agent) => agent.workspace_id === workspaceId)) {
            return yield* Effect.fail({
              message: `${label} a déjà un agent — en lancer un second est un choix explicite`,
            });
          }

          const name = body.name ?? workspace.label ?? "agent";
          // **Même** fonction que l'aperçu : une seule source pour le dossier.
          const checkout = checkoutPathOf(workspace, snapshot.panes ?? []);
          if (checkout === null) {
            return yield* Effect.fail({
              message: `aucun dossier de travail connu pour ${label}`,
            });
          }

          // Étape 1 : un onglet dans le projet, ouvert dans son dossier.
          const tab = yield* herdr.createTab({
            cwd: checkout,
            focus: false,
            label: name,
            workspace_id: workspaceId,
          });

          // Étape 2 : l'agent, dans le pane à l'invite shell.
          yield* herdr.startAgent({
            kind: body.kind,
            name,
            pane_id: tab.paneId,
            timeout_ms: 120_000,
          });

          return { kind: body.kind, name, paneId: tab.paneId, tabId: tab.tabId };
        }),
      ),
    );

    if (Result.isFailure(result)) {
      const failure = failureOf(result);
      return respond(
        decoderOf(ApiErrorResponse),
        { error: failure === undefined ? "échec inconnu" : describe(failure) },
        502,
      );
    }
    const started = Option.getOrUndefined(Result.getSuccess(result));
    if (started === undefined) {
      return respond(
        decoderOf(ApiErrorResponse),
        { error: "résultat de lancement illisible" },
        500,
      );
    }

    await Effect.runPromise(
      hub.publish("agent-launched", { kind: started.kind, paneId: started.paneId, workspaceId }),
    );

    return respond(decoderOf(LaunchAgentResponse), { ...started, status: "started" }, 201);
  };

  /**
   * Sert un fichier produit par un agent.
   *
   * **Racines autorisées** : les dossiers de travail des projets, résolus à
   * chaud depuis le snapshot Herdr. Aucune racine globale, aucune variable
   * d'environnement — un projet qui disparaît cesse immédiatement d'être
   * lisible.
   */
  const file = async (request: RouteRequest): Promise<Response> => {
    const result = await Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const url = new URL(request.url);
          const requested = url.searchParams.get("path");
          if (requested === null || requested.length === 0) {
            return yield* Effect.fail(new FileDenied({ reason: "paramètre `path` manquant" }));
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
        decoderOf(ApiErrorResponse),
        { error: known?.reason ?? "fichier indisponible" },
        403,
      );
    }

    const value = Option.getOrUndefined(Result.getSuccess(result));
    if (value === undefined) {
      return respond(decoderOf(ApiErrorResponse), { error: "fichier illisible" }, 500);
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
      return respond(decoderOf(ApiErrorResponse), { error: "balayage impossible" }, 502);
    }
    const found = Option.getOrUndefined(Result.getSuccess(result)) ?? [];
    return respond(decoderOf(RecentImagesResponse), { images: found });
  };

  const events = (request: RouteRequest): Response => {
    const header = request.headers.get("last-event-id");
    const parsed = header === null ? 0 : Number.parseInt(header, 10);
    let cursor = Number.isInteger(parsed) ? parsed : 0;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Signal de vie immédiat : le client sait que le flux est établi.
        controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`));
        let closed = false;
        // Séquence volontaire : on interroge le journal, on émet, PUIS on
        // attend. Paralléliser n'aurait pas de sens ici — c'est une boucle de
        // scrutation, pas une collecte de promesses indépendantes.
        /* oxlint-disable no-await-in-loop */
        while (!closed) {
          try {
            const catchUp = await Effect.runPromise(hub.since(cursor));
            let buffer = "";
            if (catchUp.resyncRequired) {
              buffer += `event: resync\ndata: {"reason":"journal tronqué"}\n\n`;
            }
            for (const event of catchUp.events) {
              buffer += `id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;
            }
            if (catchUp.events.length > 0) {
              cursor = catchUp.events[catchUp.events.length - 1]?.id ?? cursor;
            }
            if (buffer.length > 0) controller.enqueue(encoder.encode(buffer));
            await Bun.sleep(300);
          } catch (cause) {
            closed = true;
            controller.error(cause);
          }
        }
        /* oxlint-enable no-await-in-loop */
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      },
    });
  };

  return {
    "/api/agents/:paneId/prompt": prompt,
    "/api/workspaces/:workspaceId/agents": launchAgent,
    "/api/agents/:paneId/session": session,
    "/api/agents/:paneId/terminal": terminal,
    "/api/events": events,
    "/api/file": file,
    "/api/images": images,
    "/api/health": health,
    "/api/overview": overview,
  };
};

/** Reconnaît le refus de double envoi sans dépendre du typage de l'union. */
const isDuplicate = (failure: unknown): boolean =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "DuplicatePrompt";

export { describeCause };
