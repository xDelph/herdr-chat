/**
 * Adaptateur codex → forme pi.
 *
 * ⚠️ **Pourquoi un adaptateur, et pas un second décodeur.** Tout le produit —
 * blocs, aperçu, titre, horodatage, curseur — lit la forme de pi. Écrire un
 * décodeur codex parallèle aurait dupliqué chaque décision, et fait diverger
 * deux affichages. Ici on traduit **une fois**, à l'entrée, et rien en aval ne
 * sait d'où vient la ligne.
 *
 * Mesuré sur codex réel, 2026-10-13 :
 *
 * ```jsonc
 * { "timestamp": "…", "ordinal": 11, "type": "response_item",
 *   "payload": { "type": "message", "role": "assistant",
 *                "content": [{ "type": "output_text", "text": "Hello!" }] } }
 * ```
 *
 * Deux pièges, tous deux mesurés :
 *
 * 1. **`event_msg` duplique les messages.** Le même tour apparaît en
 *    `payload.type: "item_completed"` avec un `item.type: "UserMessage"`. On ne
 *    lit que `response_item` : sinon chaque message s'afficherait deux fois.
 * 2. **Le rôle `developer` est le prompt système.** Il est présent trois fois
 *    dès l'ouverture. Le traduire vers `user` remplirait le chat de consignes
 *    système. Il est donc **écarté**, comme pi écarte ses propres tours système.
 * 3. **`AGENTS.md` arrive en rôle `user`**, pas en `developer` — et c'est le
 *    piège vicieux, parce qu'il est **indiscernable par le rôle**. Mesuré : un
 *    bloc de 8 367 caractères, `role: "user"`, commençant par
 *    `# AGENTS.md instructions for …`. Sans traitement, **chaque** conversation
 *    codex s'ouvre sur un mur de consignes de projet, et le premier message de
 *    l'utilisateur est noyé dessous. On le reconnaît donc à sa **marque** de
 *    structure — l'en-tête et la balise `<INSTRUCTIONS>` —, jamais à sa taille :
 *    un vrai message long n'a pas à être filtré.
 */

/** Rôles qui font partie de la conversation. Le reste est de la configuration. */
const ROLES_CONVERSATION: ReadonlySet<string> = new Set(["user", "assistant"]);

/** Types de bloc de contenu porteurs de texte, du côté codex. */
const TYPES_TEXTE: ReadonlySet<string> = new Set(["input_text", "output_text"]);

/**
 * Marques du contexte que codex **ajoute lui-même** en tête de conversation.
 *
 * Mesuré : un premier bloc `# AGENTS.md instructions for …`, **puis** un second
 * `<environment_context>` (cwd, shell, date). Les deux sont de la configuration,
 * pas des tours de conversation — et le second explique pourquoi un test sur le
 * seul premier bloc ne suffisait pas : le message en porte plusieurs.
 */
const MARQUE_AGENTS_MD = "# AGENTS.md instructions for ";
const MARQUE_ENV = "<environment_context>";

/**
 * Ce bloc est-il du contexte injecté ?
 *
 * Les deux marques de l'`AGENTS.md` sont exigées **ensemble** : l'en-tête en
 * tête, et la balise `<INSTRUCTIONS>`. Exiger les deux évite d'écarter un message
 * où l'utilisateur **parle** de son `AGENTS.md` — ce serait effacer une vraie
 * demande, ce qui est pire que d'afficher du contexte en trop.
 */
const estBlocDeContexte = (texte: string): boolean => {
  const debut = texte.trimStart();
  if (debut.startsWith(MARQUE_ENV)) return true;
  return debut.startsWith(MARQUE_AGENTS_MD) && debut.includes("<INSTRUCTIONS>");
};

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Traduit une ligne codex en ligne de forme pi.
 *
 * Renvoie `undefined` si la ligne n'est pas un message de conversation — auquel
 * cas l'appelant garde la ligne brute, comme pour tout type inconnu.
 */
export const ligneCodexVersPi = (
  parsed: unknown,
):
  | { readonly type: string; readonly timestamp?: string; readonly message: unknown }
  | undefined => {
  if (!estObjet(parsed)) return undefined;
  if (parsed["type"] !== "response_item") return undefined;

  const payload = parsed["payload"];
  if (!estObjet(payload) || payload["type"] !== "message") return undefined;

  const role = payload["role"];
  if (typeof role !== "string" || !ROLES_CONVERSATION.has(role)) return undefined;

  const contenu = payload["content"];
  if (!Array.isArray(contenu)) return undefined;

  const blocs = contenu
    .filter(
      (bloc): bloc is Record<string, unknown> =>
        estObjet(bloc) && typeof bloc["type"] === "string" && TYPES_TEXTE.has(bloc["type"]),
    )
    .map((bloc) => ({ text: typeof bloc["text"] === "string" ? bloc["text"] : "", type: "text" }))
    .filter((bloc) => bloc.text.length > 0);

  // Un message sans texte n'est pas un message : comme pour pi, on ne fabrique
  // pas de bulle vide.
  if (blocs.length === 0) return undefined;

  // ⚠️ Le contexte projet que codex injecte en rôle `user`. Il n'est pas de
  // l'utilisateur, même si codex le range comme tel.
  // ⚠️ `every` sur **tous** les blocs : le contexte injecté en occupe plusieurs.
  // Un vrai message qui ne ferait que commencer par une marque garde ses autres
  // blocs normaux, donc il survit.
  if (role === "user" && blocs.every((bloc) => estBlocDeContexte(bloc.text))) return undefined;

  const horodatage = parsed["timestamp"];
  return {
    ...(typeof horodatage === "string" ? { timestamp: horodatage } : {}),
    message: { content: blocs, role },
    type: "message",
  };
};
