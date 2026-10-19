/**
 * Le mot d'état d'une ligne de conversation (C22).
 *
 * ⚠️ **Un seul endroit décide du libellé.** Deux défauts mesurés venaient de
 * cette ligne, et tous les deux mentaient sur ce que fait l'agent :
 *
 * 1. **`blocked` disait « working ».** Un agent bloqué n'est pas au travail :
 *    il attend une réponse. La table `STATUS_LABEL` (partagée avec les autres
 *    écrans) dit « waiting for input » — c'est elle qui fait foi, pas un
 *    `else` de commodité.
 * 2. **`idle` disait « finished ».** `idle` veut dire « au repos, rien en
 *    cours ». Afficher « terminé il y a 3 min » **invente une fin** que rien
 *    n'a observée : c'est exactement ce que ce projet refuse d'exposer.
 *
 * La durée n'est donc ajoutée que pour `done`, et seulement quand la session
 * fournit un horodatage — jamais calculée depuis l'horloge de l'écran.
 */
import type { ConversationSummary } from "@herdr-remote/shared";
import { STATUS_LABEL } from "./labels.tsx";
import { dureeDepuis } from "./duree.ts";

/** Le mot d'état d'une conversation, à un instant donné. */
export const motDEtat = (conversation: ConversationSummary, maintenant: number): string => {
  // `blocked`, `idle` et `unknown` portent LEUR mot : aucun repli.
  if (conversation.status !== "done") {
    return STATUS_LABEL[conversation.status];
  }
  // `done` : le mot du contrat, et **quand** — si la session le dit. Sans
  // horodatage, on n'ajoute rien plutôt que d'inventer une durée.
  const quand = dureeDepuis(conversation.timestamp ?? null, maintenant);
  return quand === null ? STATUS_LABEL.done : `${STATUS_LABEL.done} ${quand}`;
};
