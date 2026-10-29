/**
 * Les envois de ce pane qui ne sont pas encore dans la session.
 *
 * ⚠️ **Un envoi non confirmé n'est jamais affiché comme « envoyé ».** Six états,
 * six textes : en file (annulable), envoi, remis (Herdr l'a confirmé), doublon
 * non envoyé (fermer ou modifier), remise non confirmée (peut-être parti —
 * renvoyer est proposé, avec le risque), échec (refusé, avec la cause). La bulle disparaît quand le texte apparaît dans la session : la
 * session est la preuve.
 *
 * ⚠️ **La cible est celle de l'envoi**, capturée à sa création (`envois.ts`) :
 * réessayer depuis ici repart vers CE pane, quel que soit l'écran.
 */
import { memo } from "react";
import { expliquerEchec, NON_ENVOYE_DOUBLON, type Explication } from "../etats-envoi.ts";
import type { Envoi } from "../envois.ts";
import { envois } from "../app/services.ts";

/** Ce que dit la bulle d'un message remis pendant que l'agent travaille. */
export const EN_ATTENTE_DE_LECTURE = "En attente : l'agent le lira à sa prochaine étape";

/**
 * Ce que dit la bulle, et le renvoi qu'elle propose (`action`, ou `null`).
 *
 * ⚠️ **Le bouton vient de l'explication, jamais d'ailleurs** : la bulle ne peut
 * plus annoncer « aucune action » et montrer « Réessayer » à côté.
 */
export const explicationDe = (envoi: Envoi, travaille: boolean): Explication => {
  switch (envoi.state) {
    case "queued":
      return { action: null, texte: "En file — part dans un instant" };
    case "sending":
      return { action: null, texte: "Envoi…" };
    case "delivered":
      /*
        ⚠️ **Remis n'est pas lu.** Pendant un tour, l'agent met le message en
        file et ne l'écrit dans sa session qu'à sa prochaine étape (Claude
        Code : `queued_command`). La bulle le dit, et reste jusqu'à ce que la
        session porte le texte.
      */
      return {
        action: null,
        texte: travaille ? EN_ATTENTE_DE_LECTURE : (envoi.detail ?? "Remis à Herdr"),
      };
    case "suppressed":
      // Rien n'est parti : ni « remis », ni « en attente ».
      return { action: null, texte: NON_ENVOYE_DOUBLON };
    case "uncertain":
      return envoi.failureState === null
        ? {
            // Herdr a pris le message sans confirmer la remise : renvoyer peut
            // doubler, et le bouton le dit.
            action: "Renvoyer (doublon possible)",
            texte: "Remise non confirmée par Herdr — le message est peut-être arrivé.",
          }
        : expliquerEchec(envoi.failureState, envoi.detail ?? "");
    case "failed":
      return envoi.failureState === null
        ? { action: "Réessayer", texte: `Échec : ${envoi.detail ?? "cause inconnue"}` }
        : expliquerEchec(envoi.failureState, envoi.detail ?? "");
  }
  return { action: null, texte: String(envoi.state) };
};

/** Le renvoi proposé, quand l'explication en propose un qui renvoie. */
const libelleRenvoi = (envoi: Envoi, explication: Explication): string | null => {
  if (envoi.state !== "uncertain" && envoi.state !== "failed") return null;
  // « Modifier le message » n'est pas un renvoi : il a son propre bouton.
  if (explication.action === null || explication.action === "Modifier le message") return null;
  return explication.action;
};

export const Envois = memo(
  ({
    liste,
    onRemettre,
    travaille = false,
  }: {
    readonly liste: ReadonlyArray<Envoi>;
    /** L'agent travaille : un message remis attend sa prochaine étape. */
    readonly travaille?: boolean;
    /** Remet un texte dans le composeur (annulation, modification). */
    readonly onRemettre: (texte: string) => void;
  }) => {
    if (liste.length === 0) return null;
    return (
      <div className="envois">
        {liste.map((envoi) => {
          const explication = explicationDe(envoi, travaille);
          const renvoi = libelleRenvoi(envoi, explication);
          const enFile = travaille && envoi.state === "delivered";
          return (
            <div
              key={envoi.id}
              className={`moi moi--${envoi.state}${enFile ? " moi--en-file" : ""}`}
              data-etat={envoi.state}
            >
              <p className="moi__texte">{envoi.text}</p>
              <output className="moi__etat">
                {envoi.state === "sending" || envoi.state === "queued" ? (
                  <span className="spin" aria-hidden="true" />
                ) : null}
                {enFile ? <span className="moi__file" aria-hidden="true" /> : null}
                {explication.texte}
                {envoi.state === "suppressed" && envoi.detail !== null && envoi.detail !== "" ? (
                  <small className="moi__cause">Herdr : {envoi.detail}</small>
                ) : null}
                {envoi.state === "queued" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const texte = envois.annule(envoi.id);
                      if (texte !== null) onRemettre(texte);
                    }}
                  >
                    Annuler
                  </button>
                ) : null}
                {renvoi === null ? null : (
                  <button type="button" onClick={() => envois.reessaye(envoi.id)}>
                    {renvoi}
                  </button>
                )}
                {envoi.state === "suppressed" ? (
                  <button type="button" onClick={() => envois.oublie(envoi.id)}>
                    Fermer
                  </button>
                ) : null}
                {envoi.state === "failed" || envoi.state === "suppressed" ? (
                  <button
                    type="button"
                    onClick={() => {
                      envois.oublie(envoi.id);
                      onRemettre(envoi.text);
                    }}
                  >
                    Modifier
                  </button>
                ) : null}
              </output>
            </div>
          );
        })}
      </div>
    );
  },
);
Envois.displayName = "Envois";
