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
import { cheminDe, commandTextOf, editionsDe, patchFilesOf } from "./blocks.ts";

/**
 * Les pictogrammes d'action — des **clés**, pas des glyphes.
 *
 * ⚠️ Les glyphes texte (`🖥`, `✎`, `▤`) se rendaient différemment selon la
 * police et la plateforme, et un émoji en couleur criait plus fort que la
 * réponse. L'interface dessine chaque clé en SVG, au trait, dans la couleur du
 * texte.
 */
export type IconeAction =
  | "term"
  | "edit"
  | "file"
  | "find"
  | "web"
  | "brain"
  | "delete"
  | "result"
  | "dot";

/** Ce qu'un appel devient à l'écran. */
export interface Action {
  /** Pictogramme affiché devant la ligne. */
  readonly icone: IconeAction;
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

export const deltaDe = (nom: string, args: Readonly<Record<string, unknown>>): Delta | null => {
  const minuscule = nom.trim().toLowerCase();
  if (["exec", "exec_command", "apply_patch"].includes(minuscule)) {
    const command = commandTextOf(args);
    if (command === undefined) return null;
    const patches = patchFilesOf(command);
    if (patches.length === 0) return null;
    return patches.reduce(
      (total, patch) => {
        for (const edit of patch.edits) {
          if (edit.newText.length > 0) total.added += edit.newText.split("\n").length;
          if (edit.oldText.length > 0) total.removed += edit.oldText.split("\n").length;
        }
        return total;
      },
      { added: 0, removed: 0 },
    );
  }

  if (minuscule === "write") {
    const contenu = args["content"];
    if (typeof contenu !== "string") return null;
    return { added: lignesDeTexte(contenu), removed: 0 };
  }
  if (minuscule !== "edit" && minuscule !== "multiedit") return null;

  let added = 0;
  let removed = 0;
  for (const edition of editionsDe(args)) {
    added += lignesDeTexte(edition.newText);
    removed += lignesDeTexte(edition.oldText);
  }
  return added === 0 && removed === 0 ? null : { added, removed };
};

/** Familles d'actions, dans l'ordre d'apparition du résumé. */
type Famille = "edition" | "suppression" | "shell" | "lecture" | "recherche" | "autre";

interface Modele {
  readonly famille: Famille;
  readonly icone: IconeAction;
  readonly singulier: string;
  readonly pluriel: string;
}

const SHELL: Modele = {
  famille: "shell",
  icone: "term",
  pluriel: "Commandes lancées",
  singulier: "Lancé",
};
const EDITION: Modele = {
  famille: "edition",
  icone: "edit",
  pluriel: "Fichiers modifiés",
  singulier: "Modifié",
};
const RECHERCHE: Modele = {
  famille: "recherche",
  icone: "find",
  pluriel: "Recherches",
  singulier: "Cherché",
};

const FAMILLES: Record<string, Modele> = {
  bash: SHELL,
  shell: SHELL,
  exec: SHELL,
  exec_command: SHELL,
  js: { famille: "shell", icone: "term", pluriel: "Scripts lancés", singulier: "Script lancé" },
  edit: EDITION,
  multiedit: EDITION,
  write: { famille: "edition", icone: "edit", pluriel: "Fichiers créés", singulier: "Créé" },
  read: { famille: "lecture", icone: "file", pluriel: "Fichiers lus", singulier: "Lu" },
  grep: RECHERCHE,
  glob: RECHERCHE,
  webfetch: { famille: "recherche", icone: "web", pluriel: "Pages lues", singulier: "Page lue" },
  websearch: {
    famille: "recherche",
    icone: "web",
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
  if (["exec", "exec_command", "apply_patch"].includes(minuscule)) {
    const patches = patchFilesOf(commandTextOf(args) ?? "");
    if (patches.length > 0) {
      const kinds = new Set(patches.map((patch) => patch.kind));
      const delta = deltaDe(minuscule, args);
      const seul = kinds.size === 1;
      const singulier =
        seul && kinds.has("add") ? "Créé" : seul && kinds.has("delete") ? "Supprimé" : "Modifié";
      const pluriel =
        seul && kinds.has("add")
          ? "Fichiers créés"
          : seul && kinds.has("delete")
            ? "Fichiers supprimés"
            : "Fichiers modifiés";
      return {
        cible: patches.length === 1 ? (patches[0]?.path ?? null) : null,
        delta,
        estFichier: true,
        icone: "edit",
        pluriel,
        singulier: patches.length === 1 ? singulier : pluriel,
      };
    }
  }

  if (NOMS_SUPPRESSION.has(minuscule)) {
    return {
      cible: cheminDe(args),
      delta: null,
      estFichier: true,
      icone: "delete",
      pluriel: "Fichiers supprimés",
      singulier: "Supprimé",
    };
  }

  const connu = FAMILLES[minuscule];
  const chemin = cheminDe(args);
  const titre = chaine(args, "title") ?? chaine(args, "description");
  // Une commande se reconnaît à sa première ligne ; une recherche à son motif.
  const commande =
    titre ??
    commandTextOf(args) ??
    (Array.isArray(args["argv"]) && args["argv"].every((part) => typeof part === "string")
      ? args["argv"].join(" ")
      : null) ??
    chaine(args, "code");
  const motif = chaine(args, "pattern") ?? chaine(args, "query") ?? chaine(args, "url");

  if (connu === undefined) {
    return {
      cible: commande?.split("\n")[0] ?? chemin ?? motif ?? null,
      delta: null,
      estFichier: false,
      icone: "dot",
      pluriel: "Actions",
      singulier: nom.trim().length > 0 ? nom.trim() : "Action",
    };
  }

  const cible =
    connu.famille === "shell"
      ? (commande?.split("\n")[0] ?? null)
      : connu.famille === "recherche"
        ? (motif ?? chemin)
        : (chemin ?? motif);

  return {
    cible,
    delta: deltaDe(minuscule, args),
    estFichier: connu.famille === "edition" || connu.famille === "lecture",
    icone: connu.icone,
    pluriel: connu.pluriel,
    singulier: connu.singulier,
  };
};

/** Regroupe des lignes de commande voisines sans absorber les éditions. */
export type LigneCommande = Extract<LigneTravail, { kind: "action" }>;
export type LigneAffichee =
  | LigneTravail
  | {
      readonly kind: "commands";
      readonly cle: string;
      readonly commands: ReadonlyArray<LigneCommande>;
      /**
       * Le libellé du groupe — « Ran commands », « Thinking ».
       *
       * ⚠️ **Sans lui, deux familles différentes porteraient le même titre.**
       * La fusion a été généralisée aux actions consécutives de même famille,
       * et un groupe de pensées affiché « Ran commands » serait un mensonge sur
       * ce que l'agent a fait.
       */
      readonly libelle: string;
    };

const estCommande = (ligne: LigneTravail): ligne is LigneCommande => {
  if (ligne.kind !== "action") return false;
  return ligne.details.some(
    (block) =>
      block.kind === "bashExecution" ||
      (block.kind === "toolCall" &&
        ["bash", "shell", "exec", "exec_command", "js"].includes(block.name.toLowerCase())),
  );
};

/**
 * Les lignes qui se regroupent, et sous quel titre.
 *
 * ⚠️ **Deux familles, deux titres.** Les commandes shell disent « Ran
 * commands » ; les pensées consécutives disent « Thinking ». Sans ce retour
 * explicite, la fusion généralisée aurait affiché « Ran commands 4 » sur quatre
 * raisonnements — un contresens sur ce que l'agent a fait.
 */
const titreDeGroupe = (ligne: LigneCommande): string | undefined => {
  /*
    ⚠️ **Le libellé d'abord, l'outil ensuite.** On compare le libellé d'action
    (pas l'identité de l'objet constant) : une ligne construite ailleurs porte
    la même réflexion sans être le même objet, et une comparaison par référence
    la laisserait hors du groupe.
  */
  if (ligne.action.pluriel === ACTION_REFLEXION.pluriel) return "Réflexion";
  if (estCommande(ligne)) return "Commandes lancées";
  return undefined;
};

export const regrouperCommandes = (
  lignes: ReadonlyArray<LigneTravail>,
): ReadonlyArray<LigneAffichee> => {
  const result: LigneAffichee[] = [];
  for (let index = 0; index < lignes.length;) {
    const ligne = lignes[index];
    if (ligne === undefined) break;
    if (ligne.kind !== "action") {
      result.push(ligne);
      index += 1;
      continue;
    }
    const titre = titreDeGroupe(ligne);
    if (titre === undefined) {
      result.push(ligne);
      index += 1;
      continue;
    }
    const commands: LigneCommande[] = [ligne];
    let next = index + 1;
    while (next < lignes.length) {
      const candidate = lignes[next];
      if (candidate === undefined || candidate.kind !== "action") break;
      if (titreDeGroupe(candidate) !== titre) break;
      commands.push(candidate);
      next += 1;
    }
    if (commands.length > 1)
      result.push({
        commands,
        kind: "commands",
        libelle: titre,
        cle: commands[0]?.cle ?? ligne.cle,
      });
    else result.push(ligne);
    index = next;
  }
  return result;
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
  // ⚠️ Au-delà du million, `2156k` ne se lit pas : on passe au million. Sans
  // cette borne, un gros travail s'affichait « 2156k ».
  if (milliers < 1000) return `${String(Math.round(milliers))}k`;

  const millions = milliers / 1000;
  return `${millions.toFixed(1).replace(".", ",")} M`;
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
  /** Lignes ajoutées, toutes éditions du travail confondues. */
  readonly added: number;
  /** Durée mesurée entre le premier et le dernier message, ou `null`. */
  readonly dureeMs: number | null;
  /**
   * Instant du **premier** message du groupe, ou `null`.
   *
   * ⚠️ Il sert à faire **avancer** la durée pendant que l'agent travaille : sans
   * lui, « Working 2 min » restait figé jusqu'au rafraîchissement suivant, alors
   * qu'un travail en cours est exactement ce qu'on regarde.
   */
  readonly debutMs: number | null;
  /**
   * Jetons **du travail**, jamais le cumul de la session.
   *
   * ⚠️ Chaque message porte ses propres `usage.totalTokens` ; on les **somme
   * sur le groupe**. Le total de la session, lui, ne dit rien sur ce qu'on
   * vient de lire — et c'est pourtant ce qu'il affichait.
   */
  readonly jetons: number | null;
  /** Lignes retirées, toutes éditions du travail confondues. */
  readonly removed: number;
}

/** Coût d'un groupe : durée mesurée, jetons additionnés. */
export const coutDuGroupe = (messages: ReadonlyArray<RenderedMessage>): Cout => {
  let premier: number | null = null;
  let dernier: number | null = null;
  let jetons = 0;
  let avecJetons = false;
  let added = 0;
  let removed = 0;

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== "toolCall") continue;
      const delta = deltaDe(block.name, block.arguments);
      if (delta === null) continue;
      added += delta.added;
      removed += delta.removed;
    }
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
  return {
    added,
    debutMs: premier,
    dureeMs,
    jetons: avecJetons ? jetons : null,
    removed,
  };
};

