/**
 * Nommage d'un pane — **une seule décision**, trois consommateurs.
 *
 * ⚠️ **Pourquoi un module partagé.** La même question se pose à trois endroits :
 * la ligne de la liste, l'en-tête de la conversation, et le corps d'une
 * notification. Écrite trois fois, elle aurait fini par répondre trois choses
 * différentes — et c'est le genre d'écart qu'aucun test ne rattrape, parce qu'il
 * ne casse rien : il fait juste dire au téléphone autre chose que l'écran.
 *
 * ⚠️ **Ce que Herdr donne, et ce qu'il ne donne pas** (mesuré le 2026-10-16 sur
 * 0.9.3, protocole 22) :
 *
 * - un agent lancé par `agent.start` porte un **`name`**, unique entre agents —
 *   c'est le seul libellé *choisi*, donc le seul qui veuille dire quelque chose ;
 * - un agent lancé **à la main** n'en porte aucun : ses 13 agents n'en avaient
 *   pas un seul ;
 * - Herdr **numérote les tabs et les workspaces, jamais les panes** ; le seul
 *   discriminant d'un pane est donc sa **place dans la disposition** de son tab,
 *   qu'on lit dans `snapshot.layouts`.
 */

/**
 * Le premier texte contient-il le second ? Insensible à la casse.
 *
 * ⚠️ Sert à écarter un libellé qui ne dit rien de plus : Herdr donne `atcrea`
 * comme libellé d'onglet **dans** le projet `atcrea`, et `pixel` comme nom
 * d'agent dans le projet `pixel`. Sans cette règle, la notification annonçait
 * « π - atcrea · atcrea · pi ».
 */
export const dejaDit = (foin: string, aiguille: string): boolean =>
  foin.toLowerCase().includes(aiguille.toLowerCase());

/** Non vide après nettoyage, ou rien. */
const nonVide = (valeur: string | null | undefined): string | null => {
  const propre = valeur?.trim();
  return propre !== undefined && propre.length > 0 ? propre : null;
};

/** Ce qu'il faut savoir d'un pane pour l'étiqueter. */
export interface PaneAEtiqueter {
  /** Nom donné par Herdr (`agent.start`), `null` pour un agent lancé à la main. */
  readonly name: string | null;
  /** Rang du pane dans son tab, en ordre de lecture (1 = premier). `null` si inconnu. */
  readonly paneRank: number | null;
  /** Combien de panes compte le tab. `1` = l'agent est seul. */
  readonly tabPaneCount: number;
  readonly tabLabel: string | null;
  readonly workspaceLabel: string | null;
}

/**
 * L'étiquette qui distingue un pane de ses voisins de **même tab**, ou
 * `undefined` quand il n'y a rien à distinguer.
 *
 * ⚠️ **Rien n'est affiché quand l'agent est seul dans son tab** — le cas
 * ordinaire, et de loin. C'est la même règle que pour le libellé d'onglet : on
 * n'ajoute un discriminant que quand sans lui deux choses se confondent. Une
 * étiquette qui apparaîtrait partout deviendrait du bruit qu'on ne lit plus.
 *
 * ⚠️ **Ordre des sources, et il est délibéré :**
 *
 * 1. le **nom** choisi (Herdr l'exige unique) — le seul libellé qui *veuille dire
 *    quelque chose* ;
 * 2. sauf s'il **répète** le projet ou l'onglet : `agent.start` reçoit par défaut
 *    le libellé du projet, donc l'afficher redirait la ligne du dessus ;
 * 3. sinon la **place dans la disposition** — exacte, toujours disponible, et
 *    celle qu'on voit sur le Mac : « pane 2 » est le deuxième rectangle.
 *
 * ⚠️ **Ce qui n'est pas fait, et pourquoi.** Rien n'est tiré de `pane_id`
 * (`wA:p7`) : ce numéro est celui du pane **dans le workspace**, pas dans le tab,
 * donc deux voisins de tab pouvaient afficher `pane 5` et `pane 7` sans rien
 * expliquer. La place dans la disposition suit ce que l'utilisateur voit.
 */
export const etiquetteDePane = (pane: PaneAEtiqueter): string | undefined => {
  if (pane.tabPaneCount < 2) return undefined;
  const nom = nonVide(pane.name);
  if (nom !== null && !repete(nom, pane.tabLabel) && !repete(nom, pane.workspaceLabel)) return nom;
  if (pane.paneRank !== null) return `pane ${String(pane.paneRank)}`;
  return undefined;
};

/** Le libellé répète-t-il une des chaînes connues ? */
const repete = (libelle: string, ...connus: ReadonlyArray<string | null>): boolean =>
  connus.some((connu) => connu !== null && dejaDit(connu, libelle));

/**
 * Rang de chaque pane dans son tab, **en ordre de lecture** : de haut en bas,
 * puis de gauche à droite.
 *
 * ⚠️ **L'ordre est celui de la disposition, pas celui de la création.** Mesuré
 * sur un tab réel à cinq panes : créés `p1 p2 p3 p4 p5`, disposés
 * `p1 p2 / p4 p3 / p5` → l'ordre de lecture est `p1 p2 p4 p3 p5`. Trier par
 * identifiant aurait donné un numéro qui ne correspond à aucun rectangle.
 *
 * ⚠️ Les rectangles sont en **cellules de terminal**, donc ils changent avec la
 * fenêtre — mais l'*ordre* ne change qu'en déplaçant un pane, ce qui est
 * exactement le moment où l'utilisateur s'attend à ce que la numérotation suive.
 */
export const rangsDesPanes = (
  panes: ReadonlyArray<{
    readonly pane_id: string;
    readonly rect?: { readonly x: number; readonly y: number } | undefined;
  }>,
): Map<string, number> => {
  const avecRect = panes.filter(
    (pane): pane is { pane_id: string; rect: { x: number; y: number } } => pane.rect !== undefined,
  );
  // Un pane sans rectangle (snapshot partiel) ne peut pas être ordonné : il est
  // laissé de côté plutôt que rangé au hasard, et n'aura donc pas de rang.
  const ordonnes = [...avecRect].toSorted(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.pane_id.localeCompare(b.pane_id),
  );
  return new Map(ordonnes.map((pane, index) => [pane.pane_id, index + 1]));
};
