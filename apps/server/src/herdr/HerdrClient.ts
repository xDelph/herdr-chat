/**
 * Client du protocole Herdr.
 *
 * Le client ne suppose **jamais** qu'une méthode existe parce que le schéma la
 * déclare : `events.wait` annonce 19 variantes et n'en implémente qu'une, et
 * `revision` vaut `0` en permanence (E3, `docs/PROTOCOL.md` §10). Les
 * capacités sont mesurées, pas déduites.
 *
 * Aucune donnée entrante n'est forcée par une assertion de type : tout passe
 * par un décodage `Schema`. Une charge utile partielle reste exploitable
 * plutôt que de faire tomber un écran (« fonctionnement dégradé propre »).
 */
import {
  AgentListPayload,
  AgentInfo,
  HerdrReply,
  Method,
  PaneReadPayload,
  PongPayload,
} from "@herdr-remote/shared";
import { Context, Effect, Layer, Option, Schema, pipe } from "effect";
import { TransportTag } from "./Transport.ts";
import type { TransportError } from "./Transport.ts";

/** Le serveur a répondu, mais avec une erreur de protocole. */
export class HerdrProtocolError extends Schema.TaggedError<HerdrProtocolError>()(
  "HerdrProtocolError",
  {
    code: Schema.String,
    message: Schema.String,
    method: Schema.String,
  },
) {}

/** La réponse n'est pas un JSON exploitable, ou pas une enveloppe valide. */
export class HerdrDecodeError extends Schema.TaggedError<HerdrDecodeError>()("HerdrDecodeError", {
  detail: Schema.String,
  method: Schema.String,
  raw: Schema.String,
}) {}

export type HerdrError = TransportError | HerdrProtocolError | HerdrDecodeError;

/** Payload utile d'une réponse : `result` tel quel. */
export type ResultPayload = Readonly<Record<string, unknown>>;

const decodeReply = Schema.decodeUnknownSync(HerdrReply);
const decodeAgentList = Schema.decodeUnknownOption(AgentListPayload);
const decodePaneRead = Schema.decodeUnknownOption(PaneReadPayload);
const decodePong = Schema.decodeUnknownOption(PongPayload);
const decodeAgent = Schema.decodeUnknownOption(AgentInfo);

/**
 * Réponse de `tab.create` : `{ tab, root_pane }`.
 *
 * `root_pane` est le pane **à l'invite shell** où `agent.start` pourra démarrer.
 * Sans lui, un lancement n'a nulle part où aller.
 */
const TabCreated = Schema.Struct({
  root_pane: Schema.Struct({ pane_id: Schema.String }),
  tab: Schema.Struct({ tab_id: Schema.String }),
});
const decodeTabCreated = (payload: unknown): Option.Option<{ paneId: string; tabId: string }> => {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(TabCreated)(payload));
  return decoded === undefined
    ? Option.none()
    : Option.some({ paneId: decoded.root_pane.pane_id, tabId: decoded.tab.tab_id });
};

/** Paramètres de création d'un onglet. */
export interface CreateTabParams {
  readonly cwd?: string;
  readonly focus?: boolean;
  readonly label?: string;
  readonly workspace_id?: string;
}

/** Paramètres de démarrage d'un agent dans un pane existant. */
export interface StartAgentParams {
  readonly args?: ReadonlyArray<string>;
  readonly kind: string;
  readonly name: string;
  readonly pane_id: string;
  readonly timeout_ms?: number;
}

export interface HerdrApi {
  /** Envoie une requête brute et renvoie le `result` décodé. */
  readonly request: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<ResultPayload, HerdrError>;

  /** `ping` — sert aussi à valider `protocol` et `capabilities`. */
  readonly ping: () => Effect.Effect<
    { readonly protocol: number; readonly version: string },
    HerdrError
  >;

  /** Agents valides. Les entrées non décodables sont écartées, pas fatales. */
  readonly listAgents: () => Effect.Effect<
    { readonly agents: ReadonlyArray<AgentInfo>; readonly skipped: number },
    HerdrError
  >;

  readonly snapshot: () => Effect.Effect<ResultPayload, HerdrError>;
  readonly getAgent: (target: string) => Effect.Effect<ResultPayload, HerdrError>;

  readonly readAgent: (
    target: string,
    lines?: number,
    source?: "recent" | "visible",
  ) => Effect.Effect<{ readonly text: string; readonly truncated: boolean }, HerdrError>;