/**
 * Une ligne du travail : soit un appel, soit de la prose.
 *
 * ⚠️ **La prose fait partie du travail.** Entre deux appels, l'agent explique où
 * il en est ; c'est le contenu de référence d'un bloc « A travaillé » déplié. La
 * laisser de côté la ferait disparaître de l'écran, puisque la réponse affichée
 * hors du bloc n'est que la **dernière** prose du tour.
 */
export type LigneTravail =
  | {
      /**
       * Clé stable de la ligne : identifiant du message et rang du bloc.
       *
       * ⚠️ Pas l'index du tableau : React s'en sert pour décider quels éléments
       * garder, et un index réutilisé d'un rendu à l'autre fait sauter le focus
       * et l'état déplié.
       */
      readonly cle: string;
      /**
       * `true` quand cet appel a **échoué**.
       *
       * ⚠️ Sans ce marquage, le badge « échec » de l'en-tête n'avait aucun
       * répondant visible : la sortie fautive était repliée dans une ligne, et
       * rien à l'écran ne disait **laquelle**. On ne signale pas un échec qu'on
       * ne peut pas montrer.
       */
      readonly enEchec: boolean;
      readonly kind: "action";
      readonly action: Action;
      /**
       * Blocs montrés au dépliage : la sortie de l'appel, ou la réflexion.
       *
       * ⚠️ La sortie est **rattachée à son appel**, pas affichée en ligne
       * séparée : une session réelle produit un appel et son résultat, et deux
       * lignes par appel doubleraient le groupe pour la même information.
       */
      readonly details: ReadonlyArray<Block>;
    }
  | { readonly cle: string; readonly kind: "texte"; readonly texte: Block };

