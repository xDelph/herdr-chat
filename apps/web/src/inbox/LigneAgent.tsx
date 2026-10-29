/**
 * Une ligne de la liste : un agent au travail, ou une conversation récente.
 *
 * - **au travail** : le chronomètre depuis la demande qui a ouvert le tour,
 *   lue dans la session (`tourDebut`, la même origine que le chat) ; à défaut,
 *   depuis le passage à `working` *observé* ; sinon pas de durée inventée — et
 *   la dernière chose que l'agent a écrite ;
 * - **en attente de ses tâches de fond** : « Attend 2 tâches de fond » ;
 * - **récente** : le dernier message, le temps écoulé, et le point « non lu »
 *   tant qu'on ne l'a pas ouverte ici.
 *
 * ⚠️ L'action d'outil en cours n'est pas dans `/api/conversations` : la lire
 * demanderait une lecture de session par ligne. La ligne montre donc le
 * dernier texte de l'agent, et le chat montre l'action exacte.
 */
import { memo } from "react";
import type { ConversationSummary } from "@herdr-remote/shared";
import { apercuTexte, chrono, libelleReflexion, quand } from "../libelles.ts";
import { attenteDeTaches } from "../taches.ts";
import { routeToHash } from "../routing.ts";
import { Etat, FormeEtat, Marque } from "../ui/atomes.tsx";

const apercu = (conversation: ConversationSummary): string =>
  apercuTexte(conversation.preview ?? conversation.lastPrompt ?? "");

/** Branche · modèle · réflexion — ce que la ligne montrait avant la réécriture. */
const details = (conversation: ConversationSummary): string =>
  [
    conversation.branch,
    conversation.model,
    conversation.thinking === undefined ? undefined : libelleReflexion(conversation.thinking),
  ]
    .filter((morceau) => morceau !== undefined && morceau.length > 0)
    .join(" · ");

export const LigneAgent = memo(
  ({
    conversation,
    projet,
    titre,
    maintenant,
    nonLue,
    debutTravail,
    courante,
  }: {
    readonly conversation: ConversationSummary;
    readonly projet: string;
    readonly titre: string;
    readonly maintenant: number;
    readonly nonLue: boolean;
    readonly debutTravail: number | undefined;
    readonly courante: boolean;
  }) => {
    const texte = apercu(conversation);
    const reglages = details(conversation);
    const auTravail = conversation.status === "working";
    // La session d'abord : le chat et la liste partent du même instant.
    const debut = conversation.tourDebut ?? debutTravail;
    const attente = auTravail ? null : attenteDeTaches(conversation.tachesDeFond);
    return (
      <a
        className={nonLue ? "ligne ligne--non-lue" : "ligne"}
        href={routeToHash({ kind: "agent", paneId: conversation.paneId })}
        aria-current={courante ? "page" : undefined}
      >
        <Marque kind={conversation.agent} />
        <span className="ligne__nom">
          {nonLue ? (
            <>
              <span className="ligne__point" aria-hidden="true" />
              <span className="sr">Unread: </span>
            </>
          ) : null}
          {projet}
          {titre.length > 0 && titre !== projet ? <span> · {titre}</span> : null}
        </span>
        {auTravail ? (
          <Etat status="working">
            <span className="num">
              {debut === undefined ? "Working" : chrono(maintenant - debut)}
            </span>
          </Etat>
        ) : attente !== null ? (
          <Etat status="working">{attente}</Etat>
        ) : (
          <span className="ligne__meta num">
            {conversation.status === "done" || conversation.status === "unknown" ? (
              <span className={`etat etat--${conversation.status === "done" ? "ok" : "unknown"}`}>
                <FormeEtat status={conversation.status} />
              </span>
            ) : null}
            {conversation.timestamp === undefined
              ? null
              : quand(conversation.timestamp, maintenant)}
          </span>
        )}
        {texte.length > 0 ? (
          <span className={auTravail ? "ligne__texte ligne__texte--travail" : "ligne__texte"}>
            {texte}
          </span>
        ) : conversation.sessionState !== "available" ? (
          <span className="ligne__texte ligne__texte--absent">
            {conversation.sessionState === "absent"
              ? "No readable session for this agent"
              : "Unreadable session"}
          </span>
        ) : null}
        {reglages.length > 0 ? <span className="ligne__details">{reglages}</span> : null}
      </a>
    );
  },
);
LigneAgent.displayName = "LigneAgent";
