/**
 * Le journal des pannes vues dans le navigateur — `POST /api/log`, **dédupliqué**.
 *
 * ⚠️ **Pourquoi.** Une barre rouge disparaît au rechargement : sans ce canal,
 * une panne vue sur le téléphone n'existait plus au moment de la diagnostiquer
 * (l'ancienne app le faisait ; la réécriture l'avait perdu pour la liste, la
 * session et l'envoi).
 *
 * ⚠️ **Dédupliqué.** Une liste hors ligne échoue toutes les 4 s : sans
 * dédoublonnage, le journal du démon se remplirait de la même ligne. Une même
 * panne (message + détail) n'est envoyée qu'une fois par fenêtre.
 *
 * Ce n'est pas une action d'agent : rien n'est envoyé à un agent.
 */
export type Envoyeur = (message: string, detail?: unknown) => void;

/** Une même panne n'est rejournalisée qu'après ce délai. */
export const FENETRE_JOURNAL_MS = 5 * 60_000;
/** Le nombre de pannes distinctes retenues pour le dédoublonnage. */
const RETENUES_MAX = 64;

export const creeJournal = (
  envoie: Envoyeur,
  maintenant: () => number = () => Date.now(),
  fenetre: number = FENETRE_JOURNAL_MS,
): Envoyeur => {
  const vues = new Map<string, number>();
  return (message, detail) => {
    let cle = message;
    try {
      cle = `${message}\u0000${JSON.stringify(detail) ?? ""}`;
    } catch {
      // Un détail circulaire se dédoublonne sur le message seul.
    }
    const instant = maintenant();
    const derniere = vues.get(cle);
    if (derniere !== undefined && instant - derniere < fenetre) return;
    vues.delete(cle);
    vues.set(cle, instant);
    while (vues.size > RETENUES_MAX) {
      const premiere = vues.keys().next();
      if (premiere.done === true) break;
      vues.delete(premiere.value);
    }
    envoie(message, detail);
  };
};
