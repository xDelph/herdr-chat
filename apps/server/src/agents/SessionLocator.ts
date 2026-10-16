/**
 * Retrouver le fichier de session d'un agent, quel que soit le référentiel
 * qu'Herdr utilise pour le désigner.
 *
 * ⚠️ **Pourquoi ce module existe.** La première version du produit ne lisait que
 * `kind: "path"`, et la table de `Lisibilite.ts` concluait que codex n'exposait
 * « rien ». C'était faux — la mesure avait été faite trop tôt, ou sur un agent
 * qui n'avait pas encore travaillé. Mesuré à nouveau le 2026-10-13, Herdr 0.9.3,
 * protocole 22, sur un agent codex réellement utilisé :
 *
 * ```
 * agent_session: {source: "herdr:codex", kind: "id", value: "01a13437-cd50-…"}
 * ```
 *
 * Ce n'est pas un chemin, donc l'ancien code l'ignorait — mais cet identifiant
 * est **exactement** celui du nom de fichier de codex :
 *
 * ```
 * ~/.codex/sessions/2026/10/13/rollout-2026-10-13T09-43-54-01a13437-cd50-….jsonl
 * ```
 *
 * La différence entre `path` et `id` est donc un détail de **forme**, pas de
 * capacité : codex écrit bien du JSONL lisible. Le refuser était une erreur de
 * lecture de la part du produit, pas une limite de codex.
 *
 * ⚠️ Ce module ne **devine** jamais. Si l'identifiant ne correspond à aucun
 * fichier, il renvoie `undefined` : l'agent est alors traité comme illisible,
 * plutôt que d'être rattaché au mauvais fichier.
 */
import { globSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Référentiel dans lequel Herdr désigne la session. */
export interface SessionSlot {
  readonly kind: string;
  readonly value: string;
}

/** Type d'agent codex, tel que Herdr le nomme dans `agent`. */
const KIND_CODEX = "codex";

/** Type d'agent opencode. */
const KIND_OPENCODE = "opencode";

/** Type d'agent devin. */
const KIND_DEVIN = "devin";

/**
 * Où vit la session d'un agent.
 *
 * ⚠️ **Deux magasins, pas deux capacités.** pi et codex écrivent un fichier
 * JSONL ; opencode écrit tout dans une base SQLite et désigne une session par sa
 * **clé primaire**. La distinction est une question de forme — c'est elle qui
 * décide *comment* lire, jamais *si* on peut lire.
 */
export type SourceSession =
  | { readonly kind: "fichier"; readonly base: string }
  | {
      readonly kind: "sqlite";
      readonly base: string;
      readonly sessionId: string;
      /**
       * Quel **magasin** SQLite. Deux agents, deux bases, deux schémas — mais une
       * seule forme de page en sortie, donc un seul chemin dans la route.
       */
      readonly magasin: "opencode" | "devin";
    };

/**
 * Base SQLite d'opencode.
 *
 * ⚠️ **Une base, et non un dossier de sessions** : il n'y a donc rien à
 * parcourir, et rien à déduire de l'identifiant — il est la clé, pas un nom de
 * fichier à retrouver (c'est la différence avec codex).
 */
/**
 * Base SQLite de devin.
 *
 * ⚠️ **Mesuré, pas déduit.** Le produit classait devin comme illisible au motif
 * que « Herdr n'expose qu'un identifiant opaque » : c'était la même erreur que
 * pour codex puis opencode. devin écrit `message_nodes` dans cette base, et
 * l'identifiant qu'expose Herdr (`heavenly-…`) est la clé de `sessions`.
 */
export const baseDevin = (): string =>
  process.env["DEVIN_DB"] ?? join(homedir(), ".local", "share", "devin", "cli", "sessions.db");

/** Base SQLite d'opencode. */
export const baseOpencode = (): string =>
  process.env["OPENCODE_DB"] ?? join(homedir(), ".local", "share", "opencode", "opencode.db");

/**
 * Racine des sessions codex.
 *
 * Surchargeable pour les tests : sans cela, tester la résolution exigerait
 * d'écrire dans le vrai dossier de sessions de la machine.
 */
export const racineCodex = (): string =>
  process.env["CODEX_SESSION_ROOT"] ?? join(homedir(), ".codex", "sessions");

/**
 * Résout un identifiant codex en chemin de fichier.
 *
 * L'identifiant est cherché dans le **nom** du fichier, pas dans son contenu :
 * c'est la disposition que codex utilise, et la seule qui permette de trouver le
 * fichier sans le lire. Le motif est ancré sur `rollout-` et sur le séparateur
 * qui précède l'identifiant, pour qu'un identifiant ne puisse pas se faire
 * passer pour un préfixe d'un autre.
 */
export const cheminCodexParId = (id: string): string | undefined => {
  // Un identifiant vide rendrait le motif « n'importe quel rollout » : on
  // refuse plutôt que de renvoyer la session d'un autre.
  if (id.trim().length === 0) return undefined;
  const racine = racineCodex();
  const trouves = globSync(`**/rollout-*-${id}.jsonl`, { cwd: racine });
  // `toSorted` : on ne modifie pas le tableau rendu par `globSync`.
  const premier = trouves.toSorted()[0];
  return premier === undefined ? undefined : join(racine, premier);
};

/**
 * Chemin de session d'un agent, ou `undefined` s'il n'y en a pas.
 *
 * ⚠️ C'est le **seul** point de décision : le registre et les routes passent
 * tous les deux par ici. Deux résolutions parallèles avaient déjà produit deux
 * réponses différentes pour le même agent (D013).
 */
export const localiserSession = (
  agentKind: string | null,
  slot: SessionSlot | null,
): string | undefined => {
  const source = sourceSession(agentKind, slot);
  // Un chemin n'existe que pour un **fichier** : la base opencode n'est pas un
  // chemin de session, et la faire passer pour tel tromperait l'appelant.
  return source?.kind === "fichier" ? source.base : undefined;
};

/**
 * Source de la session d'un agent, ou `undefined` s'il n'y en a pas.
 *
 * Même décision que `localiserSession`, avec la forme en plus — c'est ce dont
 * les lecteurs et la route ont besoin pour choisir leur magasin.
 */
export const sourceSession = (
  agentKind: string | null,
  slot: SessionSlot | null,
): SourceSession | undefined => {
  if (slot === null) return undefined;
  if (slot.kind === "path") return { base: slot.value, kind: "fichier" };
  if (slot.kind !== "id") return undefined;
  if (agentKind === KIND_CODEX) {
    const chemin = cheminCodexParId(slot.value);
    return chemin === undefined ? undefined : { base: chemin, kind: "fichier" };
  }
  if (agentKind === KIND_OPENCODE) {
    // Un identifiant vide désignerait n'importe quoi : on refuse plutôt que de
    // rendre la session d'un autre, comme pour codex.
    if (slot.value.trim().length === 0) return undefined;
    return { base: baseOpencode(), kind: "sqlite", magasin: "opencode", sessionId: slot.value };
  }
  if (agentKind === KIND_DEVIN) {
    // Même garde, même raison.
    if (slot.value.trim().length === 0) return undefined;
    return { base: baseDevin(), kind: "sqlite", magasin: "devin", sessionId: slot.value };
  }
  return undefined;
};
