/**
 * Les tâches de fond d'un agent : la liste (description, sorte, état, durées,
 * dernière activité), et la transcription d'une tâche en **lecture seule**.
 *
 * ⚠️ **Lecture seule, de bout en bout.** Rien ici n'écrit vers l'agent : la
 * liste vient de `/api/agents/{paneId}/taches`, la transcription de
 * `/taches/{id}/session` — les fichiers de l'agent, jamais Herdr.
 *
 * ⚠️ `inconnu` est affiché tel quel : ni fin écrite, ni activité depuis 30 min.
 * Le présenter « en cours » serait affirmer ce qu'on ne sait pas.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionEntry } from "@herdr-remote/shared";
import { fusionnerEntrees } from "../messages.ts";
import {
  STATUT_TACHE,
  dureesDe,
  fetchSessionDeTache,
  fetchTaches,
  resumeUtile,
  sorteDeTache,
  type BackgroundTask,
} from "../taches.ts";
import { creeTranscripteur } from "../transcript.ts";
import { ElementFil } from "../chat/Elements.tsx";
import { FormeTache } from "../chat/CarteRapport.tsx";
import { useMaintenant } from "../app/hooks.ts";
import { Avis } from "../ui/atomes.tsx";
import { Feuille } from "../ui/Feuille.tsx";
import { Icone } from "../ui/Icone.tsx";

/** La cadence de relecture tant que la feuille est ouverte. */
const RELECTURE_MS = 5_000;

const LigneTache = ({
  tache,
  maintenant,
  onOuvrir,
}: {
  readonly tache: BackgroundTask;
  readonly maintenant: number;
  readonly onOuvrir: (tache: BackgroundTask) => void;
}) => {
  const contenu = (
    <>
      <FormeTache status={tache.status} />
      <span className="tache__texte">
        <span className="tache__titre">{tache.description ?? tache.id}</span>
        <span className="tache__meta">
          {[
            sorteDeTache(tache),
            STATUT_TACHE[tache.status].mot,
            ...dureesDe(tache, maintenant),
          ].join(" · ")}
        </span>
        {resumeUtile(tache) === null ? null : (
          <span className="tache__resume">{resumeUtile(tache)}</span>
        )}
      </span>
    </>
  );
  return (
    <li>
      {tache.transcript ? (
        <button type="button" className="tache" onClick={() => onOuvrir(tache)}>
          {contenu}
          <Icone nom="chev" petite />
        </button>
      ) : (
        <div className="tache">{contenu}</div>
      )}
    </li>
  );
};

/** La transcription d'une tâche, lue en pages, relue tant qu'elle travaille. */
const Transcription = ({
  paneId,
  tache,
  cwd,
  onOuvrirFichier,
}: {
  readonly paneId: string;
  readonly tache: BackgroundTask;
  readonly cwd: string | null;
  readonly onOuvrirFichier: (chemin: string) => void;
}) => {
  const [entrees, setEntrees] = useState<ReadonlyArray<SessionEntry>>([]);
  const [avant, setAvant] = useState<string | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  const [transcrire] = useState(creeTranscripteur);
  const { items } = useMemo(() => transcrire(entrees), [transcrire, entrees]);
  const maintenant = useMaintenant(60_000);

  useEffect(() => {
    let vivant = true;
    let suivant: string | undefined;
    const lit = async () => {
      try {
        const page = await fetchSessionDeTache(
          paneId,
          tache.id,
          suivant === undefined ? {} : { cursor: suivant },
        );
        if (!vivant) return;
        setErreur(null);
        setEntrees((affichees) =>
          page.incremental && !page.reset
            ? fusionnerEntrees(affichees, page.entries)
            : page.entries,
        );
        if (suivant === undefined) setAvant(page.hasMore ? page.previousCursor : undefined);
        suivant = page.cursor ?? suivant;
      } catch (cause) {
        if (vivant) setErreur(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (vivant) setCharge(true);
      }
    };
    void lit();
    // Une tâche finie ne bouge plus : une seule lecture.
    const minuterie =
      tache.status === "en_cours" ? window.setInterval(() => void lit(), RELECTURE_MS) : undefined;
    return () => {
      vivant = false;
      if (minuterie !== undefined) window.clearInterval(minuterie);
    };
  }, [paneId, tache.id, tache.status]);

  const plusAncien = useCallback(async () => {
    if (avant === undefined) return;
    try {
      const page = await fetchSessionDeTache(paneId, tache.id, { before: avant });
      setEntrees((affichees) => fusionnerEntrees(page.entries, affichees));
      setAvant(page.hasMore ? page.previousCursor : undefined);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause));
    }
  }, [avant, paneId, tache.id]);

  return (
    <div className="tache-fil">
      {erreur === null ? null : (
        <Avis ton="erreur" annonce="alerte">
          Transcription illisible : {erreur}
        </Avis>
      )}
      {avant === undefined ? null : (
        <button type="button" className="rapport__plus" onClick={() => void plusAncien()}>
          Charger le début
        </button>
      )}
      {charge && items.length === 0 && erreur === null ? (
        <p className="discret">Transcription vide pour l'instant.</p>
      ) : null}
      {items.map((item) => (
        <ElementFil
          key={item.kind === "tools" ? item.id : item.message.id}
          item={item}
          enCours={false}
          cwd={cwd}
          maintenant={maintenant}
          onOuvrirFichier={onOuvrirFichier}
        />
      ))}
    </div>
  );
};

