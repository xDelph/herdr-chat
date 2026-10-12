/**
 * Un appel d'outil raconté en une ligne (U21).
 *
 * ⚠️ **Pourquoi un module à part.** Le rendu d'une session réelle alternait des
 * blocs encadrés — un cadre par commande, un par édition, un par réflexion. Sur
 * des centaines d'appels, les réponses de l'agent disparaissent dans le bruit.
 * Une ligne compacte dit la même chose en tenant sur une ligne, comme le fait
 * Codex : « Ran command », « Edited backup.py ».
 *
 * Le vocabulaire est celui de l'utilisateur, pas celui du protocole : personne
 * ne cherche « toolCall ». Les noms techniques des outils restent, eux,
 * inchangés — on ne traduit pas un identifiant.
 */
import type { Block, RenderedMessage } from "./blocks.ts";

/** Ce qu'un appel devient à l'écran. */
export interface Action {
  /** Symbole affiché devant la ligne. */
  readonly icone: string;
  /** Verbe au participe, pour un résumé de groupe : « Fichiers modifiés ». */
  readonly pluriel: string;
  /** Verbe au singulier : « Fichier modifié ». */
  readonly singulier: string;
  /** Ce sur quoi il porte : un chemin, une requête, rien. */
  readonly cible: string | null;
  /**
   * `true` quand la cible est un **chemin de fichier**.
   *
   * C'est ce qui permet d'en faire un lien vers le diff : souligner un argument
   * qui n'est pas un fichier promettrait une ouverture qui n'existe pas.
   */
  readonly estFichier: boolean;
  /**
   * Lignes ajoutées et retirées, pour une écriture ou une édition.
   *
   * ⚠️ `null` quand l'appel n'écrit rien : afficher `+0 −0` sur une commande
   * laisserait croire à un changement mesuré alors qu'il n'y en a pas.
   */
  readonly delta: Delta | null;
}

/** Taille d'un changement, en lignes. */
export interface Delta {
  readonly added: number;
  readonly removed: number;
}

/**
 * Compte les lignes d'un changement.
 *
 * ⚠️ **Même règle que `touchedFilesOf` et la feuille Fichiers** : une écriture
 * ajoute tout son contenu, une édition ajoute `newText` et retire `oldText`. Deux
 * comptages différents donneraient deux chiffres pour le même fichier.
 */
/** Nombre de lignes d'un texte, ou 0 quand il n'y en a pas. */
const lignesDeTexte = (valeur: unknown): number =>
  typeof valeur === "string" && valeur.length > 0 ? valeur.split("\n").length : 0;

/** Objet exploitable par clé, sans supposer sa forme. */
const estObjet = (valeur: unknown): valeur is Record<string, unknown> =>
  typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);

export const deltaDe = (nom: string, args: Readonly<Record<string, unknown>>): Delta | null => {
  const minuscule = nom.trim().toLowerCase();

  if (minuscule === "write") {
    const contenu = args["content"];
    if (typeof contenu !== "string") return null;
    return { added: lignesDeTexte(contenu), removed: 0 };
  }
  if (minuscule !== "edit") return null;

  const edites = args["edits"];
  if (!Array.isArray(edites)) return null;
  let added = 0;
  let removed = 0;
  for (const edition of edites) {
    if (!estObjet(edition)) continue;
    added += lignesDeTexte(edition["newText"]);
    removed += lignesDeTexte(edition["oldText"]);
  }
  return added === 0 && removed === 0 ? null : { added, removed };
};

/** Familles d'actions, dans l'ordre d'apparition du résumé. */
type Famille = "edition" | "suppression" | "shell" | "lecture" | "recherche" | "autre";

const FAMILLES: Record<
  string,
  { famille: Famille; icone: string; singulier: string; pluriel: string }
