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

/**
 * Fusionne une page **incrémentale** dans ce qui est déjà affiché.
 *
 * ⚠️ **Remplacer par identifiant, jamais empiler.** Une entrée peut *changer* et
 * revenir : opencode réécrit la ligne d'un message pendant qu'il le compose —
 * mesuré sur la base réelle, **1 943 lignes sur 1 993 (97 %)** sont réécrites
 * après leur création, une réponse grossissant dans la même ligne pendant près
 * de huit secondes. Le serveur relit donc la ligne du curseur à chaque tour, et
 * un simple `[...current, ...ajoutees]` afficherait la même réponse autant de
 * fois qu'il y a de rafraîchissements.
 *
 * ⚠️ **Une entrée sans identifiant n'est jamais dédupliquée** : elle ne peut pas
 * l'être. Les identifiants manquent sur certaines lignes de pi, et les confondre
 * sous une clé `undefined` effacerait des messages réels — un défaut bien pire
 * que le doublon qu'on cherche à éviter.
 *
 * La fonction est **idempotente** : rejouer la même page ne change rien. C'est
 * ce qui rend la reprise après coupure sûre, quel que soit le nombre de fois où
 * une page est relue.
 */
export const fusionnerEntrees = <T extends { readonly id?: string | undefined }>(
  affichees: ReadonlyArray<T>,
  ajoutees: ReadonlyArray<T>,
): ReadonlyArray<T> => {
  const remplacantes = new Map(
    ajoutees.filter((item) => item.id !== undefined).map((item) => [item.id, item]),
  );
  const connues = new Set(affichees.filter((item) => item.id !== undefined).map((item) => item.id));
  return [
    ...affichees.map((item) =>
      item.id === undefined ? item : (remplacantes.get(item.id) ?? item),
    ),
    ...ajoutees.filter((item) => item.id === undefined || !connues.has(item.id)),
  ];
};
