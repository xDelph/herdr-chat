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
import { globSync, existsSync } from "node:fs";
import { Option, Schema } from "effect";
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Dossier de configuration de codex.
 *
 * Surchargeable pour les tests, comme la racine des sessions.
 */
export const dossierCodex = (): string => process.env["CODEX_HOME"] ?? join(homedir(), ".codex");

/**
 * Les bases d'état de codex, de la plus récente à la plus ancienne.
 *
 * ⚠️ Le nom porte une **version** (`state_5.sqlite`) : coder ce numéro en dur
 * ferait taire l'index le jour où codex le change, sans que rien ne le dise. On
 * prend le plus haut trouvé, et une base absente ne rend simplement rien.
 */
const basesCodex = (): ReadonlyArray<string> => {
  const dossier = dossierCodex();
  return globSync("state_*.sqlite", { cwd: dossier })
    .toSorted()
    .toReversed()
    .map((nom) => join(dossier, nom));
};

/**
 * Nom de la session codex, lu dans le titre de son pane.
 *
 * ⚠️ **Mesuré, pas supposé.** codex met `<nom du fil> | <dossier>` en titre ;
 * relevé sur `wB:p1B` :
 *
 * ```
 * terminal_title = "Audit PWA and webapp | herdr-pwa"
 * ```
 *
 * et c'est **exactement** la valeur que l'index de codex porte pour la session
 * `01a14a74-…`. Le dossier doit être celui du pane : sans cette vérification, un
 * titre qui contiendrait ` | ` pour une autre raison serait pris pour un nom. Un
 * titre qui n'est que le dossier (« perso », un pane jamais utilisé) ne dit rien
 * — et c'est correct, il n'y a alors aucune session à retrouver.
 *
 * ⚠️ **Le titre porte un GLYPHE D'ÉTAT quand codex travaille.** Mesuré le
 * 2026-10-18, sur le même pane :
 *
 * ```
 * au repos : "Audit PWA and webapp | herdr-pwa"
 * en travail : "⠼ Audit PWA and webapp | herdr-pwa"
 * ```
 *
 * Le `⠼` est un braille de spinner. Sans le retirer, le nom lu valait
 * « ⠼ Audit PWA and webapp » : l'index ne le connaît pas, donc **aucune session**
 * — et la conversation disparaissait precisement **pendant** le travail, quand on
 * la regarde. On rend donc les **deux lectures**, et c'est l'index qui tranche.
 */
export const nomsDeSessionCodex = (
  titre: string | null,
  cwd: string | null,
): ReadonlyArray<string> => {
  if (titre === null || cwd === null || cwd.length === 0) return [];
  const barre = titre.lastIndexOf(" | ");
  if (barre <= 0) return [];
  const prefixe = titre.slice(0, barre).trim();
  if (prefixe.length === 0) return [];
  const dossier = titre.slice(barre + 3).trim();
  if (dossier !== cwd.replace(/\/+$/, "").split("/").at(-1)) return [];

  /*
    ⚠️ **Deux lectures, pas une correction.** On ne « nettoie » pas le titre en
    esperant tomber juste : on propose la lecture brute **et** la lecture sans
    decoration, et l'index de codex decide. Un nom qui commence vraiment par un
    glyphe reste donc trouvable, et un faux nettoyage ne peut pas produire une
    session : il produit un nom que l'index ignore.
  */
  const sansDecoration = prefixe.replace(/^[^\p{L}\p{N}]+\s+/u, "").trim();
  return sansDecoration.length > 0 && sansDecoration !== prefixe
    ? [prefixe, sansDecoration]
    : [prefixe];
};

/**
 * Le nom de session codex, quand il n'y en a qu'un de plausible.
 *
 * ⚠️ Rend le **premier** candidat : c'est la lecture brute, celle qui ne suppose
 * rien. `sessionCodexParTitre` les essaie tous les deux contre l'index.
 */
export const nomDeSessionCodex = (titre: string | null, cwd: string | null): string | undefined =>
  nomsDeSessionCodex(titre, cwd)[0];

/**
 * Une ligne de l'index de codex, réduite à ce qu'on lui demande.
 *
 * ⚠️ **Décodée, jamais affirmée par un `as`.** Une ligne SQLite arrive en
 * `unknown` : la forcer en objet serait une promesse sur une forme qu'on n'a pas
 * vérifiée. Le schéma, lui, échoue proprement — et on préfère « pas de session »
 * à « session d'un autre ».
 */
const LigneIndex = Schema.Struct({ rollout_path: Schema.optional(Schema.String) });
const decodeLigneIndex = Schema.decodeUnknownOption(LigneIndex);

/**
 * Chemin du fichier de session codex, retrouvé par le **nom du fil** et le
 * dossier, dans l'index de codex.
 *
 * ⚠️ **Pourquoi cette fonction existe alors que `cheminCodexParId` suffisait.**
 * Le 2026-10-17, Herdr a cessé de publier `agent_session` pour codex : son propre
 * journal porte, au moment exact où la session naît,
 *
 * ```
 * api request completed outcome=error method="pane.report_agent_session"
 * ```
 *
 * La session existait pourtant. codex tient son propre index
 * (`threads (id, name, cwd, rollout_path, archived)`), écrit par lui : c'est une
 * **preuve**, pas une déduction. Deux garde-fous rendent la preuve vérifiable :
 * le nom **et** le dossier doivent correspondre, et le fichier doit exister.
 * Sans les trois, on renvoie `undefined` — jamais la session d'un autre.
 */