  readonly promptAgent: (target: string, text: string) => Effect.Effect<ResultPayload, HerdrError>;
  /**
   * Met le focus sur un agent — et c'est **ainsi qu'un `done` repasse `idle`**.
   *
   * ⚠️ **Mesuré, deux fois, parce que je m'étais trompé.** `agent.view.set`
   * répond `{active: true}` et ne change **rien** au statut : ma première
   * conclusion était une corrélation. Relevé sur un pane `done` :
   *
   * ```text
   * agent.view.set  -> {"active": true}      statut inchangé : done
   * agent.focus     -> {"agent_status":"idle","focused":true}
   * ```
   *
   * ⚠️ **Ce n'est pas un effet de bord, c'est le mécanisme.** Herdr répute une
   * réponse lue quand le pane prend le focus — c'est ce qu'il fait quand on
   * clique l'agent chez lui. Il n'existe pas d'autre chemin : acquitter sans
   * focaliser est ce que `view.set` prétend faire, et ne fait pas.
   *
   * ⚠️ Conséquence assumée, et elle doit être dite : ouvrir une conversation
   * depuis le téléphone **déplace le focus dans Herdr sur le Mac**. C'est le
   * prix de l'acquittement, et le seul.
   */
  readonly focusAgent: (target: string) => Effect.Effect<ResultPayload, HerdrError>;

  /**
   * Crée un onglet et renvoie son pane racine.
   *
   * C'est la première moitié d'un lancement d'agent : `agent.start` exige un
   * pane **déjà à son invite shell**.
   */
  readonly createTab: (
    params: CreateTabParams,
  ) => Effect.Effect<{ readonly paneId: string; readonly tabId: string }, HerdrError>;

  /** Démarre un agent dans un pane existant. */
  readonly startAgent: (params: StartAgentParams) => Effect.Effect<ResultPayload, HerdrError>;

  /**
   * Ferme un onglet.
   *
   * Utilisé pour **ne rien laisser derrière soi** : si le lancement d'un agent
   * est refusé après la création de l'onglet (modèle inconnu, niveau non
   * supporté), l'onglet vide est refermé. Sans cela, un refus laisserait un
   * onglet nu dans le projet de l'utilisateur.
   */
  readonly closeTab: (tabId: string) => Effect.Effect<ResultPayload, HerdrError>;

  readonly sendKeys: (
    target: string,
    keys: ReadonlyArray<string>,
  ) => Effect.Effect<ResultPayload, HerdrError>;
}

