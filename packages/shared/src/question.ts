/**
 * La question qu'un agent pose à l'écran — avec ses choix.
 *
 * ⚠️ **Pourquoi lire l'écran, et pas la session.** Un agent qui attend une
 * réponse ne l'écrit **pas** dans son JSONL : l'invite n'existe que sur le
 * terminal. La session dit `blocked`, elle ne dit pas pourquoi. Sans lecture
 * d'écran, l'application ne pouvait afficher qu'un état sans question — « il
 * faut agir », sans dire sur quoi.
 *
 * Herdr expose cette lecture : `agent.read`, avec `strip_ansi`. Relevé le
 * 2026-10-13 sur un agent codex réellement bloqué :
 *
 * ```text
 *   Field 1/1
 *   Allow Computer Use to use "Zen"?
 *
 *   App: Zen
 *
 *   › 1. Allow                   Run the tool and continue
 *     2. Allow for this session  Run the tool and remember this choice for this session
 *     3. Always allow            Run the tool and remember this choice for future tool calls
 *     4. Cancel                  Cancel this tool call
 *   enter to submit | esc to cancel
 * ```
 *
 * ⚠️ **Ce module ne devine rien.** Une invite non reconnue rend `undefined` : on
 * n'affiche pas une question approximative à la place de la vraie. C'est la même
 * règle que partout ailleurs dans ce produit.
 */

/** Un choix proposé, tel qu'il apparaît à l'écran. */
export interface Choix {
  /** Numéro affiché, celui qu'il faut taper ou sélectionner. */
  readonly numero: number;
  /** Libellé court — « Allow », « Cancel ». */
  readonly libelle: string;
  /** Explication de l'effet du choix, quand l'écran en donne une. */
  readonly detail?: string;
  /** Choix actuellement surligné (`›`). */
  readonly selectionne: boolean;
}

/** Une question posée, prête à afficher. */
export interface Question {
  /** Texte de la question. */
  readonly texte: string;
  /** Lignes de contexte (`App: Zen`, `Field 1/1`), affichées en retrait. */
  readonly contexte: ReadonlyArray<string>;
  readonly choix: ReadonlyArray<Choix>;
  /** Ce qu'il faut faire pour valider — « enter to submit | esc to cancel ». */
  readonly invite?: string;
}

/**
 * Filet de rendu vertical, en début de ligne.
 *
 * ⚠️ **opencode encadre sa zone de question d'un filet** (`┃`). Mesuré sur un
 * agent réellement bloqué, 2026-10-16 :
 *
 * ```text
 *   ┃  Questions
 *   ┃
 *   ┃  I don't see a report in your message… — how would you like to share it?
 *   ┃
 *   ┃  1. It's a file on disk
 *   ┃     Tell me the file path…
 *   ┃  5. Type your own answer
 *   ┃
 *   ┃  ↑↓ select  enter submit  esc dismiss
 * ```
 *
 * Sans ce nettoyage, **aucun choix n'était reconnu** : `LIGNE_CHOIX` commence par
 * `^[ \t]*(›)?`, et le `┃` n'y entre pas. La fonction rendait `undefined`, donc
 * l'application affichait « il faut agir » **sans dire sur quoi** — un agent
 * bloqué et muet, exactement le défaut que ce module existe pour éviter.
 */
const FILET = /^[ \t]*[┃│|]/;

/**
 * Une ligne d'écran, filet de rendu retiré.
 *
 * ⚠️ **On retire le filet, pas ce qui le suit.** Les espaces d'après le `┃`
 * portent l'**indentation**, et c'est elle qui distingue le détail d'un choix
 * de la ligne d'invite : chez opencode, le choix est à deux espaces et son
 * détail à cinq ; chez pi et codex, l'invite est moins indentée que les choix.
 * Tout aplatir ferait passer `enter to submit` pour le détail du dernier choix.
 */
const sansFilet = (ligne: string): string => ligne.replace(FILET, "");

/** Indentation d'une ligne, en caractères. */
const indentation = (ligne: string): number => ligne.length - ligne.trimStart().length;

/**
 * Un choix : `›` facultatif, numéro, libellé, puis détail séparé par 2 espaces.
 *
 * ⚠️ Le séparateur du détail est une **suite d'au moins deux espaces**, pas un
 * nombre fixe : les colonnes sont alignées par le terminal, et l'écart varie
 * avec la longueur des libellés. Un seul espace est donc significatif — et ne
 * sépare pas : « Allow for this session » est un libellé, pas deux champs.
 */
const LIGNE_CHOIX = /^[ \t]*(›|❯)?[ \t]*(\d{1,2})[.)][ \t]+(.+)$/;

