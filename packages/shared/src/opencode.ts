/**
 * Adaptateur opencode → forme pi.
 *
 * ⚠️ **Pourquoi un adaptateur, alors qu'opencode n'est pas un fichier.** opencode
 * écrit ses sessions dans une **base SQLite** (`~/.local/share/opencode/opencode.db`),
 * pas dans un JSONL. La conclusion précédente du produit — « sa session est dans
 * une base, donc illisible » — confondait deux choses : *il n'y a pas de chemin*
 * et *il n'y a pas de session*. C'est **exactement la même erreur** que celle
 * commise avec codex (« pas de chemin » lu comme « pas de session »), et elle a
 * été corrigée de la même façon : en mesurant plutôt qu'en supposant.
 *
 * Mesuré sur opencode 2.0.23, 2026-10-16 :
 *
 * ```sql
 * SELECT type, seq, time_created, data FROM session_message WHERE session_id = ?
 * ```
 *
 * 1 931 lignes sur 7 sessions, et l'identifiant de session est **exactement**
 * celui qu'Herdr expose (`ses_ef41fb118ffeUmFo0RN74rXEyi`) : c'est la clé
 * primaire de `session_v2`. Il n'y a donc rien à déduire, là où codex demandait
 * de retrouver un nom de fichier.
 *
 * Types rencontrés : `assistant` (1 831), `user` (48), `idle` (44),
 * `model-switched` (3), `system` (2), `synthetic` (2), `compaction` (1).
 *
 * ⚠️ **Ce que cet adaptateur refuse, et pourquoi c'est délibéré.** Les types
 * `idle`, `system`, `synthetic` et `compaction` ne sont **pas** traduits ici :
 *
 * - `idle` (`{outcome}`) n'est pas un message : c'est la fin d'un tour, et le
 *   produit lit déjà cette frontière du côté d'Herdr ;
 * - `system` est de la configuration (`metadata.notice: "instructions"`), pas de
 *   la conversation — le traduire remplirait le fil de consignes, le défaut
 *   exact que l'adaptateur codex a dû corriger pour `developer` ;
 * - `synthetic` transporte un résultat de shell, mais **deux occurrences** ont
 *   été observées et la commande n'y est pas un champ : elle est encodée dans
 *   une balise `<shell id="…" command="…">`. La reconstituer serait une
 *   déduction ;
 * - `compaction` n'a **pas** la forme de pi (`firstKeptEntryId`, `tokensBefore`
 *   n'existent pas côté opencode).
 *
 * Un refus explicite coûte deux lignes d'historique sur 1 931. Une traduction
 * inventée coûterait la confiance dans tout le reste.
 */
import { estObjet, horodatageIso, modeleUtilisable, tableauDe, texteDe } from "./pi.ts";
import type { LignePi } from "./pi.ts";

/**
 * Arguments d'un appel d'outil.
 *
 * opencode les met dans `state.input`, et `Block.arguments` exige un objet.
 * ⚠️ **Un argument qui ne serait pas un objet est conservé sous une clé**
 * plutôt que jeté : perdre la commande d'un appel serait pire qu'une forme
 * inattendue.
 */
const argumentsDe = (entree: unknown): Readonly<Record<string, unknown>> => {
  if (estObjet(entree)) return entree;
  if (entree === undefined || entree === null) return {};
  return { valeur: entree };
};

/**
 * Une image depuis une URI `data:` en base64.
 *
 * Mesuré : opencode range les images de résultat en
 * `{type:"file", uri:"data:image/png;base64,…"}`. Ce qui n'est pas un `data:`
 * base64 est refusé — pas d'image inventée, pas de chemin interprété.
 */
const imageDe = (part: Record<string, unknown>): { data: string; mimeType: string } | null => {
  const uri = part["uri"];
  if (typeof uri !== "string") return null;
  const trouve = /^data:([^;,]+);base64,(.+)$/s.exec(uri);
  if (trouve === null) return null;
  const mimeType = trouve[1];
  const data = trouve[2];
  if (mimeType === undefined || data === undefined || data.length === 0) return null;
  return { data, mimeType };
};

/**
 * Un appel d'outil opencode → **appel, puis résultat**.
 *
 * ⚠️ opencode met l'entrée **et** la sortie dans la **même** partie ; pi les
 * sépare. On émet donc deux blocs consécutifs dans le même message : le
 * regroupement (`lignesDeTravail`) rattache un résultat au **dernier appel
 * publié**, et cet appel est juste devant.
 *
 * ⚠️ **Aucun résultat vide n'est émis.** Un appel en cours (`status: "running"`)
 * n'a pas encore de sortie : fabriquer un bloc vide ferait afficher une ligne de
 * résultat sans résultat.
 */