export const cheminCodexParNom = (nom: string, cwd: string): string | undefined => {
  if (nom.trim().length === 0 || cwd.length === 0) return undefined;
  for (const base of basesCodex()) {
    try {
      const db = new Database(base, { readonly: true });
      try {
        const brute = db
          .query(
            "select rollout_path from threads where name = ? and cwd = ? and archived = 0 order by updated_at desc limit 1",
          )
          .get(nom, cwd);
        const chemin = Option.getOrUndefined(decodeLigneIndex(brute))?.rollout_path;
        if (chemin !== undefined && existsSync(chemin)) return chemin;
      } finally {
        db.close();
      }
    } catch {
      // Une base illisible, absente, ou d'un schéma inattendu ne **prouve** rien :
      // on essaie la suivante, puis on renonce. Jamais de substitution.
    }
  }
  return undefined;
};

/**
 * Emplacement de session d'un pane codex, déduit de son **titre**.
 *
 * Rend `undefined` dès que le titre ne nomme pas un fil, ou que l'index ne le
 * confirme pas : le pane garde alors son panneau neutre, ce qui est exact.
 */
export const sessionCodexParTitre = (
  titre: string | null,
  cwd: string | null,
): SessionSlot | undefined => {
  if (cwd === null) return undefined;
  /*
    ⚠️ **On essaie chaque lecture contre l'index, et c'est lui qui tranche.**
    Le titre peut porter une decoration (le spinner `⠼` du travail en cours) ;
    plutot que de nettoyer au jugé, on demande à l'index de codex laquelle de ces
    lectures **existe**. La premiere confirmee gagne, et aucune autre n'est
    inventee.
  */
  for (const nom of nomsDeSessionCodex(titre, cwd)) {
    const chemin = cheminCodexParNom(nom, cwd);
    if (chemin !== undefined) return { kind: "path", value: chemin };
  }
  return undefined;
};

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

/** Type d'agent claude. */
const KIND_CLAUDE = "claude";

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
 * Racine des sessions Claude Code.
 *
 * ⚠️ **Un fichier, comme codex — et c'est la fin de la serie.** Le produit
 * classait claude « non concluant » : la sonde etait tombee sur un ecran de
 * connexion, et personne n'etait alle regarder le disque. Sa session est un
 * JSONL : `~/.claude/projects/<dossier>/<uuid>.jsonl`.
 */
export const RACINE_CLAUDE = (): string =>
  process.env["CLAUDE_PROJECTS_ROOT"] ?? join(homedir(), ".claude", "projects");

/**
 * Resout un identifiant claude en chemin de fichier.
 *
 * ⚠️ Comme codex : l'identifiant est cherche dans le **nom** du fichier. Le
 * dossier intermediaire est le chemin de travail encode, qui ne se deduit pas
 * d'un identifiant — c'est pourquoi on cherche, on ne compose pas.
 */
export const cheminClaudeParId = (id: string): string | undefined => {
  if (id.trim().length === 0) return undefined;
  const racine = RACINE_CLAUDE();
  const trouves = globSync(`**/${id}.jsonl`, { cwd: racine });
  const premier = trouves.toSorted()[0];
  return premier === undefined ? undefined : join(racine, premier);
};

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
 * Emplacement de session d'un agent — **le seul point de décision**.
 *
 * Il empile deux questions, dans cet ordre :
 *
 * 1. Herdr a-t-il publié un emplacement ? Si oui, il fait **foi**.
 * 2. Sinon, et seulement pour codex, son **titre** nomme-t-il un fil que son
 *    index confirme ? (voir `sessionCodexParTitre`).
 *
 * ⚠️ **Pourquoi la décision vit ici et pas chez les appelants.** Le registre et
 * les deux routes doivent répondre la même chose ; deux expressions de cette
 * règle divergeraient — le défaut s'est déjà produit (D013). Le repli vit donc
 * au même endroit que la résolution, et les appelants ne font que le lire.
 */
export const sourceSessionDe = (
  kind: string | null,
  slot: SessionSlot | null,
  titre: string | null,
  cwd: string | null,
): SourceSession | undefined => {
  const annonce = sourceSession(kind, slot);
  if (annonce !== undefined) return annonce;
  if (kind !== KIND_CODEX) return undefined;
  const repli = sessionCodexParTitre(titre, cwd);
  return repli === undefined ? undefined : sourceSession(kind, repli);
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
  if (agentKind === KIND_CLAUDE) {
    // Un fichier, comme pi et codex : le lecteur existant s'en charge.
    const chemin = cheminClaudeParId(slot.value);
    return chemin === undefined ? undefined : { base: chemin, kind: "fichier" };
  }
  if (agentKind === KIND_DEVIN) {
    // Même garde, même raison.
    if (slot.value.trim().length === 0) return undefined;
    return { base: baseDevin(), kind: "sqlite", magasin: "devin", sessionId: slot.value };
  }
  return undefined;
};
