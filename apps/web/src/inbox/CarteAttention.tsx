/**
 * Une carte « Attend une décision » — on répond **depuis la liste**.
 *
 * ⚠️ **On n'offre que ce qui est à l'écran de l'agent.** Les choix sont ceux
 * que le serveur a lus (`question.choix`), et il revalide le numéro avant de
 * l'envoyer. L'option de saisie libre ouvre la conversation : son texte se
 * tape dans le panneau de question, avec le choix.
 */
import { memo } from "react";
import type { ConversationSummary } from "@herdr-remote/shared";
import { estOptionSaisieLibre } from "@herdr-remote/shared";
import { cleAction } from "../actions-locales.ts";
import { libelleRefus } from "../etats-envoi.ts";
import { faireConfiance, repondre } from "../app/gestes.ts";
import { useAction } from "../app/hooks.ts";
import { marqueAgent, quand } from "../libelles.ts";
import { routeToHash } from "../routing.ts";
import { Marque } from "../ui/atomes.tsx";
import { IssueAction } from "../ui/IssueAction.tsx";

export const CarteAttention = memo(
  ({
    conversation,
    projet,
    titre,
    maintenant,
  }: {
    readonly conversation: ConversationSummary;
    readonly projet: string;
    readonly titre: string;
    readonly maintenant: number;
  }) => {
    const { paneId, question, trust, waiting } = conversation;
    const lien = routeToHash({ kind: "agent", paneId });
    const cle =
      trust !== undefined
        ? cleAction(paneId, "confiance", trust.folder)
        : cleAction(paneId, "reponse", question?.texte ?? "");
    const issue = useAction(cle);
    const occupe = issue?.phase === "en-cours";

    return (
      <article className="carte" aria-label={`${projet} attend une décision`}>
        <div className="carte__qui">
          <Marque kind={conversation.agent} />
          <span className="carte__projet">{projet}</span>
          <span>{marqueAgent(conversation.agent).nom}</span>
          {conversation.timestamp === undefined ? null : (
            <span className="carte__quand num">{quand(conversation.timestamp, maintenant)}</span>
          )}
        </div>
        {titre.length > 0 && titre !== projet ? <div className="carte__titre">{titre}</div> : null}

        {trust !== undefined ? (
          <>
            <p className="carte__q">
              Faire confiance au dossier <span className="mono">{trust.folder}</span>&nbsp;?
            </p>
            <p className="discret">
              L'agent pourra y lire, écrire et exécuter du code sans redemander. Ce choix est
              enregistré sur le Mac.
            </p>
            <div className="carte__options">
              <button
                type="button"
                className="bouton bouton--principal"
                disabled={occupe}
                onClick={() => void faireConfiance(paneId, trust.folder, true)}
              >
                Faire confiance
              </button>
              <button
                type="button"
                className="bouton"
                disabled={occupe}
                onClick={() => void faireConfiance(paneId, trust.folder, false)}
              >
                {libelleRefus(trust.kind)}
              </button>
            </div>
          </>
        ) : question !== undefined ? (
          <>
            <p className="carte__q">{question.texte}</p>
            {question.contexte.length > 0 ? (
              <p className="discret carte__contexte">{question.contexte.join(" · ")}</p>
            ) : null}
            <div className="carte__options">
              {question.choix.map((choix) =>
                estOptionSaisieLibre(choix.libelle) ? (
                  <a key={choix.numero} className="bouton" href={lien}>
                    <span className="k">{choix.numero}</span>
                    Répondre librement…
                  </a>
                ) : (
                  <button
                    key={choix.numero}
                    type="button"
                    className={choix.selectionne ? "bouton bouton--attn" : "bouton"}
                    disabled={occupe}
                    title={choix.detail}
                    onClick={() => void repondre(paneId, question.texte, choix.numero)}
                  >
                    <span className="k">{choix.numero}</span>
                    {choix.libelle}
                  </button>
                ),
              )}
              <a className="lien" href={lien}>
                Ouvrir
              </a>
            </div>
          </>
        ) : (
          <>
            <p className="carte__q">
              {waiting === undefined
                ? "L'agent attend, mais son écran ne montre rien de lisible."
                : "L'agent attend une saisie — aucun choix numéroté."}
            </p>
            {waiting === undefined ? null : (
              <pre className="carte__ecran">{waiting.split("\n").slice(-6).join("\n")}</pre>
            )}
            <div className="carte__options">
              <a className="bouton" href={lien}>
                Ouvrir pour répondre
              </a>
            </div>
          </>
        )}
        <IssueAction issue={issue} enCours="Envoi de la réponse…" />
      </article>
    );
  },
);
CarteAttention.displayName = "CarteAttention";
