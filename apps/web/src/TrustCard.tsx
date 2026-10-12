/**
 * Carte de confiance — la décision est **visible et nommée**.
 *
 * Un agent qui bloque au démarrage sur une invite de confiance ne doit pas
 * échouer en silence, ni être approuvé tout seul. L'utilisateur voit le nom du
 * dossier, ce que l'agent pourra y faire, et **choisit**.
 *
 * ⚠️ Pourquoi pas d'auto-oui : la confiance autorise l'agent à **exécuter du
 * code** dans le dossier, et elle est écrite durablement
 * (`~/.codex/config.toml`). Un agent lancé dans un dépôt qu'on vient de
 * cloner accordait cette permission sans que personne ne l'ait vue.
 */
import { useState } from "react";
import { answerTrust } from "./api.ts";
import type { TrustRequired } from "./api.ts";
import { Notice } from "./Notice.tsx";

interface Props {
  readonly request: TrustRequired;
  readonly onDone: () => void;
}

export const TrustCard = ({ request, onDone }: Props) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await answerTrust(request.paneId, accept);
      // Un refus côté serveur signifie que l'invite n'était plus là : on ne
      // prétend pas avoir répondu à la place de l'utilisateur.
      if (!outcome.accepted) setError(outcome.detail);
      else onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trust">
      <p className="trust__title">
        <strong>{request.kind}</strong> demande la confiance de « {request.folder} »
      </p>
      <p className="trust__warn">
        Il pourra y <strong>lire, écrire et exécuter du code</strong> — y compris sans te demander
        confirmation à chaque fois. Cette réponse est <strong>enregistrée définitivement</strong>{" "}
        sur cette machine.
      </p>
      {error !== null ? <Notice ton="erreur">{error}</Notice> : null}
      <div className="trust__actions">
        <button
          type="button"
          className="row__action row__action--primary"
          disabled={busy}
          onClick={() => void answer(true)}
        >
          {busy ? "…" : "Faire confiance"}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          // ⚠️ Refuser n'est pas un échec : l'agent reste simplement bloqué,
          // et rien n'est écrit dans la configuration.
          onClick={() => void answer(false)}
        >
          Refuser
        </button>
      </div>
    </div>
  );
};
