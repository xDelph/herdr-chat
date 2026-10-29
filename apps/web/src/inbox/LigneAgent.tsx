/**
 * Une ligne de la liste : un agent au travail, ou une conversation récente.
 *
 * - **au travail** : le chronomètre depuis le passage à `working` *observé*
 *   (absent si on ne l'a pas vu passer : on n'invente pas de durée), et la
 *   dernière chose que l'agent a écrite ;
 * - **récente** : le dernier message, le temps écoulé, et le point « non lu »
 *   tant qu'on ne l'a pas ouverte ici.
 *
 * ⚠️ L'action d'outil en cours n'est pas dans `/api/conversations` : la lire
 * demanderait une lecture de session par ligne. La ligne montre donc le
 * dernier texte de l'agent, et le chat montre l'action exacte.
 */
import { memo } from "react";
import type { ConversationSummary } from "@herdr-remote/shared";
import { apercuTexte, chrono, quand } from "../libelles.ts";
import { routeToHash } from "../routing.ts";
import { Etat, FormeEtat, Marque } from "../ui/atomes.tsx";

const apercu = (conversation: ConversationSummary): string =>
  apercuTexte(conversation.preview ?? conversation.lastPrompt ?? "");

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
    const auTravail = conversation.status === "working";
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
              <span className="sr">Non lu : </span>
            </>
          ) : null}
          {projet}
          {titre.length > 0 && titre !== projet ? <span> · {titre}</span> : null}
        </span>
        {auTravail ? (
          <Etat status="working">
            <span className="num">
              {debutTravail === undefined ? "Travaille" : chrono(maintenant - debutTravail)}
            </span>
          </Etat>
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
              ? "Pas de session lisible pour cet agent"
              : "Session illisible"}
          </span>
        ) : null}
      </a>
    );
  },
);
LigneAgent.displayName = "LigneAgent";
