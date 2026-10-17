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
import { Effect, Result } from "effect";
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

/**
 * Les touches qui **accordent** la confiance, par famille d'agent.
 *
 * ⚠️ **Mesuré, pas deviné — et il fallait le mesurer, car les deux familles ne
 * répondent pas du même geste.**
 *
 * - **codex** présente des options **numérotées** (`› 1. … / 2. …`) : on choisit
 *   par le chiffre, puis `enter` ;
 * - **claude** présente une **sélection** sans numéro :
 *
 *       ❯ No, exit
 *         Yes, I trust this folder
 *
 *   L'option qui accorde n'est ni la première ni numérotée, donc le chiffre `1`
 *   de codex ne ferait **rien** — ou pire, choisirait « No, exit ». Il faut
 *   descendre la surbrillance puis valider.
 *
 * ⚠️ Vocabulaire des touches mesuré le 2026-10-16 sur un pane réel
 * (`agent.send_keys` avec `["down"]` a déplacé la surbrillance de « No, exit » à
 * « Yes, I trust this folder », puis `["up"]` l'a remise — **sans jamais
 * valider**, donc sans accorder la confiance). Herdr ne déclare pas ses noms de
 * touches au schéma : « key names are herdr's own spellings ».
 */
export const touchesDeConfiance = (
  kind: string | null,
  accept: boolean,
): ReadonlyArray<string> | undefined => {
  if (kind === "claude") return accept ? ["down", "enter"] : ["enter"];
  if (kind === "codex") return accept ? ["1", "enter"] : ["2"];
  /*
    ⚠️ **Aucune touche pour une famille qu'on n'a pas mesurée** — et c'est un
    garde-fou, pas une timidité.

    Le défaut mesuré : le type d'agent n'était pas lu (un `Option` non déballé),
    donc la famille valait `null`, et la table retombait sur les touches de
    **codex** — `1` puis `enter`. Sur l'invite de claude, qui est une **sélection
    sans numéros**, le `1` est ignoré et le `enter` valide l'option déjà
    surlignée : **« No, exit »**. L'agent **sortait**.

    Envoyer une touche non mesurée, c'est appuyer au hasard sur une invite dont on
    ne connaît pas les options. On refuse, et on dit pourquoi.
  */
  return undefined;
};

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
  /** Famille de l'agent : les touches en dépendent, et c'est mesuré. */
  kind: string | null = null,
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
        detail: "the trust prompt is no longer on screen — nothing was sent",
      };
    }

    // Les touches viennent de la famille d'agent : voir `touchesDeConfiance`.
    const keys = touchesDeConfiance(kind, accept);
    if (keys === undefined) {
      return {
        accepted: false,
        detail: `no known key sequence for the prompt of “${kind ?? "this agent"}” — answer it on the Mac`,
        state: "non-applicable" as const,
      };
    }
    yield* herdr.sendKeys(paneId, keys);

    /*
      ⚠️ **La preuve, c'est deux choses, pas une.** L'invite qui disparaît ne
      suffit pas : un agent qui **meurt** n'affiche plus d'invite non plus. Le
      défaut a été vu en vrai — la carte annonçait « accordé » alors que l'agent
      venait de sortir, et la confiance n'était **pas** écrite. On exige donc
      aussi que l'agent soit encore là.
    */
    const vivant = yield* Effect.result(herdr.getAgent(paneId));
    if (Result.isFailure(vivant)) {
      return {
        accepted: false,
        detail: `the agent of ${paneId} is gone — nothing is proven about the trust`,
        state: "transmise" as const,
      };
    }
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
          ? "decision sent — the prompt is still on screen, so acceptance is not proven"
          : "decision sent — the refusal is not yet confirmed by the screen",
      };
    }

    return {
      accepted: accept,
      state: accept ? ("acceptee" as const) : ("refusee" as const),
      detail: accept
        ? `trust granted for this folder — ${kind} will be able to run code there`
        : /*
            ⚠️ Le refus **arrête** l'agent : codex l'écrit (`2. Quit`), claude
            aussi (`No, exit`). Le texte précédent affirmait « the agent stays
            blocked » — faux dans les deux familles. On nomme la conséquence au
            lieu de la masquer.
          */
          "trust denied: the folder stays unapproved, and this option quits the agent",
    };
  });

/** `true` si une chaîne est un nom de touche acceptable pour cette réponse. */
export const isSafeKey = (key: string): boolean => /^[a-z0-9]$/.test(key) || key === "enter";