const blocsDOutils = (part: Record<string, unknown>): ReadonlyArray<unknown> => {
  const id = typeof part["id"] === "string" ? part["id"] : "appel";
  const nom = texteDe(part["name"]) ?? "outil";
  const etat = estObjet(part["state"]) ? part["state"] : {};

  const textes: string[] = [];
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const sortie of tableauDe(part["content"])) {
    if (!estObjet(sortie)) continue;
    if (sortie["type"] === "text" && typeof sortie["text"] === "string")
      textes.push(sortie["text"]);
    if (sortie["type"] === "file") {
      const image = imageDe(sortie);
      if (image !== null) images.push(image);
    }
  }

  const blocs: unknown[] = [
    { arguments: argumentsDe(etat["input"]), id, name: nom, type: "toolCall" },
  ];
  const texte = textes.join("");
  if (texte.length > 0 || images.length > 0) {
    blocs.push({
      images,
      // `status: "error"` est le seul marqueur d'échec que la base porte :
      // l'inventer depuis un texte de sortie serait une déduction.
      isError: etat["status"] === "error",
      text: texte,
      toolName: nom,
      type: "toolResult",
    });
  }
  return blocs;
};

/** Une partie de contenu → zéro, un ou deux blocs pi. */
const blocsDePartie = (part: unknown): ReadonlyArray<unknown> => {
  if (!estObjet(part)) return [];
  switch (part["type"]) {
    case "text": {
      const texte = typeof part["text"] === "string" ? part["text"] : "";
      return texte.length === 0 ? [] : [{ text: texte, type: "text" }];
    }
    case "reasoning": {
      const texte = typeof part["text"] === "string" ? part["text"] : "";
      // La réflexion d'opencode est **en clair** ici, contrairement à codex qui
      // la chiffre : on la publie, et `redacted` reste `false`.
      return texte.length === 0 ? [] : [{ redacted: false, thinking: texte, type: "thinking" }];
    }
    case "tool":
      return blocsDOutils(part);
    case "file": {
      const image = imageDe(part);
      return image === null ? [] : [{ data: image.data, mimeType: image.mimeType, type: "image" }];
    }
    default:
      // Un type de partie inconnu est **écarté**, pas deviné : le fil garde le
      // reste, et rien ne s'affiche de travers.
      return [];
  }
};

/** `time.created`, en millisecondes Unix, quelle que soit la forme du parent. */
const debutDe = (data: Record<string, unknown>): unknown =>
  estObjet(data["time"]) ? data["time"]["created"] : undefined;

/** Le message utilisateur porte son texte à la racine, pas dans `content`. */
const utilisateur = (data: Record<string, unknown>): ReadonlyArray<unknown> => {
  const texte = texteDe(data["text"]);
  return texte === undefined ? [] : [{ text: texte, type: "text" }];
};

/**
 * Traduit une ligne de `session_message` en ligne de forme pi.
 *
 * Renvoie `undefined` quand la ligne n'est pas de la conversation — auquel cas
 * l'appelant la garde brute, comme pour tout type inconnu.
 *
 * ⚠️ L'identifiant est **fourni par l'appelant** (la clé de la ligne) et non
 * déduit : c'est lui qui rend un message stable d'une lecture à l'autre, donc
 * c'est lui qui évite un remontage de l'affichage à chaque rafraîchissement.
 */
export const ligneOpencodeVersPi = (
  type: string,
  data: unknown,
  id: string,
): LignePi | undefined => {
  if (!estObjet(data)) return undefined;
  const horodatage = horodatageIso(debutDe(data));

  /*
    Le modele, sur le message lui-meme.

    ⚠️ Mesure du 2026-10-16 : chaque message assistant porte
    `model = { id, providerID, variant }`, et la ligne `session_v2` le repete.

    ⚠️ **`variant` est bien le niveau de raisonnement, et ce n'est pas une
    deduction de ma part** : le bundle d'opencode declare la commande
    `{ name: "variants", aliases: ["thinking", "effort"] }` et la construit sur
    `supported_reasoning_levels[].effort`. Les valeurs mesurees sont `high`,
    `max` et `default`.

    ⚠️ **`default` est refuse** : c'est le nom qu'opencode donne a « aucun
    niveau choisi », present 52 fois dans la base. L'afficher ferait lire
    « niveau par defaut » la ou l'agent n'a rien declare.
  */
  const brut = estObjet(data["model"]) ? data["model"] : undefined;
  const modele = modeleUtilisable(brut?.["id"]);
  const fournisseur = modele === undefined ? undefined : texteDe(brut?.["providerID"]);
  const variante = texteDe(brut?.["variant"]);
  const niveau = variante === "default" ? undefined : variante;

  const enveloppe = (message: LignePi["message"]): LignePi => ({
    ...(horodatage === undefined ? {} : { timestamp: horodatage }),
    id: `opencode:${id}`,
    message: {
      ...message,
      ...(modele === undefined ? {} : { model: modele }),
      ...(fournisseur === undefined ? {} : { provider: fournisseur }),
      ...(niveau === undefined ? {} : { thinkingLevel: niveau }),
    },
    type: "message",
  });

  if (type === "user") {
    const contenu = utilisateur(data);
    if (contenu.length === 0) return undefined;
    return enveloppe({ content: contenu, role: "user" });
  }

  if (type === "assistant") {
    const blocs = tableauDe(data["content"]).flatMap((part) => blocsDePartie(part));
    // Comme pour pi : un message sans bloc n'est pas un message, on ne fabrique
    // pas de bulle vide.
    if (blocs.length === 0) return undefined;
    return enveloppe({ content: blocs, role: "assistant" });
  }

  return undefined;
};
