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

/**
 * Herdr a-t-il refusé parce que l'agent attend une **saisie interactive** ?
 *
 * ⚠️ **Sur le texte, faute de code typé.** Herdr ne renvoie qu'un code générique
 * (`agent_prompt_failed`) et un message ; le message est donc ce qu'on a de plus
 * précis. Le dépôt s'appuie déjà sur le même genre de texte mesuré ailleurs
 * (« is not an available shell », au lancement). La comparaison est insensible à
 * la casse, et un refus d'une autre nature garde son comportement d'origine.
 */
const refusDeSaisie = (failure: unknown): boolean => {
  const message =
    typeof failure === "object" && failure !== null ? Reflect.get(failure, "message") : undefined;
  const texte = typeof message === "string" ? message : String(failure);
  return texte.toLowerCase().includes("blocked and requires interactive input");
};

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
  /**
   * Envoie un texte vers un agent.
   *
   * ⚠️ **Deux modes, et la différence n'est pas cosmétique.**
   *
   * - `saisie: false` (défaut) — un **prompt** : `agent.prompt`. Herdr le refuse
   *   quand l'agent est bloqué sur une invite interactive.
   * - `saisie: true` — des **frappes** : le texte est écrit dans le pane, puis
   *   `enter`. C'est le seul chemin pour répondre à une invite — « type your own
   *   answer », chez opencode, exige d'écrire dans l'invite.
   *
   * ⚠️ Le succès d'une saisie prouve que Herdr a **écrit** le texte, pas que
   * l'agent l'a appliqué : `pane.send_text` ne renvoie pas d'`agent_prompted`.
   * L'état exposé (« Received by Herdr ») dit exactement ce qui est prouvé.
   */
  readonly send: (
    target: string,
    text: string,
    now?: number,
    saisie?: boolean,
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

      const send = (target: string, text: string, now?: number, saisie = false) =>
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

          /*
            ⚠️ **Deux primitives, deux significations.** `agent.prompt` soumet un
            prompt ; `pane.send_text` écrit des frappes. Herdr refuse la première
            sur un agent qui attend une saisie — c'est lui qui l'a dit, mesuré le
            2026-10-16 : « agent … is blocked and requires interactive input ».
          */
          const frappes = Effect.flatMap(herdr.sendText(target, text), () =>
            herdr.sendKeys(target, ["enter"]),
          );

          let parFrappes = saisie;
          let outcome = yield* Effect.result(
            parFrappes ? frappes : herdr.promptAgent(target, text),
          );

          /*
            ⚠️ **On ne prédit pas le mode, on réagit au refus.**

            Le choix « prompt ou frappes » se faisait sur le **statut** de l'agent
            — et ce statut ment. Mesuré sur un onglet à cinq panes : codex
            attendait une décision (« Hooks need review ») pendant que Herdr le
            déclarait `idle`, si bien que l'envoi partait en `agent.prompt`, était
            refusé, et le pane était **inutilisable depuis le téléphone**.

            Herdr nomme lui-même la raison de son refus : dans ce cas précis, on
            refait par les frappes, qui sont le seul chemin vers une invite. Le
            texte du refus est ce qu'on a de plus précis — il n'expose pas de code
            typé, et le dépôt s'appuie déjà sur le même genre de texte mesuré
            (« is not an available shell », au lancement).
          */
          if (outcome._tag === "Failure" && !saisie && refusDeSaisie(outcome.failure)) {
            parFrappes = true;
            outcome = yield* Effect.result(frappes);
          }

          if (outcome._tag === "Failure") {
            // Échec : on n'enregistre RIEN. Le prochain envoi doit passer.
            return yield* Effect.fail(
              new PromptNotConfirmed({
                detail: `send not confirmed: ${String(outcome.failure)}`,
                target,
              }),
            );
          }

          const entry: Record_ = { confirmedAt: at, fingerprint, target };
          yield* Ref.update(history, (current) => [...purge(current, at), entry]);

          /*
            ⚠️ **La preuve dépend du chemin, et elle ne se confond pas.**
            `agent.prompt` répond `agent_prompted` : Herdr a **soumis** le prompt.
            `pane.send_text` répond qu'il a **écrit** des frappes — pas que
            l'agent les a appliquées. Renvoyer « confirmed » dans les deux cas
            aurait affiché comme envoyé un texte que personne n'a lu.
          */
          return {
            confirmation: parFrappes ? ("unknown" as const) : ("confirmed" as const),
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
