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
  InstalledKindsResponse,
  ApiErrorResponse,
  HealthResponse,
  LaunchAgentRequest,
  LaunchAgentResponse,
  ModelCatalogResponse,
  OverviewResponse,
  TrustRequiredResponse,
  QuestionAnsweredResponse,
  TrustResolvedResponse,
  PromptFailedResponse,
  PromptSentResponse,
  PromptSuppressedResponse,
} from "@herdr-remote/shared";
import { buildOverview, checkoutPathOf, composerOverview } from "../agents/AgentRegistry.ts";
import { buildModelArgs, checkThinkingSupported } from "../agents/ModelArgs.ts";
import { catalogOf } from "../agents/ModelCatalog.ts";
import { isTrustPrompt, respondToTrust } from "../agents/TrustPrompt.ts";
import { repondreQuestion } from "../agents/AnswerQuestion.ts";
import type { ServerConfig } from "../config.ts";
import type { WatchLoop } from "../events/AgentWatcher.ts";
import type { EventHubApi } from "../events/EventHub.ts";
import type { HerdrApi } from "../herdr/HerdrClient.ts";
import type { PromptSenderApi } from "../send/PromptSender.ts";
import { MAX_PROMPT_BYTES } from "@herdr-remote/shared";
import {
  decodeSnapshot,
  decoderOf,
  describe,
  describeCause,
  failureOf,
  json,
  respond,
  run,
} from "./Reply.ts";
import { byteLengthUtf8 } from "./Reply.ts";
import type { RouteRequest, Routes } from "./Reply.ts";
import { makeSessionRoutes } from "./routes-sessions.ts";
import { makeFileRoutes } from "./routes-files.ts";
import { makeEventRoutes } from "./routes-events.ts";
import { makeConversationRoutes } from "./routes-conversations.ts";
import { typeLisible } from "../agents/Lisibilite.ts";
import { describeGuardRejection, guardMutation, methodNotAllowed } from "./OriginGuard.ts";
import { writeLog } from "../logging/LogFile.ts";

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

const decodePromptBody = Schema.decodeUnknownOption(PromptBody);

/**
 * Étapes du lancement, dans l'ordre (B08).
 *
 * Union fermée, pas une chaîne libre : une étape nommée est ce qui permet à
 * l'interface de dire *où* ça a coincé, et à l'utilisateur de savoir s'il
 * faut nettoyer un onglet ou simplement réessayer.
 */
const LaunchPhase = Schema.Literals(["validation", "onglet", "agent", "detection"]);

/** Échec de lancement, qualifié par l'étape qui a échoué. */
class LaunchFailed extends Schema.TaggedError<LaunchFailed>()("LaunchFailed", {
  detail: Schema.String,
  paneId: Schema.NullOr(Schema.String),
  phase: LaunchPhase,
}) {}

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
const decodeAnswerBody = Schema.decodeUnknownOption(Schema.Struct({ numero: Schema.Number }));

const makeAnswerTrust =
  (logPath: string, publicOrigins: ReadonlyArray<string>, herdr: HerdrApi) =>
  async (request: RouteRequest): Promise<Response> => {
    const refused = refuseIfCrossSite(logPath, request, publicOrigins);
    if (refused !== undefined) return refused;

    const raw: unknown = await request.json().catch(() => undefined);
    const body = Option.getOrUndefined(decodeTrustBody(raw));
    if (body === undefined) {
      return respond(
        logPath,
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
        logPath,
        decoderOf(ApiErrorResponse),
        { error: failure === undefined ? "échec inconnu" : describe(failure) },
        502,
      );
    }
    const outcome = Option.getOrUndefined(Result.getSuccess(result));
    if (outcome === undefined) {
      return respond(logPath, decoderOf(ApiErrorResponse), { error: "réponse illisible" }, 500);
    }
    return respond(logPath, decoderOf(TrustResolvedResponse), {
      accepted: outcome.accepted,
      status: "trust-resolved",
    });
  };

/**
 * Réponse à une question d'agent, avec **le choix** retenu.
 *
 * ⚠️ Le numéro est **validé contre les choix réellement affichés** dans
 * `repondreQuestion`, pas ici : une route qui se contenterait de vérifier
 * « entier positif » laisserait passer un `7` sur une liste de quatre.
 */
