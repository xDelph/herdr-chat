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
 * Répond à l'invite de confiance d'un agent.
 *
 * Deux résultats, tous deux vérifiés :
 * - `accepted: true` — l'invite était bien là, la touche a été envoyée ;
 * - `accepted: false` — l'invite n'est plus à l'écran : **rien n'est envoyé**,
 *   et la raison est renvoyée pour être affichée.
 */
export const respondToTrust = (
  herdr: HerdrApi,
  paneId: string,
  accept: boolean,
): Effect.Effect<{ readonly accepted: boolean; readonly detail: string }, HerdrError> =>
  Effect.gen(function* () {
    // ⚠️ On **lit** avant d'envoyer. Un agent peut avoir été débloqué entre-temps
    // (l'utilisateur a répondu au terminal) : dans ce cas, on ne touche à rien.
    const read = yield* herdr.readAgent(paneId);
    const screen = read.text;

    if (!isTrustPrompt(screen)) {
      return {
        accepted: false,
        detail: "l'invite de confiance n'est plus à l'écran — rien n'a été envoyé",
      };
    }

    // `1` puis `enter` : l'option « faire confiance » est la première, mais on
    // ne suppose pas qu'elle est déjà sélectionnée.
    const keys = accept ? ["1", "enter"] : ["2"];
    yield* herdr.sendKeys(paneId, keys);

    return {
      accepted: accept,
      detail: accept
        ? "confiance accordée à ce dossier — codex pourra y exécuter du code"
        : "confiance refusée : le dossier reste non approuvé et l'agent reste bloqué",
    };
  });

/** `true` si une chaîne est un nom de touche acceptable pour cette réponse. */
export const isSafeKey = (key: string): boolean => /^[a-z0-9]$/.test(key) || key === "enter";
