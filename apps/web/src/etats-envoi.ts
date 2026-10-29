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
 *   l'action est de le renvoyer (Herdr ignore un doublon identique récent).
 * - `erreur` — Herdr a refusé, rien n'est parti. L'action est de retaper.
 * - `inconnu` — seul le transport a répondu. Ni Herdr n'a dit oui, ni non :
 *   renvoyer reste possible, mais le bouton **dit** le risque de doublon.
 * - `hors-ligne` — l'appareil était hors ligne : la requête n'a pas quitté le
 *   téléphone. Rien n'est parti, réessayer est sans risque.
 *
 * ⚠️ **Le texte et le bouton disent la même chose.** `inconnu` annonçait
 * « aucune action » pendant que la bulle montrait un bouton « Réessayer » : le
 * bouton est désormais l'action nommée ici, et nulle part ailleurs.
 */
export const expliquerEchec = (etat: EtatEchecAffiche, message: string): Explication => {
  const suite = message.length > 0 ? ` ${message}` : "";
  switch (etat) {
    case "attente":
      return {
        texte: `Non confirmé — le message est peut-être parti.${suite}`,
        // Renvoyer plutôt que retaper : la saisie est encore là, et Herdr
        // ignorera un doublon identique.
        action: "Réessayer",
      };
    case "erreur":
      return {
        texte: `Envoi refusé —${suite.length > 0 ? suite : " sans cause donnée"}`,
        action: "Modifier le message",
      };
    case "inconnu":
      return {
        texte: `Aucune réponse d'Herdr — remise inconnue.${suite}`,
        // Le risque est dans le libellé : c'est précisément ce que l'écran ne
        // peut pas trancher, donc l'utilisateur décide en le sachant.
        action: "Renvoyer (doublon possible)",
      };
    case "hors-ligne":
      return {
        texte: `Hors ligne : rien n'est parti.${suite}`,
        action: "Réessayer",
      };
  }

  /*
    Atteint seulement si un état échappe à l'union fermée — donc jamais. On
    préfère le montrer que le masquer : un état qu'on ne sait pas nommer doit
    se voir, pas disparaître en silence.
  */
  return {
    texte: `Envoi en échec, état inconnu : ${String(etat)}`,
    action: null,
  };
};

/** Les états d'échec affichés : les trois du contrat (B05), plus le nôtre. */
export type EtatEchecAffiche = "attente" | "erreur" | "inconnu" | "hors-ligne";

/**
 * Un envoi effectué sans confirmation.
 *
 * « Envoyé » sans réserve serait une promesse que rien ne prouve. La nuance
 * coûte un mot et évite d'annoncer à l'utilisateur qu'un message est parti
 * quand ce n'est pas établi.
 */
export const expliquerEnvoi = (confirmation: "confirmed" | "unknown"): Explication =>
  confirmation === "confirmed"
    ? { texte: "Envoyé, remise confirmée par Herdr", action: null }
    : { texte: "Envoyé, remise non confirmée", action: null };

/**
 * Un double envoi supprimé : un état **normal**, jamais une alerte rouge — mais
 * jamais non plus un envoi : rien n'est parti.
 */
export const NON_ENVOYE_DOUBLON =
  "Non envoyé : identique à un message déjà remis il y a moins d'une minute";

export const expliquerSuppression = (raison: string): Explication => ({
  texte: raison.length > 0 ? `${NON_ENVOYE_DOUBLON} (${raison})` : NON_ENVOYE_DOUBLON,
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

/**
 * Le libellé du bouton de refus — il dit ce que le refus **fait**.
 *
 * ⚠️ Dans les deux familles mesurées, l'option qui refuse **quitte** l'agent :
 * codex l'étiquette `2. Quit`, claude `No, exit`. « Deny » seul laissait croire
 * à un « non, mais je continue ». Le libellé porte donc la conséquence.
 */
export const libelleRefus = (kind: string | null): string =>
  `Refuser et arrêter ${kind ?? "l'agent"}`;

export const expliquerConfiance = (state: string): IssueConfiance => {
  switch (state) {
    case "acceptee":
      // Seule issue favorable : la permission est écrite, l'agent démarre.
      return {
        resolue: true,
        texte: "Accès au dossier accordé — l'agent peut démarrer",
      };
    case "refusee":
      /*
        ⚠️ **Refuser, c'est arrêter l'agent** — les deux familles mesurées
        l'écrivent elles-mêmes : codex propose `2. Quit`, claude `No, exit`.
        L'ancien texte (« nothing was written », et l'agent reste bloqué) était
        hérité de codex sans mesure et se lisait comme un simple refus sans
        conséquence. Un refus reste une décision — pas une panne — mais il a un
        effet, et l'écran le dit.
      */
      return {
        resolue: true,
        texte: "Accès refusé — rien n'a été écrit, et l'agent s'est arrêté",
      };
    case "transmise":
      return {
        resolue: false,
        texte: "Décision transmise — Herdr ne l'a pas encore confirmée.",
      };
    case "inconnu":
      // Le transport n'a rien dit. Ni Herdr n'a dit oui, ni non.
      return {
        resolue: false,
        texte: "Herdr n'a pas confirmé la décision — état inconnu",
      };
    case "non-applicable":
      return {
        resolue: true,
        texte: "Aucune décision d'accès n'est nécessaire pour cet agent",
      };
    default:
      /*
        Un état que ce fichier ne connaît pas ne doit pas être traité comme un
        accord. Le retour prudent est « pas résolue » : la carte reste, et
        l'utilisateur voit qu'on ne sait pas.
      */
      return {
        resolue: false,
        texte: `Décision d'accès dans un état inconnu : ${state}`,
      };
  }
};
