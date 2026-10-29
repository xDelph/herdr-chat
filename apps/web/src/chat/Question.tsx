/**
 * Ce que l'agent attend, ancré au-dessus du composeur.
 *
 * Trois formes, une seule règle : **on n'offre que ce qui est à l'écran de
 * l'agent**, et le serveur revalide avant d'envoyer.
 *
 * - confiance : accorder ou refuser (refuser arrête l'agent — le bouton le dit) ;
 * - question : les choix numérotés, et la réponse libre si l'agent en offre une
 *   (le choix et le texte partent ensemble) ;
 * - saisie sans choix : l'écran brut, et le composeur pour répondre.
 *
 * La provenance est écrite : lue sur l'écran de l'agent, à telle heure.
 */
import { memo, useId, useState } from "react";
import type { ConversationSummary } from "@herdr-remote/shared";
import { estOptionSaisieLibre } from "@herdr-remote/shared";
import { cleAction } from "../actions-locales.ts";
import { libelleRefus } from "../etats-envoi.ts";
import { faireConfiance, repondre } from "../app/gestes.ts";
import { useAction } from "../app/hooks.ts";
import { Icone } from "../ui/Icone.tsx";
import { IssueAction } from "../ui/IssueAction.tsx";

const heureLueA = (instant: number | null): string => {
  if (instant === null) return "à une heure inconnue";
  const date = new Date(instant);
  return `à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
};

export const Question = memo(
  ({
    conversation,
    agentNom,
    lueA,
  }: {
    readonly conversation: ConversationSummary;
    readonly agentNom: string;
    /** Instant de la dernière lecture réussie de la liste — d'où vient la question. */
    readonly lueA: number | null;
  }) => {
    const { paneId, question, trust, waiting } = conversation;
    const [libre, setLibre] = useState("");
    const idLibre = useId();
    const cle =
      trust !== undefined
        ? cleAction(paneId, "confiance", trust.folder)
        : cleAction(paneId, "reponse", question?.texte ?? "");
    const issue = useAction(cle);
    const occupe = issue?.phase === "en-cours";

    if (trust !== undefined) {
      return (
        <section className="dock" aria-label="Confiance demandée">
          <div className="dock__de">
            <span className="losange" aria-hidden="true" />
            {agentNom} demande l'accès
          </div>
          <p className="dock__q">
            Faire confiance au dossier <span className="mono">{trust.folder}</span>&nbsp;?
          </p>
          <p className="discret">
            L'agent pourra y lire, écrire et exécuter du code sans redemander. Le choix est
            enregistré sur le Mac.
          </p>
          <div className="dock__boutons">
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
          <IssueAction issue={issue} enCours="Envoi de la décision…" />
        </section>
      );
    }

    if (question !== undefined) {
      const optionLibre = question.choix.find((choix) => estOptionSaisieLibre(choix.libelle));
      return (
        <section className="dock" aria-label="Question de l'agent">
          <div className="dock__de">
            <span className="losange" aria-hidden="true" />
            {agentNom} demande
          </div>
          <p className="dock__q">{question.texte}</p>
          {question.contexte.length > 0 ? (
            <p className="discret">{question.contexte.join(" · ")}</p>
          ) : null}
          {question.choix
            .filter((choix) => choix !== optionLibre)
            .map((choix) => (
              <button
                key={choix.numero}
                type="button"
                className={choix.selectionne ? "choix choix--courant" : "choix"}
                disabled={occupe}
                onClick={() => void repondre(paneId, question.texte, choix.numero)}
              >
                <span className="choix__k">{choix.numero}</span>
                <span>
                  {choix.libelle}
                  {choix.detail === undefined ? null : <small>{choix.detail}</small>}
                </span>
              </button>
            ))}
          {optionLibre === undefined ? null : (
            <form
              className="dock__libre"
              onSubmit={(evenement) => {
                evenement.preventDefault();
                const texte = libre.trim();
                if (texte.length === 0) return;
                void repondre(paneId, question.texte, optionLibre.numero, texte);
                setLibre("");
              }}
            >
              <label className="sr" htmlFor={idLibre}>
                Autre réponse
              </label>
              <input
                id={idLibre}
                value={libre}
                placeholder="Autre réponse…"
                onChange={(evenement) => setLibre(evenement.target.value)}
              />
              <button
                type="submit"
                className="rond rond--envoi"
                aria-label="Envoyer la réponse"
                disabled={occupe || libre.trim().length === 0}
              >
                <Icone nom="up" />
              </button>
            </form>
          )}
          <IssueAction issue={issue} enCours="Envoi de la réponse…" />
          <p className="dock__pied">
            Lue sur l'écran de l'agent {heureLueA(lueA)} · choix revérifié par le serveur avant
            l'envoi
          </p>
        </section>
      );
    }

    return (
      <section className="dock" aria-label="Ce que l'agent attend">
        <div className="dock__de">
          <span className="losange" aria-hidden="true" />
          {agentNom} attend
        </div>
        {waiting === undefined ? (
          <p className="discret">
            Herdr signale que l'agent attend, mais son écran ne montre ni question ni choix.
          </p>
        ) : (
          <pre className="dock__ecran">{waiting}</pre>
        )}
        <p className="dock__pied">
          Aucun choix numéroté : répondez dans le champ ci-dessous — le texte est tapé dans l'invite
          de l'agent.
        </p>
      </section>
    );
  },
);
Question.displayName = "Question";
