/**
 * Envoi de prompt avec suppression des doubles envois (P6 / D007.2).
 *
 * Règle utilisateur : **deux envois consécutifs du même texte vers la même
 * cible → le second est supprimé.** Mais la suppression **ne tient que si le
 * premier envoi a été CONFIRMÉ** : si le premier a planté, n'a pas été validé,
 * a expiré ou a renvoyé une erreur, le nouvel envoi doit **passer**.
 *
 * Principe utilisateur : *« C'est stupide de faire du steering sur exactement
 * le même texte. »*
 *
 * L'API Herdr **n'offre aucune idempotence** : `AgentPromptParams` = `target`,
 * `text`, `wait`, et `id` n'est qu'une corrélation (vérifié, `docs/PROTOCOL.md`
 * §2.5). La garantie est donc entièrement locale.
 */
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { createHash } from "node:crypto";
import type { HerdrApi } from "../herdr/HerdrClient.ts";

/** Le message identique a déjà été envoyé et confirmé : on ne le réémet pas. */
export class DuplicatePrompt extends Schema.TaggedError<DuplicatePrompt>()("DuplicatePrompt", {
  fingerprint: Schema.String,
  target: Schema.String,
}) {}

/** L'envoi n'a pas été confirmé : la suppression ne doit pas s'appliquer. */
export class PromptNotConfirmed extends Schema.TaggedError<PromptNotConfirmed>()(
  "PromptNotConfirmed",
  {
    detail: Schema.String,
    target: Schema.String,
  },
) {}

export const fingerprintOf = (target: string, text: string): string =>
  createHash("sha256").update(`${target}\u0000${text}`).digest("hex").slice(0, 32);

interface Record_ {
  readonly fingerprint: string;
  readonly target: string;
  /** Instant de la confirmation. `undefined` = **non confirmé**. */
  readonly confirmedAt: number | undefined;
}

export interface SendOutcome {
  readonly status: "sent" | "suppressed";
  readonly fingerprint: string;
  /** État exposé à l'UI, jamais « envoyé » sans confirmation (D007.2). */
  readonly confirmation: "confirmed" | "unknown";
}

export interface PromptSenderApi {
  readonly send: (
    target: string,
    text: string,
    now?: number,
  ) => Effect.Effect<SendOutcome, DuplicatePrompt | PromptNotConfirmed>;
  /** Nombre d'entrées suivies — utile pour vérifier la purge dans les tests. */
  readonly tracked: () => Effect.Effect<number>;
}

export class PromptSender extends Context.Service<PromptSender, PromptSenderApi>()(
  "herdr-remote/PromptSender",
) {
  /**
   * Construit l'expéditeur.
   *
   * La **confirmation** est fournie par Herdr : `agent.prompt` répond
   * `agent_prompted`, ce qui vaut validation côté serveur. Une erreur de
   * protocole ou de transport laisse l'entrée **non confirmée**, donc sans
   * effet bloquant sur le prochain envoi.
   */
  static readonly make = (herdr: HerdrApi, windowMs: number) =>
    Effect.gen(function* () {
      const history = yield* Ref.make<ReadonlyArray<Record_>>([]);

      const purge = (entries: ReadonlyArray<Record_>, now: number) =>
        entries.filter(
          (entry) => entry.confirmedAt !== undefined && now - entry.confirmedAt < windowMs,
        );

      const send = (target: string, text: string, now?: number) =>
        Effect.gen(function* () {
          const at = now ?? Date.now();
          const fingerprint = fingerprintOf(target, text);

          const entries = yield* Ref.get(history);
          const live = purge(entries, at);
          if (live.length !== entries.length) yield* Ref.set(history, live);

          // Suppression uniquement si un envoi IDENTIQUE a été CONFIRMÉ dans la
          // fenêtre. Un envoi non confirmé, ou expiré, ne bloque rien.
          const blocking = live.find((entry) => entry.fingerprint === fingerprint);
          if (blocking !== undefined) {
            return yield* Effect.fail(new DuplicatePrompt({ fingerprint, target }));
          }

          const outcome = yield* Effect.result(herdr.promptAgent(target, text));

          if (outcome._tag === "Failure") {
            // Échec : on n'enregistre RIEN. Le prochain envoi doit passer.
            return yield* Effect.fail(
              new PromptNotConfirmed({
                detail: `envoi non confirmé : ${String(outcome.failure)}`,
                target,
              }),
            );
          }

          const entry: Record_ = { confirmedAt: at, fingerprint, target };
          yield* Ref.update(history, (current) => [...purge(current, at), entry]);

          return {
            confirmation: "confirmed" as const,
            fingerprint,
            status: "sent" as const,
          };
        }).pipe(Effect.withSpan("PromptSender.send", { attributes: { target } }));

      const tracked = () => Effect.map(Ref.get(history), (entries) => entries.length);

      return PromptSender.of({ send, tracked });
    });

  static readonly layer = (herdr: HerdrApi, windowMs: number) =>
    Layer.effect(PromptSender, PromptSender.make(herdr, windowMs));
}
