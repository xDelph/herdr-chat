/**
 * Les gestes qui **écrivent** chez un agent — répondre, faire confiance,
 * arrêter, montrer sur le Mac.
 *
 * ⚠️ **Chaque geste capture sa cible à l'appel** (`paneId` passé en argument,
 * jamais relu sur l'écran) et range son issue sous `cleAction(cible, genre,
 * sujet)`. Une issue revenue pour un sujet périmé est rejetée par le magasin
 * d'actions — elle ne peut pas se poser sous une autre question ou un autre
 * agent.
 *
 * ⚠️ **Rien n'est présenté comme fait sans preuve.** « Transmise » n'est pas
 * « appliquée » ; une confiance « transmise » n'est pas « accordée ».
 */
import { answerQuestion, answerTrust, focusAgent, reportError, stopAgent } from "../api.ts";
import { cleAction, type EtatAction } from "../actions-locales.ts";
import { expliquerConfiance } from "../etats-envoi.ts";
import { actions, magasin, notifications } from "./services.ts";

const cause = (erreur: unknown): string =>
  erreur instanceof Error ? erreur.message : String(erreur);

const execute = async (
  cle: string,
  geste: () => Promise<EtatAction>,
  rapport: {
    readonly message: string;
    readonly paneId: string;
    /**
     * L'issue part aussi en notification en haut de l'écran. Pour les gestes
     * sans emplacement propre (arrêter, afficher sur le Mac) : leur issue
     * s'affichait sous le composeur, là où on ne la cherche pas.
     */
    readonly notifie?: boolean;
  },
): Promise<void> => {
  const jeton = actions.debute(cle);
  if (jeton === null) return;
  let issue: EtatAction;
  try {
    issue = await geste();
  } catch (erreur) {
    issue = { phase: "fini", texte: cause(erreur), ton: "erreur" };
  }
  if (issue.phase === "fini" && issue.ton === "erreur") {
    reportError(rapport.message, { detail: issue.texte, paneId: rapport.paneId });
  }
  actions.termine(cle, jeton, issue);
  if (rapport.notifie === true && issue.phase === "fini") {
    notifications.annonce(issue.ton, issue.texte);
  }
  // L'état de l'agent a pu changer : la liste le dira au prochain vol.
  void magasin.rafraichit();
};

export const sujetQuestion = (texte: string): string => texte;

export const repondre = (
  paneId: string,
  question: string,
  numero: number,
  texte?: string,
): Promise<void> =>
  execute(
    cleAction(paneId, "reponse", sujetQuestion(question)),
    async () => {
      const resultat = await answerQuestion(paneId, numero, texte);
      switch (resultat.state) {
        case "appliquee":
          return { phase: "fini", texte: `Answer ${String(numero)} applied.`, ton: "ok" };
        case "transmise":
          return {
            phase: "fini",
            texte: `Answer ${String(numero)} sent — Herdr has not confirmed it was applied. ${resultat.detail}`,
            ton: "attention",
          };
        default:
          return { phase: "fini", texte: `Answer rejected: ${resultat.detail}`, ton: "erreur" };
      }
    },
    { message: "failed to answer a question", paneId },
  );

export const faireConfiance = (paneId: string, dossier: string, accepte: boolean): Promise<void> =>
  execute(
    cleAction(paneId, "confiance", dossier),
    async () => {
      const resultat = await answerTrust(paneId, accepte);
      const issue = expliquerConfiance(resultat.state);
      if (resultat.state === "inconnu") {
        return { phase: "fini", texte: `${issue.texte} (${resultat.detail})`, ton: "erreur" };
      }
      return {
        phase: "fini",
        texte: issue.texte,
        ton: issue.resolue ? (resultat.state === "refusee" ? "attention" : "ok") : "attention",
      };
    },
    { message: "failed to answer a trust prompt", paneId },
  );

export const arreter = (paneId: string): Promise<void> =>
  execute(
    cleAction(paneId, "arret"),
    async () => {
      const resultat = await stopAgent(paneId);
      return resultat.status === "interrupt-sent"
        ? {
            phase: "fini",
            texte: "Interrupt sent by Herdr — the agent has not confirmed it stopped yet.",
            ton: "attention",
          }
        : { phase: "fini", texte: "Herdr reports the agent is no longer working.", ton: "ok" };
    },
    { message: "failed to interrupt the agent", notifie: true, paneId },
  );

/**
 * Montrer le pane sur le Mac — **uniquement sur demande**.
 *
 * ⚠️ C'était un effet de bord de la lecture (défilement d'une conversation
 * terminée → `POST /focus`) : lire sur le téléphone volait le clavier du Mac.
 * C'est désormais une entrée du menu, et rien d'autre ne l'appelle.
 */
export const montrerSurMac = (paneId: string): Promise<void> =>
  execute(
    cleAction(paneId, "focus"),
    async () => {
      await focusAgent(paneId);
      return { phase: "fini", texte: "Pane shown on the Mac.", ton: "ok" };
    },
    { message: "failed to focus a pane", notifie: true, paneId },
  );