> = {
  bash: {
    famille: "shell",
    icone: "🖥",
    pluriel: "Commandes lancées",
    singulier: "Commande lancée",
  },
  shell: {
    famille: "shell",
    icone: "🖥",
    pluriel: "Commandes lancées",
    singulier: "Commande lancée",
  },
  edit: {
    famille: "edition",
    icone: "✎",
    pluriel: "Fichiers modifiés",
    singulier: "Fichier modifié",
  },
  write: { famille: "edition", icone: "✎", pluriel: "Fichiers créés", singulier: "Fichier créé" },
  read: { famille: "lecture", icone: "▤", pluriel: "Fichiers lus", singulier: "Fichier lu" },
  grep: { famille: "recherche", icone: "⌕", pluriel: "Recherches", singulier: "Recherche" },
  glob: { famille: "recherche", icone: "⌕", pluriel: "Recherches", singulier: "Recherche" },
  webfetch: { famille: "recherche", icone: "⊕", pluriel: "Pages lues", singulier: "Page lue" },
  websearch: {
    famille: "recherche",
    icone: "⌕",
    pluriel: "Recherches web",
    singulier: "Recherche web",
  },
};

/** Ordre du résumé : les écritures d'abord, c'est ce qu'on vérifie. */
const ORDRE: ReadonlyArray<Famille> = [
  "edition",
  "suppression",
  "shell",
  "lecture",
  "recherche",
  "autre",
];

const NOMS_SUPPRESSION = new Set(["rm", "delete", "unlink", "remove_file"]);

/** Lit une clé d'arguments sans supposer sa forme. */
const chaine = (args: Readonly<Record<string, unknown>>, cle: string): string | null => {
  const valeur = args[cle];
  return typeof valeur === "string" && valeur.trim().length > 0 ? valeur.trim() : null;
};

/**
 * Décrit un appel.
 *
 * ⚠️ La cible d'une commande est **tronquée à sa première ligne** : une
 * commande shell peut contenir un script entier, et l'afficher en entier
 * défait la ligne compacte.
 */
export const actionDe = (nom: string, args: Readonly<Record<string, unknown>>): Action => {
  const minuscule = nom.trim().toLowerCase();

  if (NOMS_SUPPRESSION.has(minuscule)) {
    return {
      cible: chaine(args, "path") ?? chaine(args, "file"),
      delta: null,
      estFichier: true,
      icone: "✕",
      pluriel: "Fichiers supprimés",
      singulier: "Fichier supprimé",
    };
  }

  const connu = FAMILLES[minuscule];
  const chemin = chaine(args, "path") ?? chaine(args, "file");
  // Une commande se reconnaît à sa première ligne ; une recherche à son motif.
  const cible =
    connu?.famille === "shell" ? (chaine(args, "command")?.split("\n")[0] ?? null) : chemin;

  if (connu === undefined) {
    return {
      cible: cible ?? chaine(args, "query"),
      delta: null,
      estFichier: false,
      icone: "•",
      pluriel: "Actions",
      singulier: "Action",
    };
  }

  return {
    cible: cible ?? chaine(args, "query"),
    delta: deltaDe(minuscule, args),
    estFichier: connu.famille === "edition" || connu.famille === "lecture",
    icone: connu.icone,
    pluriel: connu.pluriel,
    singulier: connu.singulier,
  };
};

/**
 * Résumé d'un groupe : les familles rencontrées, dans l'ordre de lecture.
 *
 * « Fichiers modifiés, commandes lancées » et non « 7 appels » : un compte ne
 * dit pas **ce qui a été fait**, et c'est la seule question qu'on se pose
 * devant un groupe replié.
 */
export const resumeDuGroupe = (noms: ReadonlyArray<string>): string => {
  const familles = new Set<Famille>();
  for (const nom of noms) {
    const minuscule = nom.trim().toLowerCase();
    familles.add(
      NOMS_SUPPRESSION.has(minuscule) ? "suppression" : (FAMILLES[minuscule]?.famille ?? "autre"),
    );
  }
  return (
    ORDRE.filter((famille) => familles.has(famille))
      .map((famille) => {
        if (famille === "suppression") return "Fichiers supprimés";
        const modele = Object.values(FAMILLES).find((entree) => entree.famille === famille);
        return modele?.pluriel ?? "Actions";
      })
      // ⚠️ **Seul le premier garde sa majuscule.** « Fichiers modifiés, Commandes
      // lancées » se lit comme trois phrases ; c'est une énumération, et le
      // français n'y met pas de capitale après la virgule.
      .map((fragment, index) => (index === 0 ? fragment : fragment.toLowerCase()))
      .join(", ")
  );
};