/** Action d'une ligne de réflexion — elle n'est pas un outil. */
const ACTION_REFLEXION: Action = {
  cible: null,
  delta: null,
  estFichier: false,
  icone: "brain",
  pluriel: "Réflexion",
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
  /** Forme interne : les détails d'une action sont remplis au fil des blocs. */
  type LigneEnCours =
    | {
        readonly cle: string;
        readonly kind: "action";
        readonly action: Action;
        /** Mutable : la sortie d'un appel s'y ajoute après coup. */
        readonly details: Array<Block>;
        enEchec: boolean;
      }
    | { readonly cle: string; readonly kind: "texte"; readonly texte: Block };
  const lignes: Array<LigneEnCours> = [];

  for (const message of messages) {
    for (const [rang, block] of message.blocks.entries()) {
      // Clé stable : identifiant du message et rang du bloc dedans.
      const cle = `${message.id}:${String(rang)}`;
      // La prose et les images du travail gardent leur rendu : ce ne sont pas
      // des lignes de résumé.
      if (block.kind === "text" || block.kind === "image") {
        lignes.push({ cle, kind: "texte", texte: block });
        continue;
      }
      if (block.kind === "toolCall") {
        // ⚠️ L'appel **est** son propre détail : le diff d'une édition vit dans
        // ses arguments, pas dans son résultat. Sans lui, « Fichier modifié »
        // n'avait rien à déplier.
        lignes.push({
          action: actionDe(block.name, block.arguments),
          cle,
          details: [block],
          enEchec: false,
          kind: "action",
        });
        continue;
      }
      if (block.kind === "bashExecution") {
        lignes.push({
          action: {
            cible: block.command.split("\n")[0] ?? null,
            delta: null,
            estFichier: false,
            icone: "term",
            pluriel: "Commandes lancées",
            singulier: "Lancé",
          },
          cle,
          details: [block],
          enEchec: false,
          kind: "action",
        });
        continue;
      }
      if (block.kind === "thinking") {
        lignes.push({
          action: ACTION_REFLEXION,
          cle,
          details: [block],
          enEchec: false,
          kind: "action",
        });
        continue;
      }
      if (block.kind === "toolResult") {
        // Un résultat en échec marque la ligne qui le porte : c'est là qu'on
        // regarde, et c'est ce que le badge de l'en-tête annonce.
        if (block.isError) {
          const precedente = lignes.at(-1);
          if (precedente !== undefined && precedente.kind === "action") {
            precedente.enEchec = true;
          } else {
            /*
              Un échec sans appel avant lui — une sortie orpheline. Il devient sa
              propre ligne, **marquée** : le badge de l'en-tête doit avoir un
              répondant visible, sinon il annonce un échec introuvable.
            */
            lignes.push({
              action: {
                cible: block.toolName.length > 0 ? block.toolName : null,
                delta: null,
                estFichier: false,
                icone: "result",
                pluriel: "Résultats",
                singulier: "Échec",
              },
              cle: `${cle}:echec`,
              details: [block],
              enEchec: true,
              kind: "action",
            });
            continue;
          }
        }
        // Le résultat se rattache à l'appel qui le précède. Sans appel avant
        // lui, il devient sa propre ligne : ne rien afficher perdrait la
        // sortie.
        const derniere = lignes.at(-1);
        if (
          derniere !== undefined &&
          derniere.kind === "action" &&
          derniere.action.icone !== "brain"
        ) {
          derniere.details.push(block);
          continue;
        }
        lignes.push({
          action: {
            cible: block.toolName.length > 0 ? block.toolName : null,
            delta: null,
            estFichier: false,
            icone: "result",
            pluriel: "Résultats",
            singulier: "Résultat",
          },
          cle,
          details: [block],
          enEchec: false,
          kind: "action",
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
        icone: "term",
        pluriel: "Commandes lancées",
        singulier: "Lancé",
      };
    case "toolResult":
      return {
        cible: block.toolName.length > 0 ? block.toolName : null,
        delta: null,
        estFichier: false,
        icone: "result",
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
        icone: "dot",
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
