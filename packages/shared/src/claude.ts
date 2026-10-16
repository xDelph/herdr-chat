/**
 * Adaptateur Claude Code → forme pi.
 *
 * ⚠️ **Même leçon, quatrième fois.** Le produit classait claude « non
 * concluant » : la sonde était tombée sur un écran de connexion, et rien n'avait
 * été mesuré sur le disque. Sa session est pourtant un **JSONL**, comme Pi :
 * `~/.claude/projects/<dossier>/<uuid>.jsonl`.
 *
 * Mesuré le 2026-10-16 (Claude Code 2.1.301) sur une session réelle, **13 types
 * de lignes** : `user`, `assistant`, `system`, `attachment`, `last-prompt`,
 * `mode`, `permission-mode`, `atis-latch`, `file-history-snapshot`,
 * `api-request-shape`, `api-request-blob`, `api-request`, `ai-title`.
 *
 * ⚠️ **Seuls `user` et `assistant` portent la conversation.** Les onze autres
 * sont de la comptabilité interne — mode, permissions, instantanés de fichiers,
 * titres — et n'ont pas de `message`.
 *
 * ⚠️ **Le piège, et c'est `api-request-blob`.** Ce type porte un `message` avec
 * `role: "user"` dont le contenu est le **prompt système injecté** :
 * `<system-reminder>`, `CLAUDE.md`, l'environnement. Un adaptateur qui trierait
 * sur `message.role` — la lecture évidente — le prendrait pour une demande de
 * l'utilisateur et noierait chaque conversation sous les consignes. On trie donc
 * sur le **type de ligne**, jamais sur le rôle.
 *
 * Mesuré, les quatre formes utiles :
 *
 * ```jsonc
 * {"type":"user","message":{"role":"user","content":"hello"}}
 * {"type":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}
 * {"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"call_…","content":"…"}]}}
 * {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"…"},
 *                                        {"type":"tool_use","id":"call_…","name":"Bash","input":{…}}]}}
 * ```
 */
import { estObjet, tableauDe, texteDe } from "./pi.ts";
import type { LignePi } from "./pi.ts";

/**
 * Marque du contexte que Claude Code injecte **en rôle `user`**.
 *
 * ⚠️ Deuxième ligne de défense : même sur une vraie ligne `user`, un message dont
 * **tous** les blocs sont des rappels système n'est pas une demande. C'est la
 * même règle que pour codex, et pour la même raison — reconnaître le contexte à
 * sa marque, jamais à sa taille.
 */
const MARQUE_RAPPEL = "<system-reminder>";

const estRappel = (texte: string): boolean => texte.trimStart().startsWith(MARQUE_RAPPEL);

/** Un bloc `tool_use` → bloc `toolCall`. */
const blocAppel = (bloc: Record<string, unknown>): unknown => ({
  // L'entrée est **déjà un objet** dans cette forme (`input`), à la différence de
  // la chaîne JSON de devin : il n'y a rien à décoder.
  arguments: estObjet(bloc["input"]) ? bloc["input"] : {},
  id: texteDe(bloc["id"]) ?? "appel",
  name: texteDe(bloc["name"]) ?? "outil",
  type: "toolCall",
});

/** Le texte d'un `tool_result` : une chaîne, ou une liste de blocs. */
const texteDeResultat = (contenu: unknown): string => {
  if (typeof contenu === "string") return contenu;
  return tableauDe(contenu)
    .filter(estObjet)
    .map((bloc) => (typeof bloc["text"] === "string" ? bloc["text"] : ""))
    .join("");
};

/**
 * Traduit une ligne de session Claude Code en ligne de forme pi.
 *
 * Renvoie `undefined` quand la ligne n'est pas de la conversation — auquel cas
 * l'appelant garde la ligne brute, comme pour tout type inconnu.
 */
export const ligneClaudeVersPi = (parsed: unknown): LignePi | undefined => {
  if (!estObjet(parsed)) return undefined;
  const type = parsed["type"];
  // ⚠️ **Sur le TYPE, jamais sur le rôle** : `api-request-blob` porte un
  // `message.role === "user"` qui est le prompt système.
  if (type !== "user" && type !== "assistant") return undefined;

  const message = parsed["message"];
  if (!estObjet(message)) return undefined;
  const contenu = message["content"];

  const horodatage = texteDe(parsed["timestamp"]);
  const uuid = texteDe(parsed["uuid"]);
  const enveloppe = (corps: LignePi["message"]): LignePi => ({
    ...(horodatage === undefined ? {} : { timestamp: horodatage }),
    ...(uuid === undefined ? {} : { id: `claude:${uuid}` }),
    message: corps,
    type: "message",
  });

  // Une chaîne nue : le cas le plus courant d'une demande.
  if (typeof contenu === "string") {
    if (contenu.trim().length === 0 || estRappel(contenu)) return undefined;
    return enveloppe({ content: [{ text: contenu, type: "text" }], role: "user" });
  }

  if (!Array.isArray(contenu)) return undefined;
  const blocs = contenu.filter(estObjet);

  /*
    ⚠️ **Un résultat d'outil est une ligne à part.** Il arrive dans un message de
    rôle `user` — c'est la forme de l'API — mais il ne l'est pas : c'est la
    réponse à l'appel précédent. On en fait donc une entrée `toolResult`, que le
    regroupement rattache à l'appel juste au-dessus.
  */
  const resultats = blocs.filter((bloc) => bloc["type"] === "tool_result");
  if (resultats.length > 0) {
    const texte = resultats.map((bloc) => texteDeResultat(bloc["content"])).join("");
    const enEchec = resultats.some((bloc) => bloc["is_error"] === true);
    return enveloppe({
      content: [{ text: texte, type: "text" }],
      ...(enEchec ? { isError: true } : {}),
      role: "toolResult",
      toolName: "outil",
    });
  }

  const textes = blocs
    .filter((bloc) => bloc["type"] === "text")
    .map((bloc) => (typeof bloc["text"] === "string" ? bloc["text"] : ""))
    .filter((texte) => texte.length > 0 && !estRappel(texte));
  const appels = blocs.filter((bloc) => bloc["type"] === "tool_use").map(blocAppel);

  if (type === "user") {
    // Tous les blocs étaient des rappels : ce n'est pas une demande.
    if (textes.length === 0) return undefined;
    return enveloppe({ content: textes.map((text) => ({ text, type: "text" })), role: "user" });
  }

  const sortie: Array<unknown> = [...textes.map((text) => ({ text, type: "text" })), ...appels];
  // Un message sans bloc n'est pas un message : on ne fabrique pas de bulle vide.
  if (sortie.length === 0) return undefined;
  return enveloppe({ content: sortie, role: "assistant" });
};