const makeAnswerQuestion =
  (logPath: string, publicOrigins: ReadonlyArray<string>, herdr: HerdrApi) =>
  async (request: RouteRequest): Promise<Response> => {
    const refused = refuseIfCrossSite(logPath, request, publicOrigins);
    if (refused !== undefined) return refused;

    const raw: unknown = await request.json().catch(() => undefined);
    const body = Option.getOrUndefined(decodeAnswerBody(raw));
    if (body === undefined) {
      return respond(
        logPath,
        decoderOf(ApiErrorResponse),
        { error: "corps invalide : `numero` (entier) requis" },
        400,
      );
    }

    const paneId = request.params["paneId"] ?? "";
    const result = await Effect.runPromise(
      Effect.result(repondreQuestion(herdr, paneId, body.numero)),
    );
    if (Result.isFailure(result)) {
      const failure = failureOf(result);
      return respond(
        logPath,
        decoderOf(ApiErrorResponse),
        { error: failure === undefined ? "échec inconnu" : describe(failure) },
        502,
      );
    }
    const outcome = Option.getOrUndefined(Result.getSuccess(result));
    if (outcome === undefined) {
      return respond(logPath, decoderOf(ApiErrorResponse), { error: "réponse illisible" }, 500);
    }
    return respond(logPath, decoderOf(QuestionAnsweredResponse), {
      detail: outcome.detail,
      state: outcome.state,
      status: "question-answered",
    });
  };

/**
 * Types acceptés par `agent.start`, relevés dans `herdr agent start --help`.
 * Sert à décider si l'on passe la commande ou la cible comme `kind`.
 */
/**
 * Forme de `integration.list`, le seul endroit qui dit quels agents existent.
 *
 * Partagé par le menu (`/api/agents/kinds`) et par le **lancement** : les deux
 * doivent porter sur la même liste, sinon le menu peut proposer un agent que le
 * lancement refuse — ou l'inverse, ce qui est pire (B07).
 */
const InstalledList = Schema.Struct({
  integrations: Schema.Array(
    Schema.Struct({
      available: Schema.Boolean,
      command: Schema.String,
      label: Schema.String,
      state: Schema.String,
      target: Schema.String,
    }),
  ),
});

const decodeInstalledKinds = Schema.decodeUnknownOption(InstalledList);

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

/**
 * Remontée d'erreur depuis le navigateur.
 *
 * La cause réelle d'un problème est souvent côté client — un appel qui échoue,
 * un décodage impossible. Sans ce canal, ces erreurs n'existaient que dans une
 * barre rouge, puis disparaissaient.
 */
const clientLog = async (
  logPath: string,
  publicOrigins: ReadonlyArray<string>,
  request: RouteRequest,
): Promise<Response> => {
  const refused = refuseIfCrossSite(logPath, request, publicOrigins);
  if (refused !== undefined) return refused;

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
  if (entry === undefined) return json(logPath, { ok: false }, 400);

  // Trace console en plus du fichier, comme pour les réponses du serveur.
  console.error(`[client] ${entry.message}`);
  await Effect.runPromise(
    writeLog(logPath, {
      level: entry.level,
      message: entry.message,
      source: "client",
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    }),
  );
  return json(logPath, { ok: true });
};

const modelCatalog = (logPath: string, request: RouteRequest): Promise<Response> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const kind = request.params["kind"] ?? "";
      const catalog = yield* catalogOf(kind);
      return respond(logPath, decoderOf(ModelCatalogResponse), { ...catalog, kind });
    }),
  );

/**
 * Refus d'une requête mutante, ou `undefined` si elle est acceptable (S02).
 *
 * Le refus rend la **cause** : 403 pour une origine absente ou étrangère,
 * 415 pour un type de contenu inadéquat. Un refus muet serait impossible à
 * diagnostiquer depuis le téléphone. Il part aussi au journal : un 403 sans
 * trace ne se comprend pas après coup.
 */
