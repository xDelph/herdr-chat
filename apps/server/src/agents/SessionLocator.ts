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
  if (slot === null) return undefined;
  if (slot.kind === "path") return slot.value;
  if (slot.kind === "id" && agentKind === KIND_CODEX) return cheminCodexParId(slot.value);
  return undefined;
};
