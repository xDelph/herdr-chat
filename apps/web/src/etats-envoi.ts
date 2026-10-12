/**
 * Les états d'envoi et de confiance, **un par un** (U08).
 *
 * ⚠️ Le contrat dit : « timeout, refus, erreur, inconnu ont textes/actions
 * distincts ; `décision transmise` ≠ “accordée” ». Ces fonctions sont le seul
 * endroit où cette phrase devient exécutable.
 *
 * Le défaut qu'elles ferment : `échec : …` pour les trois échecs, et une carte
 * de confiance qui disparaît sur `transmise`. Une décision « partie mais pas
 * prouvée » s'affichait donc comme une confiance accordée, ce qui est
 * exactement l'anticipation que la règle interdit.
 */

/** Ce que l'utilisateur doit savoir, et ce qu'il peut faire. */
export type Explication = {
  /** Texte affiché. Distingue chaque état — jamais un préfixe commun. */
  readonly texte: string;
  /** Ce que l'utilisateur peut faire, ou `null` s'il n'y a rien à faire. */
  readonly action: string | null;
};

/**
 * Un envoi qui a échoué, selon son état réel.
 *
 * - `attente` — Herdr n'a pas tranché. **Le message est peut-être parti** :
 *   l'action est de le renvoyer, pas de le retaper au hasard.
 * - `erreur` — Herdr a refusé, rien n'est parti. L'action est de retaper.
 * - `inconnu` — seul le transport a répondu. Ni Herdr n'a dit oui, ni non :
 *   on ne prétend pas savoir, et on ne propose pas de renvoyer en double.
 */
export const expliquerEchec = (
  etat: "attente" | "erreur" | "inconnu",
  message: string,
): Explication => {
  switch (etat) {
    case "attente":
      return {
        texte: `Herdr n'a pas confirmé à temps — le message est peut-être parti. ${message}`,
        // Renvoyer plutôt que retaper : la saisie est encore là, et Herdr
        // ignorera un doublon identique.
        action: "Renvoyer le message",
      };
    case "erreur":
      return {
        texte: `Envoi refusé — ${message}`,
        action: "Corriger le message",
      };
    case "inconnu":
      return {
        texte: `Envoi sans réponse de Herdr — état inconnu. ${message}`,
        // Aucune action : renvoyer pourrait doubler le message, et c'est
        // précisément ce que l'écran ne peut pas trancher.
        action: null,
      };
  }

  /*
    Atteint seulement si un état échappe à l'union fermée — donc jamais. On
    préfère le montrer que le masquer : un état qu'on ne sait pas nommer doit
    se voir, pas disparaître en silence.
  */
  return { texte: `échec d'envoi dans un état inconnu : ${String(etat)}`, action: null };
};

/**
 * Un envoi effectué sans confirmation.
 *
 * « Envoyé » sans réserve serait une promesse que rien ne prouve. La nuance
 * coûte un mot et évite d'annoncer à l'utilisateur qu'un message est parti
 * quand ce n'est pas établi.
 */
export const expliquerEnvoi = (confirmation: "confirmed" | "unknown"): Explication =>
  confirmation === "confirmed"
    ? { texte: "envoyé, confirmé par Herdr", action: null }
    : { texte: "envoi effectué, confirmation incertaine — état inconnu", action: null };

/** Un double envoi supprimé : un état **normal**, jamais une alerte rouge. */
export const expliquerSuppression = (raison: string): Explication => ({
  texte: `double envoi supprimé — ${raison}`,
  action: null,
});

/**
 * L'état d'une décision de confiance, **après** la frappe.
 *
 * ⚠️ `transmise` n'est pas « accordée ». Herdr peut refuser la touche, et
 * l'agent peut redémarrer. Tant que `acceptee` ou `refusee` n'est pas revenu,
 * l'écran doit rester sur ce mot — sinon l'utilisateur croit avoir donné une
 * permission permanente alors qu'elle n'est peut-être pas écrite.
 */
export type IssueConfiance = {
  /** `true` quand l'écran peut se séparer de la carte. */
  readonly resolue: boolean;
  readonly texte: string;
};

export const expliquerConfiance = (state: string): IssueConfiance => {
  switch (state) {
    case "acceptee":
      // Seule issue favorable : la permission est écrite, l'agent démarre.
      return { resolue: true, texte: "confiance accordée — l'agent peut démarrer" };
    case "refusee":
      // Un refus est une décision, pas une panne : rien n'est écrit, et
      // l'agent reste bloqué. L'écran peut se séparer.
      return { resolue: true, texte: "confiance refusée — rien n'a été écrit" };
    case "transmise":
      return {
        resolue: false,
        texte: "décision transmise — Herdr ne l'a pas encore confirmée. Ce n'est pas « accordée ».",
      };
    case "inconnu":
      // Le transport n'a rien dit. Ni Herdr n'a dit oui, ni non.
      return {
        resolue: false,
        texte: "la décision n'a pas été confirmée par Herdr — état inconnu",
      };
    case "non-applicable":
      return {
        resolue: true,
        texte: "aucune confiance à donner pour cet agent",
      };
    default:
      /*
        Un état que ce fichier ne connaît pas ne doit pas être traité comme un
        accord. Le retour prudent est « pas résolue » : la carte reste, et
        l'utilisateur voit qu'on ne sait pas.
      */
      return { resolue: false, texte: `décision de confiance dans un état inconnu : ${state}` };
  }
};
