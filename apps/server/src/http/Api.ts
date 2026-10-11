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
import { Effect, Option, Result, Schedule, Schema } from "effect";
import {
  AGENT_KINDS,
  InstalledKindsResponse,
  ApiErrorResponse,
  HealthResponse,
  RecentImagesResponse,
  LaunchAgentRequest,
  LaunchAgentResponse,
  ModelCatalogResponse,
  OverviewResponse,
  TrustRequiredResponse,
  TrustResolvedResponse,
  PromptSentResponse,
  PromptSuppressedResponse,
  SessionResponse,
  SnapshotPayload,
  TerminalResponse,
} from "@herdr-remote/shared";
import { buildOverview, checkoutPathOf, toWorkspaceViews } from "../agents/AgentRegistry.ts";
import { buildModelArgs, checkThinkingSupported } from "../agents/ModelArgs.ts";
import { catalogOf } from "../agents/ModelCatalog.ts";
import { isTrustPrompt, respondToTrust } from "../agents/TrustPrompt.ts";
import { FileDenied, FileUnavailable } from "../files/FileService.ts";
import type { ServerConfig } from "../config.ts";
import type { WatchLoop } from "../events/AgentWatcher.ts";
import type { EventHubApi } from "../events/EventHub.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import type { PromptSenderApi } from "../send/PromptSender.ts";
import { isMissingFile, readTail, tailFrom } from "../sessions/SessionReader.ts";
import { isInline, readAllowedFile } from "../files/FileService.ts";
import { LOG_PATH, writeLog } from "../logging/LogFile.ts";
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

/**
 * Types acceptés par `agent.start`, relevés dans `herdr agent start --help`.
 * Sert à décider si l'on passe la commande ou la cible comme `kind`.
 */
const ACCEPTED_KINDS = new Set([
  "pi",
  "claude",
  "codex",
  "gemini",
  "cursor",
  "devin",
  "agy",
  "cline",
  "omp",
  "mastracode",
  "opencode",
  "copilot",
  "kimi",
  "kiro",
  "droid",
  "amp",
  "grok",
  "hermes",
  "kilo",
  "qodercli",
  "qwen",
  "letta",
  "maki",
  "muse",
]);

/** Échec de lancement, qualifié par l'étape qui a échoué. */
class LaunchFailed extends Schema.TaggedError<LaunchFailed>()("LaunchFailed", {
  detail: Schema.String,
  paneId: Schema.NullOr(Schema.String),
  phase: Schema.String,
}) {}

/**
 * Réponse JSON, **et journalisation automatique des erreurs**.
 *
 * ⚠️ Un avertissement affiché dans l'application sans trace laissée nulle part
 * est indiagnosticable après coup. Toute réponse >= 400 part au journal.
 */
const json = (body: unknown, status = 200): Response => {
  if (status >= 400) {
    const described = describeCause(body);
    // eslint-disable-next-line no-console -- trace console en plus du fichier
    console.error(`[http ${String(status)}] ${described}`);
    void Effect.runPromise(
      writeLog({
        level: status >= 500 ? "error" : "warn",
        message: `HTTP ${String(status)}`,
        source: "server",
        detail: body,
      }),
    );
  }
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
};

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
  const value = describeCause(error);
  return value.trim().length > 0 ? value : "erreur sans message";
};

const describeCause = (cause: unknown): string => {
  const decoded = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      Schema.Struct({
        detail: Schema.optional(Schema.String),
        message: Schema.optional(Schema.String),
      }),
    )(cause),
  );
  const readable = decoded?.detail ?? decoded?.message;
  if (readable !== undefined && readable.trim().length > 0) return stripIdentifiers(readable);

  // Dernier recours : une sérialisation, ou le type, mais jamais rien.
  try {
    const serialized = JSON.stringify(cause);
    if (serialized !== undefined && serialized !== "{}" && serialized.length > 2) {
      return serialized.slice(0, 300);
    }
  } catch {
    // Sérialisation impossible (référence circulaire) : on continue.
  }
  return `échec sans message (${cause === null ? "null" : typeof cause})`;
};

