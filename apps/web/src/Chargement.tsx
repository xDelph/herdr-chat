/**
 * L'écran d'attente — **centré, et qui respire**.
 *
 * ⚠️ **Pourquoi ce composant existe.** Un paragraphe gris collé sous l'en-tête
 * (« Loading this conversation… ») ressemble à un message d'erreur : même place,
 * même discrétion, aucune indication que quelque chose avance. Une application
 * qui charge doit le dire **au milieu**, avec un mouvement — c'est ce qui
 * distingue « ça travaille » de « c'est cassé ».
 *
 * ⚠️ **Trois points, pas un spinner géant.** Un indicateur discret suffit :
 * l'écran n'attend qu'un aller-retour, et un gros cercle qui tourne pour 200 ms
 * donne l'impression d'un site lourd. Les trois points pulsent en décalé, ce qui
 * se lit comme une activité continue.
 *
 * ⚠️ **Un `<output>`, pas une `div` avec `role="status"`** : la balise porte déjà
 * le rôle et l'annonce polie, et le linter du projet préfère la sémantique au
 * rôle explicite. Un lecteur d'écran l'annonce sans interrompre — ce n'est pas
 * une alerte.
 */
export const Chargement = ({
  texte,
  detail,
}: {
  /** Ce qu'on attend, en une phrase courte (« Loading conversation… »). */
  readonly texte: string;
  /** La cause ou le contexte, quand il y en a un. */
  readonly detail?: string | undefined;
}) => (
  <output className="chargement">
    <span className="chargement__points" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    <span className="chargement__texte">{texte}</span>
    {detail === undefined ? null : <span className="chargement__detail muted small">{detail}</span>}
  </output>
);
