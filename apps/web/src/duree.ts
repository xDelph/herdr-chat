/**
 * Durée relative — « il y a 2 min ».
 *
 * ⚠️ Réservée aux **lignes de liste**, jamais à une région vivante. U11 a
 * remplacé « il y a 3 min » par une heure fixe dans le bandeau d'état, parce
 * qu'une région vivante dont le texte change à chaque rafraîchissement répète
 * l'annonce au lecteur d'écran. Ici la ligne est du texte ordinaire : elle ne
 * ré-annonce rien, et une heure fixe serait moins utile qu'« il y a 2 min ».
 *
 * Les bornes sont volontairement grossières — sous la minute on dit « à
 * l'instant » : au doigt, « il y a 40 s » n'apporte rien et fait clignoter la
 * liste à chaque rafraîchissement.
 */

/** Durée affichée, en français, à partir d'un écart en millisecondes. */
export const dureeRelative = (depuisMs: number): string => {
  // ⚠️ Un horodatage dans le futur ne doit pas produire « il y a -3 s ».
  const secondes = Math.max(0, Math.floor(depuisMs / 1000));
  if (secondes < 60) return "à l'instant";
  // ⚠️ **Plancher, jamais arrondi.** Un âge arrondi vers le haut exagère : 1 min
  // 59 arrondi donnerait « 2 min », et c'est précisément la donnée que
  // l'utilisateur compare avec son propre souvenir. Le plancher sous-estime
  // d'au plus une unité, ce qui est sans conséquence ; l'autre exagère.
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return minutes === 1 ? "il y a 1 min" : `il y a ${String(minutes)} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return heures === 1 ? "il y a 1 h" : `il y a ${String(heures)} h`;
  const jours = Math.floor(heures / 24);
  return jours === 1 ? "il y a 1 j" : `il y a ${String(jours)} j`;
};

/**
 * Durée relative d'un horodatage.
 *
 * `null` quand on n'a pas d'instant mesuré : une absence n'est pas « à
 * l'instant », c'est ne rien savoir.
 */
export const dureeDepuis = (instant: number | null, maintenant: number): string | null =>
  instant === null ? null : dureeRelative(maintenant - instant);