/**
 * Retire les identifiants internes d'un message destiné à l'écran.
 *
 * ⚠️ Herdr parle en `wB:p4` ; l'utilisateur, lui, voit « le nouvel onglet ». Un
 * identifiant dans une phrase d'erreur ne l'aide pas, et l'a mis en colère à
 * juste titre.
 */
const stripIdentifiers = (message: string): string =>
  message
    .replace(/\bw[0-9A-Za-z]*:p[0-9A-Za-z]+\b/g, "le nouvel onglet")
    .replace(/\bw[0-9A-Za-z]*:t[0-9A-Za-z]+\b/g, "son onglet")
    .replace(/\b(?:pane|tab|workspace)_id=\S+/g, "");

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

/**
 * Remontée d'erreur depuis le navigateur.
 *
 * La cause réelle d'un problème est souvent côté client — un appel qui échoue,
 * un décodage impossible. Sans ce canal, ces erreurs n'existaient que dans une
 * barre rouge, puis disparaissaient.
 */
const clientLog = async (request: RouteRequest): Promise<Response> => {
  const raw: unknown = await request.json().catch(() => undefined);
  const entry = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      Schema.Struct({
        detail: Schema.optional(Schema.Unknown),
        level: Schema.Literal("error"),
        message: Schema.String,
      }),
    )(raw),
  );
  if (entry === undefined) return json({ ok: false }, 400);

  // eslint-disable-next-line no-console -- trace console en plus du fichier
  console.error(`[client] ${entry.message}`);
  await Effect.runPromise(
    writeLog({
      level: entry.level,
      message: entry.message,
      source: "client",
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    }),
  );
  return json({ ok: true });
};

/**
 * Catalogue de modèles d'un type d'agent.
 *
 * Chaque réponse porte **la commande qui l'a produit** (`source`) : un
 * catalogue non traçable ne serait pas vérifiable, et ce projet refuse
 * d'exposer un état qu'on ne peut pas contrôler.
 *
 * Un kind sans mesure renvoie `models: []` et la raison dans `error` — pas
 * une liste devinée. La réponse est toujours **200** : l'absence de catalogue
 * est une information valide, pas une panne du serveur.
 */
const modelCatalog = (request: RouteRequest): Promise<Response> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kind = request.params["kind"] ?? "";
      const catalog = yield* catalogOf(kind);
      return respond(decoderOf(ModelCatalogResponse), { ...catalog, kind });
    }),
  );

/** Corps de la réponse à l'invite de confiance. */
const TrustBody = Schema.Struct({ accept: Schema.Boolean });

const decodeTrustBody = Schema.decodeUnknownOption(TrustBody);

/**
 * Répond à l'invite de confiance d'un agent.
 *
 * Le serveur **relit le pane** avant d'envoyer quoi que ce soit : si l'invite
 * n'est plus là (l'utilisateur a déjà répondu au terminal), la réponse est
 * refusée et **aucune touche n'est envoyée**. Répondre à la place de
 * l'utilisateur à un autre dialogue serait pire que de ne rien faire.
 */
const makeAnswerTrust =
  (herdr: HerdrApi) =>
  async (request: RouteRequest): Promise<Response> => {
    const raw: unknown = await request.json().catch(() => undefined);
    const body = Option.getOrUndefined(decodeTrustBody(raw));
    if (body === undefined) {
      return respond(
        decoderOf(ApiErrorResponse),
        { error: "corps invalide : `accept` (booléen) requis" },
        400,
      );
    }
    const paneId = request.params["paneId"] ?? "";
    const result = await Effect.runPromise(
      Effect.result(respondToTrust(herdr, paneId, body.accept)),
    );
    if (Result.isFailure(result)) {
      const failure = failureOf(result);
      return respond(
        decoderOf(ApiErrorResponse),
        { error: failure === undefined ? "échec inconnu" : describe(failure) },
        502,
      );
    }
    const outcome = Option.getOrUndefined(Result.getSuccess(result));
    if (outcome === undefined) {
      return respond(decoderOf(ApiErrorResponse), { error: "réponse illisible" }, 500);
    }
    return respond(decoderOf(TrustResolvedResponse), {
      accepted: outcome.accepted,
      status: "trust-resolved",
    });
  };