/**
 * La ligne d'aide du sélecteur.
 *
 * ⚠️ **`↑↓` existe aussi, sans barre oblique.** Relevé sur opencode :
 * `↑↓ select  enter submit  esc dismiss`. La forme `↑/↓` avait été écrite d'après
 * pi, où les flèches sont écrites ainsi — une seule forme reconnue suffisait à
 * perdre l'invite sur un autre agent.
 */
const LIGNE_INVITE = /^[ \t]*(?:enter|↑\/?↓)/i;

/** `Field 1/1` — position dans une suite de questions. */
const LIGNE_CHAMP = /^[ \t]*Field[ \t]+\d+[ \t]*\/[ \t]*\d+/i;

/** `Clé: valeur` — le contexte d'une invite (`App: Zen`). */
const LIGNE_CONTEXTE = /^[ \t]*[A-Za-z][\w ._-]{0,24}:[ \t]*\S/;

/**
 * Sépare libellé et détail sur une ligne de choix.
 *
 * Le détail commence à la **dernière** suite de deux espaces ou plus qui laisse
 * un texte : les libellés sont alignés sur la droite, donc l'écart minimal est
 * parfois en début de ligne (« 2. Allow for this session  Run… »).
 */
const separerLibelle = (brut: string): { libelle: string; detail?: string } => {
  const texte = brut.trimEnd();
  // Un séparateur est un « trou » d'au moins deux espaces **cerné** de texte.
  const trou = /[ \t]{2,}/g;
  let meilleur: number | undefined;
  for (const trouve of texte.matchAll(trou)) {
    const index = trouve.index ?? 0;
    if (index === 0 || index + trouve[0].length >= texte.length) continue;
    meilleur = index;
  }
  if (meilleur === undefined) return { libelle: texte.trim() };

  const libelle = texte.slice(0, meilleur).trim();
  const detail = texte.slice(meilleur).trim();
  if (libelle.length === 0) return { libelle: texte.trim() };
  return detail.length === 0 ? { libelle } : { detail, libelle };
};

/**
 * Lit la question affichée sur un écran de terminal.
 *
 * ⚠️ On lit **la dernière invite de l'écran**, pas la première : un agent qui a
 * déjà travaillé en a affiché plusieurs, et l'écran garde le défilement. La
 * première trouvée serait une invite périmée, à laquelle plus personne
 * n'attend de réponse.
 */
