/**
 * La carte d'un message du **harnais** : le rapport d'un sous-agent, ou la fin
 * d'une tâche de fond. Jamais une bulle de demande : l'utilisateur ne l'a pas
 * écrit.
 *
 * - **rapport** : « Rapport de sous-agent · <description> · terminée », le corps
 *   en Markdown, replié quand il est long ;
 * - **fin de tâche** : une ligne, et son résultat s'il n'est pas déjà dans un
 *   rapport du fil (le harnais renvoie alors au rapport, inutile de le répéter).
 *
 * La description et l'état viennent du contexte {@link InfosTaches} : la liste du
 * démon et les notifications du fil, réunies par la conversation.
 */
import { createContext, memo, useContext, useState } from "react";
import type { BackgroundTaskStatus } from "@herdr-remote/shared";
import type { RenderedMessage } from "../blocks.ts";
import { dureeLongue, heureDe } from "../libelles.ts";
import { Markdown } from "../Markdown.tsx";
import {
  SEUIL_REPLI,
  STATUT_TACHE,
  titreDuRapport,
  type InfoTache,
  type RapportDeTache,
} from "../taches.ts";
import { Icone } from "../ui/Icone.tsx";

/** Ce qu'on sait des tâches de la conversation, par identifiant. */
export const InfosTaches = createContext<ReadonlyMap<string, InfoTache>>(new Map());

/** La forme d'un statut de tâche — forme ET couleur, avec le mot pour les lecteurs d'écran. */
export const FormeTache = ({ status }: { readonly status: BackgroundTaskStatus }) => {
  const { mot, ton } = STATUT_TACHE[status];
  return (
    <span className={`etat etat--${ton}`}>
      {ton === "work" ? (
        <span className="spin" aria-hidden="true" />
      ) : ton === "ok" ? (
        <Icone nom="check" petite />
      ) : ton === "err" ? (
        <Icone nom="x" petite />
      ) : ton === "idle" ? (
        <span className="anneau" aria-hidden="true" />
      ) : (
        <span className="tirets" aria-hidden="true" />
      )}
      <span className="sr">{mot}</span>
    </span>
  );
};

const Corps = ({ source }: { readonly source: string }) => {
  const long = source.length > SEUIL_REPLI;
  const [deplie, setDeplie] = useState(false);
  return (
    <>
      <div className={long && !deplie ? "rapport__corps rapport__corps--replie" : "rapport__corps"}>
        <Markdown source={source} />
      </div>
      {long ? (
        <button
          type="button"
          className="rapport__plus"
          aria-expanded={deplie}
          onClick={() => setDeplie((valeur) => !valeur)}
        >
          {deplie ? "Collapse" : "Read all"}
        </button>
      ) : null}
    </>
  );
};

export const CarteRapport = memo(({ message }: { readonly message: RenderedMessage }) => {
  const infos = useContext(InfosTaches);
  const rapport = message.blocks.find(
    (block): block is RapportDeTache => block.kind === "rapportTache",
  );
  if (rapport === undefined) return null;
  const info = rapport.taskId === null ? undefined : infos.get(rapport.taskId);
  const titre = titreDuRapport(rapport, info);
  const statut =
    rapport.status ?? (rapport.sorte === "subagent-report" ? (info?.status ?? null) : null);
  const heure = heureDe(message.at);
  // Une fin de tâche dont le rapport est déjà dans le fil : une ligne suffit.
  const sansCorps =
    rapport.corps.trim().length === 0 ||
    (rapport.sorte === "task-notification" && info?.rapport === true);
  return (
    <article
      className={`rapport rapport--${rapport.sorte === "subagent-report" ? "rapport" : "fin"}`}
      aria-label={titre.join(" · ")}
    >
      <header className="rapport__tete">
        {statut === null ? <Icone nom="brain" petite /> : <FormeTache status={statut} />}
        <span className="rapport__titre">{titre.join(" · ")}</span>
        <span className="rapport__meta num">
          {rapport.dureeMs === null ? null : <span>{dureeLongue(rapport.dureeMs)}</span>}
          {message.meta["pendantTour"] === "1" ? <span>during the turn</span> : null}
          {heure === null ? null : <span>{heure}</span>}
        </span>
      </header>
      {sansCorps ? null : <Corps source={rapport.corps} />}
    </article>
  );
});
CarteRapport.displayName = "CarteRapport";