export class HerdrClient extends Context.Service<HerdrClient, HerdrApi>()(
  "herdr-remote/herdr/HerdrClient",
) {
  /**
   * Construit le client à partir d'un transport.
   *
   * `make` est séparé du `Layer` : les tests composent le client avec un
   * transport en mémoire, sans toucher au système de fichiers.
   */
  static readonly make = (transport: {
    readonly send: (line: string) => Effect.Effect<string, TransportError>;
  }): HerdrApi => {
    let counter = 0;

    const request = (
      method: string,
      params: Readonly<Record<string, unknown>> = {},
    ): Effect.Effect<ResultPayload, HerdrError> =>
      Effect.gen(function* () {
        const id = yield* Effect.sync(() => `hr-${++counter}`);
        const line = yield* Effect.sync(() => JSON.stringify({ id, method, params }));
        const raw = yield* transport.send(line);

        const reply = yield* Effect.try({
          try: () => decodeReply(JSON.parse(raw)),
          catch: (cause) =>
            new HerdrDecodeError({
              detail: cause instanceof Error ? cause.message : String(cause),
              method,
              raw,
            }),
        });

        if (reply.error !== undefined) {
          return yield* Effect.fail(
            new HerdrProtocolError({
              code: reply.error.code,
              message: reply.error.message,
              method,
            }),
          );
        }

        const result = reply.result;
        if (result === undefined) {
          return yield* Effect.fail(
            new HerdrDecodeError({
              detail: "response with neither `result` nor `error`",
              method,
              raw,
            }),
          );
        }

        return result;
      }).pipe(Effect.withSpan("HerdrClient.request", { attributes: { method } }));

    const listAgents = () =>
      pipe(
        request(Method.agentList),
        Effect.map((payload) => {
          const decoded = decodeAgentList(payload);
          if (Option.isNone(decoded)) {
            // Le lot entier est illisible : on retente agent par agent pour
            // sauver ce qui peut l'être.
            const rawItems = payload["agents"];
            const items = Schema.is(Schema.Array(Schema.Unknown))(rawItems) ? rawItems : [];
            const agents = items.flatMap((item) => {
              const one = decodeAgent(item);
              return Option.isSome(one) ? [one.value] : [];
            });
            return { agents, skipped: items.length - agents.length };
          }
          return { agents: decoded.value.agents, skipped: 0 };
        }),
      );

    const snapshot = () => request(Method.sessionSnapshot);

    const getAgent = (target: string) => request(Method.agentGet, { target });

    /**
     * Lit l'écran d'un pane.
     *
     * ⚠️ **`source` n'est pas un détail.** Un agent qui attend une réponse passe
     * en **écran alternatif**, et Herdr refuse alors de relire l'historique :
     *
     * > cannot read 200 lines while wB:p16 is blocked: its alternate-screen
     * > history can only be captured by scrolling while idle.
     * > Wait and retry, or use `--source visible`
     *
     * Autrement dit, la lecture qui sert à **détecter** une invite est justement
     * celle qui échoue quand l'invite est affichée. `visible` lit l'écran
     * courant, sans historique — ce qui est précisément ce qu'on veut pour une
     * question, et suffisant pour un agent au repos.
     */
    const readAgent = (target: string, lines = 200, source: "recent" | "visible" = "recent") =>
      pipe(
        request(Method.agentRead, {
          target,
          source,
          ...(source === "visible" ? {} : { lines }),
          strip_ansi: true,
        }),
        Effect.map((payload) => {
          const decoded = decodePaneRead(payload);
          return {
            text: Option.isSome(decoded) ? (decoded.value.read?.text ?? "") : "",
            truncated: Option.isSome(decoded) ? (decoded.value.read?.truncated ?? false) : false,
          };
        }),
      );

    const promptAgent = (target: string, text: string) =>
      request(Method.agentPrompt, { target, text });

    const createTab = (params: CreateTabParams) =>
      pipe(
        request(Method.tabCreate, {
          cwd: params.cwd ?? null,
          focus: params.focus ?? false,
          label: params.label ?? null,
          workspace_id: params.workspace_id ?? null,
        }),
        Effect.flatMap((payload) => {
          const decoded = decodeTabCreated(payload);
          if (Option.isNone(decoded)) {
            return Effect.fail(
              new HerdrDecodeError({
                detail: "`tab.create` without a usable root pane",
                method: Method.tabCreate,
                raw: JSON.stringify(payload).slice(0, 300),
              }),
            );
          }
          return Effect.succeed(decoded.value);
        }),
      );

    const startAgent = (params: StartAgentParams) =>
      request(Method.agentStart, {
        args: params.args ?? [],
        kind: params.kind,
        name: params.name,
        pane_id: params.pane_id,
        timeout_ms: params.timeout_ms ?? 60_000,
      });

    const ping = () =>
      pipe(
        request(Method.ping),
        Effect.flatMap((payload) => {
          const decoded = decodePong(payload);
          return Option.isSome(decoded)
            ? Effect.succeed(decoded.value)
            : Effect.fail(
                new HerdrDecodeError({
                  detail: "`ping` response without `protocol` or `version`",
                  method: Method.ping,
                  raw: JSON.stringify(payload),
                }),
              );
        }),
      );

    const closeTab = (tabId: string) => request(Method.tabClose, { tab_id: tabId });

    const focusAgent = (target: string) => request(Method.agentFocus, { target });

    const sendKeys = (target: string, keys: ReadonlyArray<string>) =>
      request(Method.agentSendKeys, { keys: [...keys], target });

    return HerdrClient.of({
      closeTab,
      createTab,
      getAgent,
      listAgents,
      ping,
      promptAgent,
      readAgent,
      request,
      sendKeys,
      snapshot,
      startAgent,
      focusAgent,
    });
  };

  /** Layer de production : transport réel sur le socket Unix fourni. */
  static readonly layer = (socketPath: string) =>
    Layer.effect(
      HerdrClient,
      Effect.gen(function* () {
        const transport = yield* TransportTag;
        return HerdrClient.make(transport);
      }),
    ).pipe(Layer.provide(TransportTag.layer(socketPath)));
}
