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
 * Un choix : `›` facultatif, numéro, libellé, puis détail séparé par 2 espaces.
 *
 * ⚠️ Le séparateur du détail est une **suite d'au moins deux espaces**, pas un
 * nombre fixe : les colonnes sont alignées par le terminal, et l'écart varie
 * avec la longueur des libellés. Un seul espace est donc significatif — et ne
 * sépare pas : « Allow for this session » est un libellé, pas deux champs.
 */
const LIGNE_CHOIX = /^[ \t]*(›)?[ \t]*(\d{1,2})[.)][ \t]+(.+)$/;

/** « enter to submit | esc to cancel » — la ligne d'aide du sélecteur. */
const LIGNE_INVITE = /^[ \t]*(?:enter|↑\/↓)/i;

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
  const lignes = ecran.split("\n");

  // Le **dernier** choix de l'écran : c'est lui qui décide de l'invite à lire.
  let indexDernierChoix = -1;
  for (let index = lignes.length - 1; index >= 0; index -= 1) {
    const ligne = lignes[index];
    if (ligne !== undefined && LIGNE_CHOIX.test(ligne)) {
      indexDernierChoix = index;
      break;
    }
  }
  if (indexDernierChoix === -1) return undefined;

  // Remonte jusqu'au premier choix de cette même invite. On s'arrête sur une
  // ligne franchement séparatrice : au-delà, c'est le contenu précédent.
  let premier = indexDernierChoix;
  for (let index = indexDernierChoix; index >= 0; index -= 1) {
    const ligne = lignes[index];
    if (ligne === undefined || !LIGNE_CHOIX.test(ligne)) break;
    premier = index;
  }

  const choix: Array<Choix> = [];
  for (let index = premier; index < lignes.length; index += 1) {
    const ligne = lignes[index];
    if (ligne === undefined) continue;
    const trouve = LIGNE_CHOIX.exec(ligne);
    if (trouve === null) {
      // Un trou dans la numérotation ferme la liste : la suite appartient à
      // autre chose (une sortie d'outil, une autre invite).
      if (choix.length > 0 && ligne.trim().length === 0) continue;
      if (choix.length > 0) break;
      continue;
    }
    const corps = trouve[3] ?? "";
    const { libelle, detail } = separerLibelle(corps);
    choix.push({
      ...(detail === undefined ? {} : { detail }),
      libelle,
      numero: Number.parseInt(trouve[2] ?? "0", 10),
      selectionne: trouve[1] === "›",
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
