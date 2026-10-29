/**
 * Les demandes en attente dans la file de l'agent — visibles dès leur envoi,
 * jusqu'à ce que l'agent les lise (`file-attente.ts`). Une demande déjà montrée
 * par une bulle d'envoi de ce téléphone n'est pas répétée.
 */
import { memo } from "react";
import type { DemandeEnFile } from "../file-attente.ts";

export const FileAttente = memo(
  ({
    demandes,
    dejaAffichees,
  }: {
    readonly demandes: ReadonlyArray<DemandeEnFile>;
    readonly dejaAffichees: ReadonlySet<string>;
  }) => {
    const visibles = demandes.filter((demande) => !dejaAffichees.has(demande.texte.trim()));
    if (visibles.length === 0) return null;
    return (
      <div className="envois">
        {visibles.map((demande, index) => (
          <div
            key={`${demande.depuis ?? ""}:${String(index)}`}
            className="moi moi--delivered moi--en-file"
            data-etat="queued-agent"
          >
            <p className="moi__texte">{demande.texte}</p>
            <output className="moi__etat">
              <span className="moi__file" aria-hidden="true" />
              Queued — the agent will read it at its next step
            </output>
          </div>
        ))}
      </div>
    );
  },
);
FileAttente.displayName = "FileAttente";
