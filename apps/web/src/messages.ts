/**
 * Extraction des messages d'une session, pour l'affichage.
 *
 * **Ce module existe à cause d'un bug réel.** La logique vivait dans le
 * composant : elle passait `entry.raw` — une **chaîne JSON** — directement au
 * schéma de décodage, qui attend un **objet**. Le décodage échouait donc
 * silencieusement sur *chaque* message, et la conversation apparaissait **vide**
 * alors que l'API renvoyait bien 31 messages affichables.
 *
 * Le défaut était invisible : un décodage qui renvoie `None` ne lève rien.
 * Isolé ici, il est **testable** — c'est tout l'objet de ce fichier.
 */
import { Option, Schema } from "effect";

/** Forme reconnue d'une ligne de session. Les autres champs sont ignorés. */
export const SessionLine = Schema.Struct({
  message: Schema.optional(
    Schema.Struct({
      content: Schema.optional(Schema.Unknown),
      role: Schema.optional(Schema.String),
    }),
  ),
  type: Schema.optional(Schema.String),
});

const decodeSessionLine = Schema.decodeUnknownOption(SessionLine);

/** Bloc de contenu textuel (`{ type: "text", text: "…" }`). */
const TextBlock = Schema.Struct({ text: Schema.String });
const decodeTextBlock = Schema.decodeUnknownOption(TextBlock);

/** Un message prêt à afficher. */
export interface Bubble {
  readonly id: string;
  readonly role: string;
  readonly text: string;
}

/**
 * Convertit un contenu en texte.
 *
 * Un contenu est soit une chaîne (messages `user`), soit un tableau de blocs
 * (messages `assistant`, résultats d'outil). Les blocs sans `text` — réflexion,
 * appel d'outil — contribuent une chaîne vide : ils ne sont pas une erreur,
 * simplement rien à afficher.
 */
export const contentToText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => Option.getOrUndefined(decodeTextBlock(block))?.text ?? "").join("");
};

/**
 * Analyse **puis** décode une ligne brute.
 *
 * ⚠️ Les deux étapes sont indispensables. Passer la chaîne brute au schéma est
 * l'erreur qui rendait la conversation vide : le schéma attend un objet, reçoit
 * une chaîne, et renvoie `None` sans rien signaler.
 */
export const decodeRawLine = (raw: string): typeof SessionLine.Type | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Une ligne illisible est ignorée, jamais fatale : un historique contient
    // des types que l'interface ne connaît pas.
    return undefined;
  }
  return Option.getOrUndefined(decodeSessionLine(parsed));
};

/**
 * Transforme les entrées d'une session en messages affichables.
 *
 * Seules les entrées `message` avec du texte non vide produisent une bulle. Un
 * message vide n'est pas affiché plutôt que de produire un bloc blanc.
 */
export const toBubbles = (
  entries: ReadonlyArray<{
    readonly id?: string | undefined;
    readonly raw: string;
    readonly type: string;
  }>,
): ReadonlyArray<Bubble> =>
  entries.flatMap((entry) => {
    if (entry.type !== "message") return [];
    const line = decodeRawLine(entry.raw);
    if (line === undefined) return [];
    const text = contentToText(line.message?.content);
    if (text.trim().length === 0) return [];
    return [
      {
        // Un identifiant stable évite de recréer les nœuds à chaque rendu.
        id: entry.id ?? `${entry.type}:${line.message?.role ?? "?"}:${text.slice(0, 32)}`,
        role: line.message?.role ?? "?",
        text,
      },
    ];
  });
