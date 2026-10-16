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
 * Ce que Claude Code écrit **en rôle `user`** sans que l'utilisateur ait rien
 * demandé.
 *
 * ⚠️ **Mesuré, jamais deviné.** Relevé du 2026-10-16 sur 132 sessions réelles :
 * 320 lignes `user` portant du texte (hors `tool_result`), dont **50 — 15 % ** —
 * ne sont pas des demandes. Sans ce filtre, la ligne de la liste annonçait
 * `[Request interrupted by user]` comme « la dernière demande de l'utilisateur ».
 *
 * | occurrences | préfixe | ce que c'est |
 * |---|---|---|
 * | 12 | `[Request interrupted` | l'utilisateur a coupé — une interruption, pas une demande |
 * | 10 | `<local-command-caveat>` | une consigne du harnais sur les commandes locales |
 * | 10 | `<local-command-stdout>` | la **sortie** d'une commande — jamais une demande |
 * | 5 | `This session is being continued` | le résumé d'une compaction |
 * | 3 | `<task-notification>` | une notification du harnais |
 * | — | `<system-reminder>` | le contexte injecté (aussi via `api-request-blob`) |
 *
 * La reconnaissance se fait **au début** du texte : un utilisateur qui *parle*
 * de ces marques n'est pas effacé, pas plus qu'il ne l'est chez codex.
 */
const MARQUES_APPLICATION: ReadonlyArray<string> = [
  "<system-reminder>",
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<task-notification>",
  "[Request interrupted",
  "This session is being continued",
];

const estMarqueSansDemande = (texte: string): boolean => {
  const debut = texte.trimStart();
  return MARQUES_APPLICATION.some((marque) => debut.startsWith(marque));
};

/**
 * Une commande à barre oblique : Claude Code remplace ce que l'utilisateur a tapé
 * par un bloc XML (10 occurrences mesurées, toutes des commandes locales).
 *
 * ⚠️ On ne refuse **pas** cette ligne, à la différence des marques ci-dessus :
 * l'utilisateur a bel et bien agi. On rend seulement le texte utile — la commande
 * et ses arguments — plutôt que les balises qui l'enveloppent.
 */
const BALISE_COMMANDE = /<command-name>([\s\S]*?)<\/command-name>/;
const BALISE_ARGUMENTS = /<command-args>([\s\S]*?)<\/command-args>/;

/**
 * Le texte d'une ligne `user`, s'il porte une demande ; `undefined` sinon.
 *
 * C'est le point unique du filtre : chaîne nue comme blocs passent par ici.
 */
const texteDeDemande = (texte: string): string | undefined => {
  const debut = texte.trimStart();
  if (estMarqueSansDemande(debut)) return undefined;

  const nom = BALISE_COMMANDE.exec(debut)?.[1]?.trim();
  if (nom === undefined) return texte;
  if (nom.length === 0) return undefined;
  const args = BALISE_ARGUMENTS.exec(debut)?.[1]?.trim() ?? "";
  return args.length > 0 ? `${nom} ${args}` : nom;
};

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
 * Une ligne qui **prétend** porter la conversation — et que l'adaptateur refuse.
 *
 * ⚠️ **Pourquoi cette fonction existe.** Une ligne claude refusée était conservée
 * **telle quelle** par le lecteur — la règle générale, « une ligne illisible est
 * gardée brute plutôt que perdue ». Sauf que sa forme est celle de pi : elle
 * porte `message.role`. Tout ce qui lit le rôle relisait donc ce que l'adaptateur
 * venait d'écarter, et l'aperçu de la liste annonçait
 * `[Request interrupted by user]` comme « la dernière demande de l'utilisateur »,
 * **alors que le filtre fonctionnait parfaitement**.
 *
 * Chez codex, le même refus ne fuit pas : sa forme brute (`event_msg.payload`)
 * n'a pas de `message.role`. Le piège est propre à claude, dont la forme
 * ressemble trop à celle de pi — un adaptateur juste ne suffit pas quand la
 * source parle la même langue que la cible.
 */
export const estLigneDeConversationClaude = (parsed: unknown): boolean => {
  if (!estObjet(parsed)) return false;
  const type = parsed["type"];
  return type === "user" || type === "assistant";
};

/**
 * La ligne, privée de son message — tout le reste est conservé.
 *
 * C'est ce qu'on stocke pour une ligne de conversation refusée. Ses autres
 * champs (horodatage, identité, type) survivent ; plus rien ne peut la relire
 * comme un message.
 */
export const sansMessage = (parsed: Record<string, unknown>): Record<string, unknown> => {
  const copie = { ...parsed };
  delete copie["message"];
  return copie;
};

/**
 * Traduit une ligne de session Claude Code en ligne de forme pi.
 *
 * Renvoie `undefined` quand la ligne n'est pas de la conversation — auquel cas
 * l'appelant garde la ligne brute, comme pour tout type inconnu. ⚠️ **Un appelant
 * doit alors employer `estLigneDeConversationClaude` et `sansMessage`** : sans
 * cela, une ligne refusée reste lisible et réinjecte ce qu'on vient d'écarter.
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
    const demande = texteDeDemande(contenu);
    if (demande === undefined || demande.trim().length === 0) return undefined;
    return enveloppe({ content: [{ text: demande, type: "text" }], role: "user" });
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

  const brut = blocs
    .filter((bloc) => bloc["type"] === "text")
    .map((bloc) => (typeof bloc["text"] === "string" ? bloc["text"] : ""));
  const appels = blocs.filter((bloc) => bloc["type"] === "tool_use").map(blocAppel);

  if (type === "user") {
    // Tous les blocs étaient des marques de l'application : ce n'est pas une demande.
    const demandes = brut
      .map((texte) => texteDeDemande(texte))
      .filter((texte): texte is string => texte !== undefined && texte.trim().length > 0);
    if (demandes.length === 0) return undefined;
    return enveloppe({
      content: demandes.map((text) => ({ text, type: "text" })),
      role: "user",
    });
  }

  const textes = brut.filter((texte) => texte.length > 0 && !estMarqueSansDemande(texte));

  const sortie: Array<unknown> = [...textes.map((text) => ({ text, type: "text" })), ...appels];
  // Un message sans bloc n'est pas un message : on ne fabrique pas de bulle vide.
  if (sortie.length === 0) return undefined;
  return enveloppe({ content: sortie, role: "assistant" });
};