export const questionDeLEcran = (ecran: string): Question | undefined => {
  //
  // ⚠️ **Premier geste : retirer le filet de rendu.** opencode encadre sa zone de
  // question d'un `┃` en début de ligne, et toutes les reconnaissances ci-dessous
  // sont ancrées sur le début de ligne. Voir `FILET`.
  const lignes = ecran.split("\n").map(sansFilet);

  /*
    ⚠️ **On raisonne sur les lignes NUMÉROTÉES seules.**

    opencode place le détail d'un choix sur la **ligne suivante**, indentée :

    ```text
    1. It's a file on disk
       Tell me the file path…
    2. Paste it as text
    ```

    L'ancienne recherche exigeait des lignes de choix **consécutives** : elle
    remontait donc d'une seule ligne, s'arrêtait sur le détail, et ne retenait
    que le dernier choix — puis échouait sur « au moins deux choix ». Résultat :
    `undefined`, et un agent bloqué sans question affichée.
  */
  const numerotees: Array<number> = [];
  for (let index = 0; index < lignes.length; index += 1) {
    const ligne = lignes[index];
    if (ligne !== undefined && LIGNE_CHOIX.test(ligne)) numerotees.push(index);
  }
  if (numerotees.length === 0) return undefined;

  /** Numéro porté par la ligne d'index donné, ou `null`. */
  const numeroDe = (index: number): number | null => {
    const trouve = LIGNE_CHOIX.exec(lignes[index] ?? "");
    return trouve === null ? null : Number.parseInt(trouve[2] ?? "", 10);
  };

  /*
    On remonte la suite **contiguë** qui se termine sur le dernier choix : 5, 4,
    3… Le « moins un exactement » est ce qui borne la remontée : une liste
    numérotée plus haut dans l'écran (une sortie d'outil) ne peut pas s'y
    raccrocher, parce qu'elle ne continue pas la numérotation.
  */
  let debut = numerotees.length - 1;
  while (debut > 0) {
    const courant = numeroDe(numerotees[debut] ?? 0);
    const precedent = numeroDe(numerotees[debut - 1] ?? 0);
    if (courant === null || precedent === null || precedent !== courant - 1) break;
    debut -= 1;
  }
  const retenues = numerotees.slice(debut);
  const premier = retenues[0] ?? 0;

  const choix: Array<Choix> = [];
  for (const index of retenues) {
    const trouve = LIGNE_CHOIX.exec(lignes[index] ?? "");
    if (trouve === null) continue;
    const corps = trouve[3] ?? "";
    const lu = separerLibelle(corps);
    /*
      ⚠️ **Le détail peut être sur la ligne suivante.** opencode l'y met, indenté
      plus profond que le choix, là où pi et codex l'écrivent sur la même ligne
      après deux espaces.

      Deux garde-fous, appris d'un test qui a échoué : la ligne suivante doit être
      **plus indentée** que le choix, et ne pas être la ligne d'invite. Sans le
      second, `enter to submit` devenait le détail du dernier choix.
    */
    const suivante = lignes[index + 1];
    const surLaSuivante =
      lu.detail === undefined &&
      suivante !== undefined &&
      suivante.trim().length > 0 &&
      !LIGNE_CHOIX.test(suivante) &&
      !LIGNE_INVITE.test(suivante) &&
      indentation(suivante) > indentation(lignes[index] ?? "")
        ? suivante.trim()
        : undefined;
    const detail = lu.detail ?? surLaSuivante;
    choix.push({
      ...(detail === undefined ? {} : { detail }),
      libelle: lu.libelle,
      numero: Number.parseInt(trouve[2] ?? "0", 10),
      selectionne: trouve[1] === "›" || trouve[1] === "❯",
    });
  }

  // ⚠️ Une liste sans numérotation cohérente n'est pas une invite : c'est une
  // sortie d'outil qui contient des « 1. », « 2. ».
  if (choix.length < 2) return undefined;
  const numeros = choix.map((c) => c.numero).join(",");
  const attendus = choix.map((_, i) => i + 1).join(",");
  if (numeros !== attendus) return undefined;

  // Contexte et question : les lignes qui précèdent la liste.
  const avant: Array<string> = [];
  for (let index = premier - 1; index >= 0; index -= 1) {
    const ligne = lignes[index];
    if (ligne === undefined) break;
    const propre = ligne.trim();
    if (propre.length === 0) {
      if (avant.length > 0) avant.unshift("");
      continue;
    }
    if (LIGNE_CHAMP.test(ligne) || LIGNE_CONTEXTE.test(ligne)) {
      avant.unshift(propre);
      continue;
    }
    // Première ligne qui n'est ni un champ ni du contexte : c'est la question.
    avant.unshift(propre);
    break;
  }

  let texte: string | undefined;
  const contexte: Array<string> = [];
  for (const ligne of avant) {
    if (texte === undefined && !LIGNE_CHAMP.test(ligne) && !LIGNE_CONTEXTE.test(ligne)) {
      texte = ligne;
      continue;
    }
    if (ligne.length > 0) contexte.push(ligne);
  }
  if (texte === undefined) return undefined;

  // L'invite de validation, après la liste.
  let invite: string | undefined;
  for (let index = premier; index < lignes.length; index += 1) {
    const ligne = lignes[index];
    if (ligne !== undefined && LIGNE_INVITE.test(ligne)) {
      invite = ligne.trim();
      break;
    }
  }

  return {
    choix,
    contexte,
    ...(invite === undefined ? {} : { invite }),
    texte,
  };
};

/**
 * Le libellé que **opencode ajoute lui-même** pour la saisie libre.
 *
 * ⚠️ **Ce n'est pas un choix du modèle, et ce n'est pas une heuristique.** C'est
 * la chaîne qu'opencode écrit dans son propre code d'affichage de formulaire,
 * relevée dans son bundle (2.0.23, 2026-10-16) :
 *
 * ```js
 * if (e.custom) i.push({ value: f, label: "Type your own answer" });
 * let r = yield* sS({ … options: i … });
 * if (r === f) { … }
 * let n = yield* cS({ … placeholder: … });   // le champ texte s'ouvre
 * ```
 *
 * Et sa description d'outil le dit explicitement : « A "Type your own answer"
 * option is added automatically; don't include a separate option for free form
 * answers ».
 *
 * ⚠️ **La reconnaître sert à ne PAS l'envoyer.** Choisir cette option ouvre un
 * champ texte : envoyer le seul numéro d'un cran fait ouvrir le champ et laisse
 * l'utilisateur sans moyen d'y écrire. L'application doit donc la traiter comme
 * une **demande de saisie**, pas comme une réponse.
 */
export const OPTION_SAISIE_LIBRE = "Type your own answer";

/** Les saisies libres de Claude Code (`AskUserQuestion`, 2.1.312). */
export const OPTIONS_SAISIE_LIBRE_CLAUDE: ReadonlyArray<string> = [
  "Type something.",
  "Type something",
];

/** Un libellé de choix est-il une option de saisie libre (opencode, Claude) ? */
export const estOptionSaisieLibre = (libelle: string): boolean => {
  const propre = libelle.trim();
  return propre === OPTION_SAISIE_LIBRE || OPTIONS_SAISIE_LIBRE_CLAUDE.includes(propre);
};