const refuseIfCrossSite = (
  logPath: string,
  request: RouteRequest,
  publicOrigins: ReadonlyArray<string>,
): Response | undefined => {
  // 1. Méthode. Une route mutante n'accepte que POST ; `Allow` est renvoyé avec
  //    le 405, sinon le client ignore la route au lieu de se corriger.
  const method = request.method ?? "POST";
  if (method !== "POST") return methodNotAllowed();

  const verdict = guardMutation(request, publicOrigins);
  if (verdict.ok) return undefined;
  const reason = verdict.reason ?? "origin-etrangere";
  return respond(
    logPath,
    decoderOf(ApiErrorResponse),
    // ⚠️ Les deux origines sont rapportées : un refus qui ne dit pas ce qui a
    // été trouvé oblige à reproduire la requête pour comprendre.
    { error: describeGuardRejection(reason, verdict.attendue, verdict.recue) },
    verdict.status ?? 403,
  );
};

export const makeRoutes = (deps: ApiDeps): Routes => {
  const { config, herdr, hub, sender, watch, startedAt } = deps;

  const answerTrust = makeAnswerTrust(config.logPath, config.publicOrigins, herdr);
  const answerQuestion = makeAnswerQuestion(config.logPath, config.publicOrigins, herdr);
  const sessionRoutes = makeSessionRoutes(config, herdr);
  const fileRoutes = makeFileRoutes(config, herdr);
  const eventRoutes = makeEventRoutes(hub);
  const conversationRoutes = makeConversationRoutes(config, herdr);

  const health = (): Promise<Response> =>
    Effect.gen(function* () {
      const ping = yield* Effect.result(herdr.ping());
      // Herdr injoignable n'est pas une erreur du backend : on répond 503 avec
      // `reachable: false`, jamais une 200 qui laisserait croire que tout va bien.
      if (Result.isFailure(ping)) {
        return respond(
          config.logPath,
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
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          { error: "réponse `ping` illisible" },
          500,
        );
      }
      return respond(config.logPath, decoderOf(HealthResponse), {
        herdr: {
          protocol: value.protocol,
          reachable: true,
          socket: config.herdrSocketPath,
          version: value.version,
        },
        log: config.logPath,
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
      config.logPath,
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
            /*
              ⚠️ Même composition que le chemin lent (U14). Le cache servait
              ici les agents **non filtrés** : les agents muets réapparaissaient
              toutes les 15 s, et quelqu'un pouvait les ouvrir entre deux
              relances du snapshot.

              Le cache servait aussi des vues de projet sans agents ni panes :
              `agentPanes` était donc toujours vide, et l'interface croyait que
              chaque projet était vide.
            */
            return composerOverview({
              herdrProtocol: snapshot.protocol,
              herdrVersion: snapshot.version,
              // `panes` vient du snapshot, jamais du cache : le cache ne les
              // contient pas.
              panes: snapshot.panes,
              tous: cached,
              workspaces: snapshot.workspaces,
            });
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
      (body) => respond(config.logPath, decoderOf(OverviewResponse), body),
    );

  const prompt = async (request: RouteRequest): Promise<Response> => {
    const refused = refuseIfCrossSite(config.logPath, request, config.publicOrigins);
    if (refused !== undefined) return refused;

    const raw: unknown = await request.json().catch(() => undefined);
    const body = Option.getOrUndefined(decodePromptBody(raw));
    if (body === undefined) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "corps invalide : `text` (chaîne) requis" },
        400,
      );
    }

    // ⚠️ La taille est mesurée en **octets UTF-8** (S06), pas en caractères :
    // un prompt de 32 000 emojis ferait 128 000 octets et saturerait Herdr
    // sans jamais approcher la limite annoncée à l'utilisateur.
    const promptBytes = byteLengthUtf8(body.text);
    if (promptBytes > MAX_PROMPT_BYTES) {
      // Refusé **avant** toute action Herdr : un prompt tronqué ou refusé
      // après coup laisserait l'agent dans un état incompréhensible.
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        {
          cause: "io",
          error: `prompt trop long (${String(promptBytes)} octets, maximum ${String(MAX_PROMPT_BYTES)})`,
        },
        413,
      );
    }
    const paneId = request.params["paneId"] ?? "";

    const result = await Effect.runPromise(Effect.result(sender.send(paneId, body.text)));

    if (Result.isSuccess(result)) {
      const outcome = Option.getOrUndefined(Result.getSuccess(result));
      if (outcome === undefined) {
        return respond(
          config.logPath,
          decoderOf(ApiErrorResponse),
          { error: "résultat d'envoi illisible" },
          500,
        );
      }
      await Effect.runPromise(hub.publish("prompt", { paneId, ...outcome }));
      return respond(config.logPath, decoderOf(PromptSentResponse), outcome);
    }

    const failure = failureOf(result);
    // Un double envoi n'est pas une erreur serveur : c'est un no-op assumé (D007.2).
    if (failure !== undefined && isDuplicate(failure)) {
      await Effect.runPromise(
        hub.publish("prompt-suppressed", { paneId, reason: "envoi identique consécutif" }),
      );
      return respond(config.logPath, decoderOf(PromptSuppressedResponse), {
        reason: "envoi identique déjà confirmé dans la fenêtre",
        status: "suppressed",
      });
    }
    // ⚠️ B05 : quatre états distincts, jamais « envoyé ».
    //   - `attente`  : Herdr n'a pas tranché (timeout) → l'utilisateur ne sait
    //     pas si son message est parti ; il doit pouvoir le renvoyer.
    //   - `erreur`   : Herdr a refusé → l'envoi n'a **pas** eu lieu.
    //   - `inconnu`  : transport seul, sans preuve d'acceptation.
    // Aucun de ces trois ne s'affiche « envoyé ».
    const state = promptFailureState(failure);
    return respond(
      config.logPath,
      decoderOf(PromptFailedResponse),
      {
        detail: failure === undefined ? "cause inconnue" : describe(failure),
        state,
      },
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
   * **C'est la seule opération qui crée quelque chose chez Herdr.** Trois étapes,
   * imposées par Herdr : validation, puis un onglet (le pane doit être à son
   * invite shell), puis l'agent dedans.
   *
   * ⚠️ Un projet qui a **déjà** un agent peut en recevoir un second, mais
   * seulement par action explicite : chaque lancement crée un nouvel onglet.
   * Interdire obligeait à passer par Herdr à la main pour la manœuvre la plus
   * courante. Aucun second agent n'est jamais lancé automatiquement.
   *
   * Chaque échec nomme son étape (`phase`) et renvoie le pane éventuellement
   * créé : un agent qui a démarré puis s'est détecté comme bloqué doit rester
   * récupérable, pas disparaître dans un message d'erreur (B08).
   */
  const launchAgent = async (request: RouteRequest): Promise<Response> => {
    const refused = refuseIfCrossSite(config.logPath, request, config.publicOrigins);
    if (refused !== undefined) return refused;

    const workspaceId = request.params["workspaceId"] ?? "";
    const raw: unknown = await request.json().catch(() => undefined);
    const body = decoderOf(LaunchAgentRequest)(raw);
    /** Libellé du projet, connu après lecture du snapshot. */
    let folderLabel = "ce projet";
    if (body === undefined) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "corps invalide : `kind` requis" },
        400,
      );
    }
    // Liste **réellement installée**, pas une liste écrite à la main (B07).
    //
    // ⚠️ L'ancienne liste fixesait vingt-quatre types. Sur cette machine, deux
    // seulement sont installés : le menu proposait de lancer des agents qui
    // n'existaient pas, et le serveur aurait accepté la demande avant de
    // l'échouer plus tard, après avoir créé un onglet.
    //
    // La vérification passe par `integration.list`, donc par Herdr : une capacité
    // est exposée seulement après vérification de son fonctionnement.
    const installed = await Effect.runPromise(Effect.result(herdr.request("integration.list")));
    if (Result.isFailure(installed)) {
      // Sans liste fiable, on refuse : mieux vaut « je ne sais pas » qu'un
      // onglet créé pour un agent qui n'existe pas.
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "types d'agents indisponibles : lancement refusé" },
        503,
      );
    }
    const listed = Option.getOrUndefined(
      decodeInstalledKinds(Option.getOrUndefined(Result.getSuccess(installed))),
    );
    if (listed === undefined) {
      // Forme inattendue : même refus, jamais une liste devinée.
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "liste des types illisible : lancement refusé" },
        503,
      );
    }
    /*
      ⚠️ **Installé ne veut pas dire lisible** (U14).

      `state !== "not_installed"` veut dire : le greffon de suivi est en place.
      Rien ne garantit qu'Herdr expose un chemin de session. Pour opencode il
      n'en expose aucun — son contenu est dans une base — et l'agent qu'on
      lancerait serait alors hors du produit : présent, mais muet.

      On filtre donc sur la capacité **vérifiée**, pas sur la présence.
    */
    const kinds = listed.integrations.filter(
      (integration) =>
        integration.state !== "not_installed" &&
        typeLisible(
          ACCEPTED_KINDS.has(integration.command) ? integration.command : integration.target,
        ),
    );
    const known = kinds.some(
      (integration) => integration.command === body.kind || integration.target === body.kind,
    );
    if (!known) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        {
          error: `type d'agent non installé : « ${body.kind} »`,
          hint: kinds.map((integration) => integration.command).join(", "),
        },
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
            config.logPath,
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
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: failure === undefined ? "échec inconnu" : describe(failure) },
        502,
      );
    }
    const started = Option.getOrUndefined(Result.getSuccess(result));
    if (started === undefined) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "résultat de lancement illisible" },
        500,
      );
    }

    await Effect.runPromise(
      hub.publish("agent-launched", { kind: started.kind, paneId: started.paneId, workspaceId }),
    );

    return respond(
      config.logPath,
      decoderOf(LaunchAgentResponse),
      { ...started, status: "started" },
      201,
    );
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
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "types d'agents indisponibles" },
        502,
      );
    }
    const decoded = Option.getOrUndefined(decodeInstalledKinds(Result.getOrThrow(result)));
    if (decoded === undefined) {
      return respond(
        config.logPath,
        decoderOf(ApiErrorResponse),
        { error: "réponse Herdr illisible" },
        502,
      );
    }

    // `agent.start` attend un `kind`. Pour la plupart c'est la **commande** ;
    // pour quelques-uns c'est la **cible** (Cursor : commande `cursor-agent`,
    // kind `cursor`). On prend la commande quand Herdr la connaît.
    /*
      Même filtre que le lancement (U14) : le menu et le refus doivent porter
      sur **la même** liste, sinon le menu propose ce que le lancement refuse —
      ou l'inverse, ce qui est pire (B07).
    */
    const kinds = decoded.integrations
      .filter((integration) =>
        typeLisible(
          ACCEPTED_KINDS.has(integration.command) ? integration.command : integration.target,
        ),
      )
      .map((integration) => ({
        kind: ACCEPTED_KINDS.has(integration.command) ? integration.command : integration.target,
        label: integration.label,
        state: integration.state,
      }));

    return respond(config.logPath, decoderOf(InstalledKindsResponse), { kinds });
  };

  return {
    "/api/agents/:paneId/prompt": prompt,
    "/api/workspaces/:workspaceId/agents": launchAgent,
    "/api/agents/:paneId/session": sessionRoutes.session,
    "/api/agents/kinds": agentKinds,
    "/api/agents/:kind/models": (request) => modelCatalog(config.logPath, request),
    "/api/agents/:paneId/answer": answerQuestion,
    "/api/agents/:paneId/trust": answerTrust,
    "/api/log": (request) => clientLog(config.logPath, config.publicOrigins, request),
    "/api/events": eventRoutes.events,
    "/api/file": fileRoutes.file,
    "/api/images": fileRoutes.images,
    "/api/health": health,
    "/api/conversations": conversationRoutes.conversations,
    "/api/overview": overview,
  };
};

/**
 * État d'un envoi non confirmé (B05).
 *
 * Distinguer « Herdr n'a pas répondu » de « Herdr a refusé » change tout pour
 * l'utilisateur : dans le premier cas le message est peut-être parti et il
 * faut pouvoir le renvoyer ; dans le second il est perdu et il faut le
 * retaper. Un message unique pour les deux oblige à choisir au hasard.
 */
const promptFailureState = (failure: unknown): "attente" | "erreur" | "inconnu" => {
  if (failure === undefined) return "inconnu";
  const texte = describe(failure).toLowerCase();
  // Un délai dépassé ne prouve ni l'envoi ni le refus.
  if (texte.includes("timeout") || texte.includes("timed out") || texte.includes("deadline"))
    return "attente";
  if (texte.includes("econnrefused") || texte.includes("unreachable") || texte.includes("socket"))
    return "inconnu";
  return "erreur";
};

/** Reconnaît le refus de double envoi sans dépendre du typage de l'union. */
const isDuplicate = (failure: unknown): boolean =>
  typeof failure === "object" &&
  failure !== null &&
  "_tag" in failure &&
  failure._tag === "DuplicatePrompt";

export { describeCause };
