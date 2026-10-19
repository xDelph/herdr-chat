/**
 * Brouillons de saisie, **un par agent**.
 *
 * ⚠️ **Pourquoi un magasin, et pas un état de composant.** Un brouillon écrit
 * puis abandonné — on part vérifier un autre agent — disparaissait, et il fallait
 * tout retaper. Le remettre dans `App` aurait fait remonter un état de saisie
 * jusqu'à la racine, pour une chose que seul le composeur utilise.
 *
 * ⚠️ **La clé est le `paneId`, et elle n'est pas décorative.** Sans elle, deux
 * agents partageaient le même brouillon : ce qu'on avait commencé à écrire pour
 * l'un se retrouvait dans le composeur de l'autre, prêt à partir au mauvais
 * endroit. Un magasin global aurait remplacé un défaut par un plus grave.
 *
 * ⚠️ **En mémoire, volontairement.** Un brouillon n'est pas un document : il vit
 * le temps d'une session. Le persister ferait survivre un texte à un
 * redémarrage sans que personne l'ait demandé — et `localStorage` garderait des
 * messages non envoyés sur le disque, ce que le produit évite partout ailleurs.
 */
const brouillons = new Map<string, string>();

/** Brouillon en cours d'un agent. Chaîne vide s'il n'y en a pas. */
export const lireBrouillon = (paneId: string): string => brouillons.get(paneId) ?? "";

/**
 * Y a-t-il **un** brouillon, chez n'importe quel agent ?
 *
 * ⚠️ C'est la question de la mise à jour (T060) : recharger pour appliquer une
 * nouvelle version efface le composeur, donc le brouillon. On ne le persiste
 * pas (ce serait écrire un texte non envoyé sur le disque) : on attend.
 */
export const unBrouillonExiste = (): boolean => brouillons.size > 0;

/**
 * Retient le brouillon d'un agent.
 *
 * ⚠️ Un texte vide **efface** l'entrée au lieu de stocker `""` : sans cela, la
 * carte garderait une ligne par agent visité, pour rien.
 */
export const ecrireBrouillon = (paneId: string, texte: string): void => {
  if (texte.length === 0) brouillons.delete(paneId);
  else brouillons.set(paneId, texte);
};
