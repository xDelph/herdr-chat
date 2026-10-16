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
 * 1. **Les prompts utilisateur vivent dans `event_msg`.** Sur les sessions
 *    mesurées, `item.type: "UserMessage"` n'a pas de `response_item` associé :
 *    l'ignorer vide le chat de ses prompts. Les événements utilisateur et les
 *    messages `response_item` sont donc tous deux adaptés, avec déduplication
 *    des textes identiques adjacents.
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

import { estObjet, modeleUtilisable, texteDe } from "./pi.ts";
import type { ChangePi, LignePi } from "./pi.ts";

/**
 * Arguments d'un appel d'outil, quelle que soit sa famille.
 *
 * `function_call` donne du JSON dans `arguments` ; `custom_tool_call` donne un
 * script brut dans `input`. On ne convertit pas le script en objet : ce n'est
 * pas du JSON, et l'inventer serait pire que de l'afficher tel quel.
 */
const argumentsDe = (payload: Record<string, unknown>): unknown => {
  const args = payload["arguments"];
  if (typeof args === "string") {
    try {
      return JSON.parse(args) as unknown;
    } catch {
      return args;
    }
  }
  if (args !== undefined) return args;
  const entree = payload["input"];
  return typeof entree === "string" ? entree : undefined;
};

/**
 * Texte d'une sortie d'outil.
 *
 * Mesuré : `output` est une **liste** de blocs `{type:"input_text", text}` pour
 * `function_call_output`, mais une simple chaîne ailleurs. Les deux formes
 * existent dans le même fichier.
 */
const texteDeSortie = (sortie: unknown): string => {
  if (typeof sortie === "string") return sortie;
  if (!Array.isArray(sortie)) return "";
  return sortie
    .filter((bloc): bloc is Record<string, unknown> => estObjet(bloc))
    .map((bloc) => (typeof bloc["text"] === "string" ? bloc["text"] : ""))
    .join("");
};

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

/**
 * Traduit une ligne codex en ligne de forme pi.
 *
 * Renvoie `undefined` si la ligne n'est pas un message de conversation — auquel
 * cas l'appelant garde la ligne brute, comme pour tout type inconnu.
 */
export const ligneCodexVersPi = (parsed: unknown): LignePi | undefined => {
  if (!estObjet(parsed)) return undefined;
  const horodatage = parsed["timestamp"];
  const timestampId = typeof horodatage === "string" ? horodatage : "entry";
  const ordinal = typeof parsed["ordinal"] === "number" ? parsed["ordinal"] : undefined;
  const enveloppe = (message: LignePi["message"], id?: string): LignePi => ({
    ...(typeof horodatage === "string" ? { timestamp: horodatage } : {}),
    id: `codex:${ordinal ?? timestampId}:${id ?? "item"}`,
    message,
    type: "message",
  });

  if (parsed["type"] === "event_msg") {
    const payload = parsed["payload"];
    if (!estObjet(payload) || payload["type"] !== "item_completed") return undefined;
    const item = payload["item"];
    if (!estObjet(item)) return undefined;
    const id = typeof item["id"] === "string" ? item["id"] : undefined;
    if (item["type"] === "UserMessage") {
      const content = item["content"];
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter(estObjet)
                .map((part) => (typeof part["text"] === "string" ? part["text"] : ""))
                .join("")
            : "";
      return text.trim().length === 0
        ? undefined
        : enveloppe({ content: [{ text, type: "text" }], role: "user" }, id);
    }
    if (item["type"] === "AgentMessage") {
      const text = Array.isArray(item["content"])
        ? item["content"]
            .filter(estObjet)
            .map((part) => (typeof part["text"] === "string" ? part["text"] : ""))
            .join("")
        : "";
      if (!text.trim()) return undefined;
      const phase = typeof item["phase"] === "string" ? item["phase"] : undefined;
      return enveloppe(
        {
          content: [{ text, type: "text" }],
          ...(phase === undefined ? {} : { phase }),
          role: "assistant",
        },
        id,
      );
    }
    if (item["type"] === "CommandExecution") {
      const command = Array.isArray(item["command"])
        ? item["command"].findLast((part): part is string => typeof part === "string")
        : undefined;
      if (!command) return undefined;
      const status = item["status"];
      return enveloppe(
        {
          cancelled: status === "cancelled",
          command,
          content: [],
          exitCode: typeof item["exit_code"] === "number" ? item["exit_code"] : null,
          output: typeof item["aggregated_output"] === "string" ? item["aggregated_output"] : "",
          role: "bashExecution",
          truncated: false,
        },
        id,
      );
    }
    if (item["type"] === "FileChange" && estObjet(item["changes"])) {
      const content = Object.entries(item["changes"]).flatMap(([path, change]) => {
        if (!estObjet(change)) return [];
        const diff = typeof change["unified_diff"] === "string" ? change["unified_diff"] : "";
        const edits: Array<{ oldText: string; newText: string }> = [];
        let oldLines: string[] = [];
        let newLines: string[] = [];
        const flush = () => {
          if (oldLines.length || newLines.length)
            edits.push({ oldText: oldLines.join("\n"), newText: newLines.join("\n") });
          oldLines = [];
          newLines = [];
        };
        for (const line of diff.split(/\r?\n/)) {
          if (line.startsWith("@@")) flush();
          else if (line.startsWith("+") && !line.startsWith("+++")) newLines.push(line.slice(1));
          else if (line.startsWith("-") && !line.startsWith("---")) oldLines.push(line.slice(1));
          else if (!line.startsWith("\\")) flush();
        }
        flush();
        return [
          {
            arguments: {
              edits,
              path,
              ...(typeof change["move_path"] === "string" ? { movePath: change["move_path"] } : {}),
              changeType: change["type"],
            },
            id: `${id ?? "file"}:${path}`,
            name: "edit",
            type: "toolCall",
          },
        ];
      });
      return content.length ? enveloppe({ content, role: "assistant" }, id) : undefined;
    }
    return undefined;
  }
  if (parsed["type"] !== "response_item") return undefined;

  const payload = parsed["payload"];
  if (!estObjet(payload)) return undefined;

  // ⚠️ Les appels d'outils et la réflexion passent par le **même** adaptateur.
  // Les ignorer laissait la conversation muette : on ne voyait que les messages
  // dits, alors que tout le travail de codex — et l'appel en attente
  // d'approbation qui le bloque — est dans ces types-là.
  switch (payload["type"]) {
    case "function_call":
    case "custom_tool_call":
      return enveloppe({
        content: [
          {
            arguments: argumentsDe(payload),
            id: payload["call_id"],
            name: typeof payload["name"] === "string" ? payload["name"] : "outil",
            type: "toolCall",
          },
        ],
        role: "assistant",
      });
    case "function_call_output":
    case "custom_tool_call_output":
      return enveloppe({
        content: [{ text: texteDeSortie(payload["output"]), type: "text" }],
        role: "toolResult",
        toolName: "outil",
      });
    case "reasoning":
      // Codex chiffre sa réflexion (`encrypted_content`) et son `summary` est
      // vide : il n'y a **rien** à lire. On le dit masqué plutôt que d'inventer
      // un raisonnement, exactement comme pi pour ses tours masqués.
      return enveloppe({ content: [{ redacted: true, type: "thinking" }], role: "assistant" });
    case "message":
      break;
    default:
      return undefined;
  }

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

  return enveloppe({ content: blocs, role });
};