export const Taches = ({
  paneId,
  cwd,
  onClose,
  onOuvrirFichier,
}: {
  readonly paneId: string;
  readonly cwd: string | null;
  readonly onClose: () => void;
  readonly onOuvrirFichier: (chemin: string) => void;
}) => {
  const [taches, setTaches] = useState<ReadonlyArray<BackgroundTask> | null>(null);
  const [prise, setPrise] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<BackgroundTask | null>(null);
  const maintenant = useMaintenant(1_000);
  const retour = useMemo(
    () => ({ action: () => setOuverte(null), libelle: "Retour aux tâches de fond" }),
    [],
  );

  useEffect(() => {
    let vivant = true;
    const lit = async () => {
      try {
        const reponse = await fetchTaches(paneId);
        if (!vivant) return;
        setErreur(null);
        setPrise(reponse.supported);
        setTaches(reponse.tasks);
      } catch (cause) {
        if (vivant) setErreur(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void lit();
    const minuterie = window.setInterval(() => void lit(), RELECTURE_MS);
    return () => {
      vivant = false;
      window.clearInterval(minuterie);
    };
  }, [paneId]);

  // La tâche ouverte suit la liste : son état change pendant qu'on la lit.
  const courante =
    ouverte === null ? null : (taches?.find((tache) => tache.id === ouverte.id) ?? ouverte);

  if (courante !== null) {
    return (
      <Feuille titre={courante.description ?? courante.id} onClose={onClose} large retour={retour}>
        <p className="tache__meta tache__meta--tete">
          <FormeTache status={courante.status} />{" "}
          {[sorteDeTache(courante), STATUT_TACHE[courante.status].mot].join(" · ")} · lecture seule
        </p>
        <Transcription
          paneId={paneId}
          tache={courante}
          cwd={cwd}
          onOuvrirFichier={onOuvrirFichier}
        />
      </Feuille>
    );
  }

  return (
    <Feuille titre="Tâches de fond" onClose={onClose}>
      {erreur === null ? null : (
        <Avis ton="erreur" annonce="alerte">
          Tâches illisibles : {erreur}
        </Avis>
      )}
      {!prise ? (
        <p className="discret">Cet agent n'expose pas de tâches de fond lisibles.</p>
      ) : taches === null ? (
        erreur === null ? (
          <p className="discret">Lecture…</p>
        ) : null
      ) : taches.length === 0 ? (
        <p className="discret">Aucune tâche de fond dans cette session.</p>
      ) : (
        <ul className="taches">
          {taches.map((tache) => (
            <LigneTache
              key={tache.id}
              tache={tache}
              maintenant={maintenant}
              onOuvrir={setOuverte}
            />
          ))}
        </ul>
      )}
    </Feuille>
  );
};