export const makeRoutes = (deps: ApiDeps): Routes => {
  const { config, herdr, hub, sender, watch, startedAt } = deps;

  const answerTrust = makeAnswerTrust(herdr);

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
        log: LOG_PATH,
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
    /** Libellé du projet, connu après lecture du snapshot. */
    let folderLabel = "ce projet";
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
          folderLabel = label;

          // Lancer dans un projet qui a **déjà** un agent est permis : cela crée
          // un nouvel onglet. Interdire obligeait à passer par Herdr à la main
          // pour la manœuvre la plus courante.

          /*
            ⚠️ Le nom d'un agent doit être **unique**. Utiliser le libellé du
            projet faisait échouer le second lancement avec `agent_name_taken` —
            et l'erreur n'était pas exploitable.
          */
          const taken = new Set(
            snapshot.agents
              .map((agent) => agent.name)
              .filter((value): value is string => typeof value === "string"),
          );
          const base = body.name ?? workspace.label ?? "agent";
          let name = base;
          for (let suffix = 2; taken.has(name) && suffix < 100; suffix += 1) {
            name = `${base}-${String(suffix)}`;
          }
          // **Même** fonction que l'aperçu : une seule source pour le dossier.
          const checkout = checkoutPathOf(workspace, snapshot.panes ?? []);
          if (checkout === null) {
            return yield* Effect.fail({
              message: `aucun dossier de travail connu pour ${label}`,
            });
          }

          // Étape 1 : un onglet dans le projet, ouvert dans son dossier.
          const tab = yield* herdr
            .createTab({ cwd: checkout, focus: false, label: name, workspace_id: workspaceId })
            .pipe(
              // ⚠️ Une erreur non qualifiée n'est pas exploitable : on dit quelle
              // étape a échoué, et où en est resté le projet.
              Effect.mapError(
                (cause) =>
                  new LaunchFailed({
                    detail: `l'onglet n'a pas pu être créé : ${describeCause(cause)}`,
                    paneId: null,
                    phase: "onglet",
                  }),
              ),
            );

          // Étape 2 : l'agent, dans le pane à l'invite shell.
          //
          // ⚠️ Un pane fraîchement créé n'est pas **immédiatement** prêt : le
          // shell démarre, lit sa configuration (`zshrc`), puis seulement devient
          // interactif. Herdr répond alors `is not an available shell`.
          // Il n'expose pas cet état dans le snapshot, donc on **réessaie** —
          // attendre un temps fixe serait aussi faux qu'essayer tout de suite.
          // Modèle et raisonnement sont des **args de lancement** : c'est le
          // seul moment où ils peuvent être fixés sans commande dans le TUI.
          // On construit les drapeaux **avant** d'ouvrir l'onglet pour ne pas
          // laisser un onglet vide si la demande est refusée.
          const requested = yield* buildModelArgs(body.kind, body.model, body.thinking);
          if (requested.error !== undefined) {
            yield* herdr.closeTab(tab.tabId).pipe(Effect.ignore);
            return yield* Effect.fail({ message: requested.error });
          }
          const thinkingProblem =
            body.model !== undefined && body.thinking !== undefined
              ? yield* checkThinkingSupported(body.kind, body.model, body.thinking)
              : null;
          if (thinkingProblem !== null) {
            yield* herdr.closeTab(tab.tabId).pipe(Effect.ignore);
            return yield* Effect.fail({ message: thinkingProblem });
          }

          yield* herdr
            .startAgent({
              kind: body.kind,
              name,
              pane_id: tab.paneId,
              timeout_ms: 120_000,
              ...(requested.args.length > 0 ? { args: requested.args } : {}),
            })
            .pipe(
              Effect.retry({
                schedule: Schedule.spaced("3 seconds"),
                while: (cause) => describeCause(cause).includes("not an available shell"),
                times: 10,
              }),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new LaunchFailed({
                    // L'onglet existe : le dire évite de relancer pour rien.
                    detail: `${body.kind} n'a pas démarré : ${describeCause(cause)}`,
                    paneId: tab.paneId,
                    phase: "agent",
                  }),
              ),
            );

          return { kind: body.kind, name, paneId: tab.paneId, tabId: tab.tabId };
        }),
      ),
    );

    if (Result.isFailure(result)) {
      const failure = failureOf(result);

      /*
        ⚠️ Un agent **bloqué au démarrage** n'est pas un échec : c'est une
        question posée à l'utilisateur. Pour codex, cette question est
        « Trust this folder? » — répondre autorise l'exécution de code dans le
        dossier, de façon **persistante**.

        On ne répond donc jamais ici : on vérifie que c'est bien cette invite,
        et on la renvoie à l'application pour que la décision soit visible et
        nommée. C'est aussi pourquoi l'onglet n'est pas refermé dans ce cas :
        l'agent est là, il attend.
      */
      const decoded = Option.getOrUndefined(
        Schema.decodeUnknownOption(
          Schema.Struct({
            detail: Schema.optional(Schema.String),
            paneId: Schema.NullOr(Schema.String),
            phase: Schema.String,
          }),
        )(failure),
      );
      if (
        decoded !== undefined &&
        decoded.phase === "agent" &&
        decoded.paneId !== null &&
        decoded.detail !== undefined &&
        decoded.detail.includes("blocked")
      ) {
        const read = await Effect.runPromise(Effect.result(herdr.readAgent(decoded.paneId)));
        const screen = Result.isSuccess(read)
          ? (Option.getOrUndefined(Result.getSuccess(read))?.text ?? "")
          : "";
        if (isTrustPrompt(screen)) {
          return respond(
            decoderOf(TrustRequiredResponse),
            {
              folder: folderLabel,
              kind: body.kind,
              message: `${body.kind} demande la confiance de « ${folderLabel} ». Il pourra y lire, écrire et exécuter du code — y compris sans te demander. Cette réponse est enregistrée définitivement.`,
              paneId: decoded.paneId,
              status: "trust-required",
            },
            409,
          );
        }
      }

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

  /**
   * Types d'agents **installés sur cette machine**.
   *
   * ⚠️ J'avais codé une liste fixe de onze types. Neuf n'étaient pas installés :
   * le menu proposait de lancer des agents qui n'existent pas. Herdr sait
   * lesquels sont là (`integration.list`) — on lui demande.
   */
  const agentKinds = async (): Promise<Response> => {
    const result = await Effect.runPromise(Effect.result(herdr.request("integration.list")));
    if (Result.isFailure(result)) {
      return respond(decoderOf(ApiErrorResponse), { error: "types d'agents indisponibles" }, 502);
    }
    const payload = Option.getOrUndefined(Result.getSuccess(result)) ?? {};
    const decoded = Option.getOrUndefined(
      Schema.decodeUnknownOption(
        Schema.Struct({
          integrations: Schema.Array(
            Schema.Struct({
              available: Schema.Boolean,
              command: Schema.String,
              label: Schema.String,
              state: Schema.String,
              target: Schema.String,
            }),
          ),
        }),
      )(payload),
    );
    if (decoded === undefined) {
      return respond(decoderOf(ApiErrorResponse), { error: "réponse Herdr illisible" }, 502);
    }

    // `agent.start` attend un `kind`. Pour la plupart c'est la **commande** ;
    // pour quelques-uns c'est la **cible** (Cursor : commande `cursor-agent`,
    // kind `cursor`). On prend la commande quand Herdr la connaît.
    const kinds = decoded.integrations
      .filter((integration) => integration.state !== "not_installed")
      .map((integration) => ({
        kind: ACCEPTED_KINDS.has(integration.command) ? integration.command : integration.target,
        label: integration.label,
        state: integration.state,
      }));

    return respond(decoderOf(InstalledKindsResponse), { kinds });
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
    "/api/agents/kinds": agentKinds,
    "/api/agents/:kind/models": modelCatalog,
    "/api/agents/:paneId/trust": answerTrust,
    "/api/log": clientLog,
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
