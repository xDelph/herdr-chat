/**
 * Invite de confiance d'un agent — détectée, jamais supposée.
 *
 * ⚠️ **Pourquoi ne pas répondre automatiquement.**
 *
 * « Trust this folder? » autorise l'agent à lire, écrire **et exécuter du
 * code** dans ce dossier — et Codex le dit explicitement dans l'invite
 * (*« Folder settings can run code automatically, even without a model
 * request »*). La réponse est en plus **persistante** : elle écrit
 * `[projects."…"] trust_level = "trusted"` dans `~/.codex/config.toml`.
 *
 * Répondre « oui » à la création d'un agent reviendrait à accorder une
 * confiance à un dossier que l'utilisateur n'a pas choisi de voir — par
 * exemple un dépôt vient d'être cloné. La décision est donc prise **dans
 * l'application**, devant le nom du dossier.
 *
 * Conséquence directe : ce module **refuse d'envoyer quoi que ce soit** tant
 * que l'invite attendue n'est pas literally présente dans le pane. Envoyer
 * `enter` dans un agent bloqué sur une *autre* question y répondrait à la
 * place de l'utilisateur — c'est exactement le genre de porte qui doit être
 * prouvée capable d'échouer.
 */
import { Effect } from "effect";
import type { HerdrApi, HerdrError } from "../herdr/HerdrClient.ts";

/**
 * Marqueurs de l'invite de confiance, relevés **sur l'écran réel**.
 *
 * `herdr agent start` a renvoyé exactement ce texte pour codex sur un dossier
 * non approuvé ; le contrôle est donc une recherche de cette phrase, pas une
 * interprétation de l'état `blocked` (qui pourrait être n'importe quel
 * dialogue).
 */
const TRUST_MARKERS = ["trust this folder", "trust this directory"];

/** `true` si l'invite de confiance est réellement à l'écran. */
export const isTrustPrompt = (screen: string): boolean => {
  const normalized = screen.toLowerCase();
  return TRUST_MARKERS.some((marker) => normalized.includes(marker));
};

/**
 * Répond à l'invite de confiance d'un agent — **sans jamais prétendre que la
 * confiance a été accordée** (B06).
 *
 * ⚠️ **Pourquoi relire après l'envoi.** `sendKeys` renvoie que la frappe est
 * partie : c'est un succès de **transport**, pas d'acceptation. Herdr peut
 * refuser la touche, l'agent peut redémarrer, l'invite peut ne pas être celle
 * qu'on croyait. Dans tous ces cas, `accepted: true` aurait affiché
 * « confiance accordée » alors que le dossier reste non approuvé — et le
 * `codex` ne pourra toujours pas écrire dans ce dossier, sans que rien ne
 * l'explique.
 *
 * Donc : lecture **avant** (l'invite est-elle là ?), frappe, relecture
 * **après** (a-t-elle disparu ?). L'acceptation est déduite de la seconde
 * lecture, pas de la volonté de l'utilisateur.
 */
export const respondToTrust = (
  herdr: HerdrApi,
  paneId: string,
  accept: boolean,
): Effect.Effect<
  {
    readonly accepted: boolean;
    /** `transmise` tant que l'acceptation n'est pas **prouvée**. */
    readonly state: "transmise" | "acceptee" | "refusee" | "non-applicable";
    readonly detail: string;
  },
  HerdrError
> =>
  Effect.gen(function* () {
    // ⚠️ On **lit** avant d'envoyer. Un agent peut avoir été débloqué entre-temps
    // (l'utilisateur a répondu au terminal) : dans ce cas, on ne touche à rien.
    const read = yield* herdr.readAgent(paneId);
    const screen = read.text;

    if (!isTrustPrompt(screen)) {
      return {
        accepted: false,
        state: "non-applicable" as const,
        detail: "l'invite de confiance n'est plus à l'écran — rien n'a été envoyé",
      };
    }

    // `1` puis `enter` : l'option « faire confiance » est la première, mais on
    // ne suppose pas qu'elle est déjà sélectionnée.
    const keys = accept ? ["1", "enter"] : ["2"];
    yield* herdr.sendKeys(paneId, keys);

    // Relecture : l'acceptation est un **fait observé**, pas une intention.
    const apres = yield* herdr.readAgent(paneId);
    const toujoursLa = isTrustPrompt(apres.text);

    if (toujoursLa) {
      // La touche est partie mais l'invite est toujours là : Herdr n'a pas
      // accepté, ou l'agent a redémarré. On ne prétend rien.
      return {
        accepted: false,
        state: "transmise" as const,
        detail: accept
          ? "décision transmise — l'invite est toujours à l'écran, l'acceptation n'est pas prouvée"
          : "décision transmise — le refus n'est pas encore confirmé par l'écran",
      };
    }

    return {
      accepted: accept,
      state: accept ? ("acceptee" as const) : ("refusee" as const),
      detail: accept
        ? "confiance accordée à ce dossier — codex pourra y exécuter du code"
        : "confiance refusée : le dossier reste non approuvé et l'agent reste bloqué",
    };
  });

/** `true` si une chaîne est un nom de touche acceptable pour cette réponse. */
export const isSafeKey = (key: string): boolean => /^[a-z0-9]$/.test(key) || key === "enter";
