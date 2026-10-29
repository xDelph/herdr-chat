/**
 * Le pane ouvert existe-t-il encore, et peut-on lui écrire ?
 *
 * ⚠️ **Le défaut fermé (P1).** L'écran retombait sur le dernier état mémorisé
 * d'un pane fermé : l'agent n'était jamais `null`, l'avis « Herdr ne connaît
 * plus ce pane » ne s'affichait jamais, l'état restait « Travaille » et Arrêter
 * restait actif — sur un pane qui n'existait plus. La mémoire ne sert plus
 * qu'aux **libellés** ; la présence se décide ici, sur la dernière lecture.
 *
 * ⚠️ **Une ouverture à froid n'est pas une disparition.** Ouvert depuis une
 * notification, le pane n'est dans aucune lecture tant que la première n'est
 * pas revenue ; un agent tout juste lancé n'est pas encore dans la lecture
 * d'avant son lancement. On ne conclut à la disparition que sur une lecture qui
 * aurait dû le voir.
 *
 * Pur : aucune horloge, aucun React — vérifiable en test.
 */

export type PresencePane =
  /** La dernière lecture d'Herdr contient le pane. */
  | "present"
  /** Rien ne permet encore de conclure (aucune lecture, ou lecture trop ancienne). */
  | "attente"
  /** Une lecture qui aurait dû le voir ne le contient pas : il est fermé. */
  | "disparu";

export const presenceDuPane = (etat: {
  /** Le pane est dans la dernière lecture de l'overview. */
  readonly present: boolean;
  /** Une lecture de l'overview a déjà réussi. */
  readonly overviewLu: boolean;
  /** Le pane a été vu dans une lecture précédente. */
  readonly vuAvant: boolean;
  /** Instant de la dernière lecture réussie, ou `null`. */
  readonly lueA: number | null;
  /** Instant d'ouverture de la conversation. */
  readonly ouvertA: number;
}): PresencePane => {
  if (etat.present) return "present";
  if (!etat.overviewLu) return "attente";
  if (etat.vuAvant) return "disparu";
  // Jamais vu : seule une lecture postérieure à l'ouverture tranche.
  return etat.lueA !== null && etat.lueA > etat.ouvertA ? "disparu" : "attente";
};

/** Pourquoi le composeur ne peut pas envoyer maintenant — `null` s'il le peut. */
export const raisonSansEnvoi = (etat: {
  readonly presence: PresencePane;
  /** Phase de lecture de la session (`flux-session.ts`). */
  readonly phase: "chargement" | "pret" | "erreur";
  /** L'agent attend une décision affichée au-dessus du composeur. */
  readonly attente: "question" | "confiance" | null;
}): string | null => {
  if (etat.presence === "disparu") {
    return "Herdr ne connaît plus ce pane : rien ne peut lui être envoyé.";
  }
  if (etat.attente === "confiance") {
    return "Répondez d'abord à la demande d'accès ci-dessus : un message serait tapé dans l'invite de l'agent.";
  }
  if (etat.attente === "question") {
    return "Répondez avec les choix ci-dessus : un message serait tapé dans l'invite de l'agent, pas comme réponse.";
  }
  /*
    ⚠️ Envoyer avant la première page faisait oublier la bulle à tort : son
    texte était comparé à un historique encore vide, puis retrouvé dans
    l'historique plus ancien. On attend la page — c'est l'affaire d'un instant.
  */
  if (etat.phase === "chargement") {
    return "Lecture de la conversation… l'envoi s'ouvre dès qu'elle est chargée.";
  }
  return null;
};

/** Le nombre de panes dont on garde le dernier état connu (libellés). */
export const MEMOIRE_PANES_MAX = 24;

/**
 * Retient le dernier état d'un pane, **borné** : la mémoire grandissait à
 * chaque conversation ouverte, sans limite, pendant toute la vie de l'onglet.
 * Le plus anciennement retenu part en premier.
 */
export const retiens = <V>(
  memoire: ReadonlyMap<string, V>,
  cle: string,
  valeur: V,
  max: number = MEMOIRE_PANES_MAX,
): ReadonlyMap<string, V> => {
  if (memoire.get(cle) === valeur) return memoire;
  const suivante = new Map(memoire);
  suivante.delete(cle);
  suivante.set(cle, valeur);
  while (suivante.size > max) {
    const premiere = suivante.keys().next();
    if (premiere.done === true) break;
    suivante.delete(premiere.value);
  }
  return suivante;
};
