/**
 * Les envois de ce pane qui ne sont pas encore dans la session.
 *
 * ⚠️ **Un envoi non confirmé n'est jamais affiché comme « envoyé ».** Cinq états,
 * cinq textes : en file (annulable), envoi, remis (Herdr l'a confirmé), remise
 * non confirmée (peut-être parti — réessayer est proposé), échec (refusé, avec
 * la cause). La bulle disparaît quand le texte apparaît dans la session : la
 * session est la preuve.
 *
 * ⚠️ **La cible est celle de l'envoi**, capturée à sa création (`envois.ts`) :
 * réessayer depuis ici repart vers CE pane, quel que soit l'écran.
 */
import { memo } from "react";
import { expliquerEchec } from "../etats-envoi.ts";
import type { Envoi } from "../envois.ts";
import { envois } from "../app/services.ts";

const etatDe = (envoi: Envoi): string => {
  switch (envoi.state) {
    case "queued":
      return "En file — part dans un instant";
    case "sending":
      return "Envoi…";
    case "delivered":
      return envoi.detail ?? "Remis à Herdr";
    case "uncertain":
      return envoi.failureState === null
        ? "Remise non confirmée par Herdr"
        : expliquerEchec(envoi.failureState, envoi.detail ?? "").texte;
    case "failed":
      return envoi.failureState === null
        ? `Échec : ${envoi.detail ?? "cause inconnue"}`
        : expliquerEchec(envoi.failureState, envoi.detail ?? "").texte;
  }
  return envoi.state;
};

export const Envois = memo(
  ({
    liste,
    onRemettre,
  }: {
    readonly liste: ReadonlyArray<Envoi>;
    /** Remet un texte dans le composeur (annulation, modification). */
    readonly onRemettre: (texte: string) => void;
  }) => {
    if (liste.length === 0) return null;
    return (
      <div className="envois">
        {liste.map((envoi) => (
          <div key={envoi.id} className={`moi moi--${envoi.state}`} data-etat={envoi.state}>
            <p className="moi__texte">{envoi.text}</p>
            <output className="moi__etat">
              {envoi.state === "sending" || envoi.state === "queued" ? (
                <span className="spin" aria-hidden="true" />
              ) : null}
              {etatDe(envoi)}
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
              {envoi.state === "uncertain" || envoi.state === "failed" ? (
                <button type="button" onClick={() => envois.reessaye(envoi.id)}>
                  {envoi.failureState === "inconnu" ? "Réessayer (doublon possible)" : "Réessayer"}
                </button>
              ) : null}
              {envoi.state === "failed" ? (
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
        ))}
      </div>
    );
  },
);
Envois.displayName = "Envois";