/**
 * Nombre de jetons, en forme courte.
 *
 * ⚠️ `65000` ne se lit pas au doigt, et prend la place de trois mots. `65k` se
 * lit d'un regard. Sous 10 000 on garde une décimale — `1,5k` et `2k` ne
 * disent pas la même chose quand on compare deux travaux.
 */
export const jetonsCourts = (nombre: number): string => {
  if (!Number.isFinite(nombre) || nombre <= 0) return "";
  if (nombre < 1000) return String(Math.round(nombre));
  const milliers = nombre / 1000;
  if (milliers < 10) return `${milliers.toFixed(1).replace(".", ",")}k`;
  return `${String(Math.round(milliers))}k`;
};

/**
 * Durée d'un travail, en mots.
 *
 * ⚠️ **Plancher, jamais d'arrondi vers le haut** : une durée exagérée est
 * exactement ce que l'utilisateur compare avec son souvenir. Et les secondes
 * disparaissent au-delà d'une heure : « 1 h 4 min » se lit, « 1 h 4 min 12 s »
 * se déchiffre.
 */
export const dureeEnMots = (millisecondes: number): string => {
  if (!Number.isFinite(millisecondes) || millisecondes <= 0) return "";
  const secondes = Math.floor(millisecondes / 1000);
  if (secondes < 60) return `${String(secondes)} s`;
  const minutes = Math.floor(secondes / 60);
  const resteSecondes = secondes % 60;
  if (minutes < 60) {
    return resteSecondes === 0
      ? `${String(minutes)} min`
      : `${String(minutes)} min ${String(resteSecondes)} s`;
  }
  const heures = Math.floor(minutes / 60);
  const resteMinutes = minutes % 60;
  return resteMinutes === 0
    ? `${String(heures)} h`
    : `${String(heures)} h ${String(resteMinutes)} min`;
};

/** Instant d'un message, en millisecondes, ou `null` si illisible. */
const instant = (message: RenderedMessage): number | null => {
  if (message.at === null) return null;
  const valeur = Date.parse(message.at);
  return Number.isFinite(valeur) ? valeur : null;
};

/** Ce qu'un travail a coûté : sa durée, et ses jetons. */
export interface Cout {
  /** Durée mesurée entre le premier et le dernier message, ou `null`. */
  readonly dureeMs: number | null;
  /**
   * Jetons **du travail**, jamais le cumul de la session.
   *
   * ⚠️ Chaque message porte ses propres `usage.totalTokens` ; on les **somme
   * sur le groupe**. Le total de la session, lui, ne dit rien sur ce qu'on
   * vient de lire — et c'est pourtant ce qu'il affichait.
   */
  readonly jetons: number | null;
}

/** Coût d'un groupe : durée mesurée, jetons additionnés. */
export const coutDuGroupe = (messages: ReadonlyArray<RenderedMessage>): Cout => {
  let premier: number | null = null;
  let dernier: number | null = null;
  let jetons = 0;
  let avecJetons = false;

  for (const message of messages) {
    const at = instant(message);
    if (at !== null) {
      if (premier === null || at < premier) premier = at;
      if (dernier === null || at > dernier) dernier = at;
    }
    const brut = message.meta["tokens"];
    if (brut === undefined) continue;
    const valeur = Number.parseInt(brut, 10);
    if (Number.isFinite(valeur) && valeur > 0) {
      jetons += valeur;
      avecJetons = true;
    }
  }

  // Un groupe d'un seul message n'a pas de durée : on ne prétend pas mesurer un
  // intervalle qui n'existe pas.
  const dureeMs =
    premier !== null && dernier !== null && dernier > premier ? dernier - premier : null;
  return { dureeMs, jetons: avecJetons ? jetons : null };
};

/** Une ligne du travail : un appel, et ce qu'il a produit. */
export interface LigneTravail {
  readonly action: Action;
  /**
   * Blocs montrés au dépliage : la sortie de l'appel, ou le texte de réflexion.
   *
   * ⚠️ La sortie est **rattachée à son appel**, pas affichée en ligne séparée :
   * une session réelle produit un appel et son résultat, et deux lignes par
   * appel doubleraient la longueur du groupe pour la même information.
   */
  readonly details: ReadonlyArray<Block>;
}

