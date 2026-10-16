/**
 * Adaptateur devin → forme pi.
 *
 * ⚠️ **Pourquoi un adaptateur.** Tout le produit — blocs, aperçu, titre,
 * horodatage, curseur — lit la forme de pi. Un second décodeur aurait dupliqué
 * chaque décision d'affichage. Même règle que pour codex et opencode.
 *
 * ⚠️ **La leçon des deux précédents s'applique d'avance.** Le produit classait
 * devin comme illisible : « Herdr n'expose qu'un identifiant opaque ». C'est la
 * MÊME erreur qu'avec codex puis opencode — « pas de chemin » n'est pas « pas de
 * session ». Mesuré le 2026-10-16 : devin écrit une base SQLite locale,
 * `~/.local/share/devin/cli/sessions.db`, et l'identifiant qu'Herdr expose
 * (`heavenly-…`) est **la clé primaire de `sessions`** — ses identifiants sont
 * des paires de mots (`burly-stop`, `tidy-rook`).
 *
 * Mesuré sur cette base (devin 3000.11.92) :
 *
 * ```jsonc
 * { "message_id": "3fd6dff9-…", "role": "assistant",
 *   "content": "I'm powered by SWE-1.6 Slow.",
 *   "thinking": { "thinking": "The user is asking…", "signature": "" },
 *   "tool_calls": [],
 *   "metadata": { "created_at": "2026-06-14T17:18:50.653358Z",
 *                 "generation_model": "swe-1-6-slow", "finish_reason": "stop" } }
 * ```
 *
 * Trois choses que la mesure a apprises :
 *
 * 1. **`system` domine : 129 messages sur 163.** C'est du contexte injecté
 *    (`<system_info>`, dossier courant, date). Le traduire noierait chaque
 *    conversation sous un mur de consignes — le défaut exact que codex a dû
 *    corriger pour son rôle `developer`.
 * 2. **La réflexion est en clair** (`thinking.thinking`), comme opencode et
 *    contrairement à codex qui la chiffre.
 * 3. **`created_at` est déjà une chaîne ISO**, à la différence d'opencode qui
 *    donne des millisecondes Unix. Il n'y a donc rien à convertir.
 *
 * ⚠️ **Ce que cet adaptateur refuse, et pourquoi.** `system` est écarté. Et les
 * appels d'outils sont traduits selon la forme **OpenAI-compatible** — voir
 * `blocsDAppels`, où la réserve est écrite noir sur blanc.
 */
import { estObjet, tableauDe, texteDe } from "./pi.ts";
import type { LignePi } from "./pi.ts";

/**
 * Un appel d'outil devin → bloc `toolCall`.
 *
 * ⚠️ **Cette forme n'a PAS été mesurée.** Les huit messages `assistant` de la
 * base locale portent tous un `tool_calls` **vide** : les sessions datent d'un
 * essai en juin, où aucun outil n'a été appelé. Ce qui suit décrit donc la forme
 * **OpenAI-compatible**, qui est celle du reste du message (`content` en chaîne,
 * `thinking`, `finish_reason`, `tool_calls`) — un faisceau d'indices, pas une
 * preuve.
 *
 * ⚠️ **Le garde-fou, lui, est strict** : un appel n'est retenu que s'il porte un
 * `function.name`. Si la forme réelle diffère, la traduction **ne produit rien**
 * — le fil perd les lignes d'outils, mais n'affiche jamais quelque chose
 * d'inventé. C'est la dégradation qu'on choisit, et elle est visible à l'usage :
 * le premier agent devin qui appelle un outil tranchera.
 */
const blocsDAppels = (appels: unknown): ReadonlyArray<unknown> =>
  tableauDe(appels).flatMap((appel) => {
    if (!estObjet(appel)) return [];
    const fonction = estObjet(appel["function"]) ? appel["function"] : appel;
    const nom = texteDe(fonction["name"]);
    if (nom === undefined) return [];
    return [
      {
        // `arguments` est une **chaîne JSON** dans cette forme : on la décode
        // quand c'est possible, et on garde le texte brut sinon — le perdre
        // serait pire qu'afficher un argument non décodé.
        arguments: argumentsDe(fonction["arguments"] ?? fonction["input"]),
        id: texteDe(appel["id"]) ?? `devin:${nom}`,
        name: nom,
        type: "toolCall",
      },
    ];
  });

/** Arguments littéralement encodés en JSON, ou la chaîne telle quelle. */
const argumentsDe = (brut: unknown): unknown => {
  if (typeof brut !== "string") return brut;
  try {
    return JSON.parse(brut) as unknown;
  } catch {
    return brut;
  }
};

/** Le texte d'une réponse, quand il y en a un. */
const texte = (contenu: unknown): string => (typeof contenu === "string" ? contenu : "");

/** `metadata.created_at`, déjà ISO — ou rien. */
const horodatageDe = (message: Record<string, unknown>): string | undefined =>
  estObjet(message["metadata"]) ? texteDe(message["metadata"]["created_at"]) : undefined;

/**
 * Traduit un `chat_message` devin en ligne de forme pi.
 *
 * Renvoie `undefined` quand la ligne n'est pas de la conversation — auquel cas
 * l'appelant la garde brute, comme pour tout type inconnu.
 */
export const ligneDevinVersPi = (chatMessage: unknown, id: string): LignePi | undefined => {
  if (!estObjet(chatMessage)) return undefined;
  const role = texteDe(chatMessage["role"]);
  // ⚠️ Le contexte injecté, et il est majoritaire : 129 lignes sur 163.
  if (role === "system") return undefined;

  const horodatage = horodatageDe(chatMessage);
  const enveloppe = (message: LignePi["message"]): LignePi => ({
    ...(horodatage === undefined ? {} : { timestamp: horodatage }),
    id: `devin:${id}`,
    message,
    type: "message",
  });

  if (role === "user") {
    const contenu = texte(chatMessage["content"]);
    if (contenu.trim().length === 0) return undefined;
    return enveloppe({ content: [{ text: contenu, type: "text" }], role: "user" });
  }

  if (role !== "assistant") return undefined;

  const blocs: Array<unknown> = [];
  const reflexion = estObjet(chatMessage["thinking"]) ? chatMessage["thinking"] : undefined;
  const pensee = reflexion === undefined ? "" : texte(reflexion["thinking"]);
  // La réflexion est en clair ; `redacted` reste donc faux, comme pour opencode.
  if (pensee.length > 0) blocs.push({ redacted: false, thinking: pensee, type: "thinking" });
  const prose = texte(chatMessage["content"]);
  if (prose.trim().length > 0) blocs.push({ text: prose, type: "text" });
  blocs.push(...blocsDAppels(chatMessage["tool_calls"]));

  // Un message sans bloc n'est pas un message : on ne fabrique pas de bulle vide.
  if (blocs.length === 0) return undefined;
  return enveloppe({ content: blocs, role: "assistant" });
};