/**
 * Traduit un **événement de réglage** codex en ligne de changement pi.
 *
 * ⚠️ **Pourquoi une seconde fonction, et pas un cas de plus dans
 * `ligneCodexVersPi`.** Les deux ne traduisent pas la même chose : l'une produit
 * un **message**, l'autre un **changement de réglage**. `LignePi` décrit un
 * message, et une vingtaine de lectures en dépendent — lui ajouter une variante
 * pour un événement ferait payer à tout le monde ce qui ne concerne qu'un seul
 * producteur.
 *
 * ⚠️ **Pourquoi codex a besoin de ça, et pas les autres.** Mesure du
 * 2026-10-16 : pi, opencode, devin et claude écrivent le modèle **sur chaque
 * message** ; codex, lui, le met dans des événements — `turn_context` (32 fois
 * dans une session réelle) et `thread_settings_applied` (30 fois). Sans cette
 * traduction, un agent codex n'annonce jamais son modèle.
 *
 * Ce qui compte, c'est que la ligne produite soit **du pi** : `reglagesOf` la
 * lit sans rien savoir de codex. Un second décodeur plus loin aurait dupliqué
 * chaque décision de format.
 */
export const reglageCodexVersPi = (parsed: unknown): ChangePi | undefined => {
  if (!estObjet(parsed)) return undefined;
  const payload = parsed["payload"];
  if (!estObjet(payload)) return undefined;
  const type = parsed["type"];

  /*
    Le modèle de contexte : un par tour, et il porte le modèle **utilisé**.

    ⚠️ Mesure : ce payload a `model` et `effort`, mais **pas** de
    `model_provider_id` — le fournisseur est lu sur l'autre forme, plus bas. On
    ne le devine donc pas ici.
  */
  if (type === "turn_context") {
    const modelId = modeleUtilisable(payload["model"]);
    if (modelId === undefined) return undefined;
    const effort = texteDe(payload["effort"]);
    return {
      ...(effort === undefined ? {} : { thinkingLevel: effort }),
      modelId,
      type: "model_change",
    };
  }

  // Les réglages appliqués au fil : même information, autre forme.
  if (type === "event_msg" && payload["type"] === "thread_settings_applied") {
    const reglages = payload["thread_settings"];
    if (!estObjet(reglages)) return undefined;
    const modelId = modeleUtilisable(reglages["model"]);
    if (modelId === undefined) return undefined;
    const provider = texteDe(reglages["model_provider_id"]);
    const effort = texteDe(reglages["reasoning_effort"]);
    return {
      ...(provider === undefined ? {} : { provider }),
      ...(effort === undefined ? {} : { thinkingLevel: effort }),
      modelId,
      type: "model_change",
    };
  }

  return undefined;
};