/** Action d'une ligne de réflexion — elle n'est pas un outil. */
const ACTION_REFLEXION: Action = {
  cible: null,
  delta: null,
  estFichier: false,
  icone: "✻",
  pluriel: "Réflexions",
  singulier: "Réflexion",
};

/**
 * Déroule un groupe en lignes de travail, appels et sorties **appariés**.
 *
 * L'ordre des blocs est celui de la session : c'est lui qui dit quel résultat
 * appartient à quel appel. On apparie donc dans l'ordre, sans chercher par
 * identifiant — les appels sans identifiant existent.
 */
export const lignesDeTravail = (
  messages: ReadonlyArray<RenderedMessage>,
): ReadonlyArray<LigneTravail> => {
  const lignes: Array<{ action: Action; details: Array<Block> }> = [];

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === "toolCall") {
        // ⚠️ L'appel **est** son propre détail : le diff d'une édition vit dans
        // ses arguments, pas dans son résultat. Sans lui, « Fichier modifié »
        // n'avait rien à déplier.
        lignes.push({ action: actionDe(block.name, block.arguments), details: [block] });
        continue;
      }
      if (block.kind === "bashExecution") {
        lignes.push({
          action: {
            cible: block.command.split("\n")[0] ?? null,
            delta: null,
            estFichier: false,
            icone: "🖥",
            pluriel: "Commandes lancées",
            singulier: "Commande lancée",
          },
          details: [block],
        });
        continue;
      }
      if (block.kind === "thinking") {
        lignes.push({ action: ACTION_REFLEXION, details: [block] });
        continue;
      }
      if (block.kind === "toolResult") {
        // Le résultat se rattache à l'appel qui le précède. Sans appel avant
        // lui, il devient sa propre ligne : ne rien afficher perdrait la
        // sortie.
        const derniere = lignes.at(-1);
        if (derniere !== undefined && derniere.action.icone !== "✻") {
          derniere.details.push(block);
          continue;
        }
        lignes.push({
          action: {
            cible: block.toolName ?? null,
            delta: null,
            estFichier: false,
            icone: "▤",
            pluriel: "Résultats",
            singulier: "Résultat",
          },
          details: [block],
        });
      }
    }
  }

  return lignes;
};

/**
 * Action d'un bloc, quel qu'il soit.
 *
 * ⚠️ **Pourquoi cette fonction existe.** `BlockView` ne voyait les lignes
 * compactes que dans un groupe — c'est-à-dire quand **tous** les blocs d'un
 * message étaient des appels d'outil. Or la forme la plus courante d'une
 * session réelle est `text + thinking + toolCall` (565 messages sur 1080
 * mesurés) : ces messages n'étaient donc **jamais** groupés, et la réflexion
 * comme les éditions gardaient leur ancien bloc encadré.
 *
 * Une ligne compacte doit se décider **par bloc**, pas par message.
 */
export const actionDeBloc = (block: Block): Action => {
  switch (block.kind) {
    case "thinking":
      return ACTION_REFLEXION;
    case "toolCall":
      return actionDe(block.name, block.arguments);
    case "bashExecution":
      return {
        cible: block.command.split("\n")[0] ?? null,
        delta: null,
        estFichier: false,
        icone: "🖥",
        pluriel: "Commandes lancées",
        singulier: "Commande lancée",
      };
    case "toolResult":
      return {
        cible: block.toolName.length > 0 ? block.toolName : null,
        delta: null,
        estFichier: false,
        icone: "▤",
        pluriel: "Résultats",
        singulier: "Résultat",
      };
    default:
      // Les blocs qui ne sont pas du travail — texte, image, compaction — ne
      // passent pas par une ligne : ils ont leur propre rendu.
      return {
        cible: null,
        delta: null,
        estFichier: false,
        icone: "•",
        pluriel: "Actions",
        singulier: "Action",
      };
  }
};

/** `true` quand un bloc se raconte en une ligne de travail. */
export const estBlocDeTravail = (block: Block): boolean =>
  block.kind === "thinking" ||
  block.kind === "toolCall" ||
  block.kind === "toolResult" ||
  block.kind === "bashExecution";
