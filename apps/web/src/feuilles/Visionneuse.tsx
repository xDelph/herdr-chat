/**
 * La visionneuse : une image (zoom au toucher) ou un texte numéroté.
 *
 * Le serveur ne sert que les chemins sous les dossiers de travail des projets ;
 * un refus est affiché avec sa cause, jamais remplacé par un écran vide.
 */
import { useEffect, useMemo, useState } from "react";
import { Option, Schema } from "effect";
import { ApiErrorResponse } from "@herdr-remote/shared";
import { baseName, fileUrl, isImagePath } from "../api.ts";
import { Avis } from "../ui/atomes.tsx";
import { Feuille } from "../ui/Feuille.tsx";

const LIGNES_MAX = 4000;
const lireErreur = Schema.decodeUnknownOption(ApiErrorResponse);

const Texte = ({ chemin }: { readonly chemin: string }) => {
  const [texte, setTexte] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    void (async () => {
      try {
        const reponse = await fetch(fileUrl(chemin));
        if (!reponse.ok) {
          let corps: unknown;
          try {
            corps = await reponse.json();
          } catch {
            corps = undefined;
          }
          const lu = Option.getOrUndefined(lireErreur(corps));
          if (vivant) setErreur(lu?.error ?? `could not read the file (${String(reponse.status)})`);
          return;
        }
        const brut = await reponse.text();
        if (vivant) setTexte(brut);
      } catch (cause) {
        if (vivant) setErreur(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      vivant = false;
    };
  }, [chemin]);

  if (erreur !== null) return <Avis ton="erreur">{erreur}</Avis>;
  if (texte === null) {
    return <output className="discret">Loading…</output>;
  }
  const lignes = texte.split("\n");
  return (
    <>
      <pre className="code">
        {lignes.slice(0, LIGNES_MAX).map((ligne, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- numéro de ligne = identité
          <span key={index} className="code__ligne">
            <span className="code__no" aria-hidden="true">
              {index + 1}
            </span>
            {ligne}
            {"\n"}
          </span>
        ))}
      </pre>
      {lignes.length > LIGNES_MAX ? (
        <p className="discret">Only the first {LIGNES_MAX} lines are shown.</p>
      ) : null}
    </>
  );
};

export const Visionneuse = ({
  chemin,
  onClose,
  onRetour,
}: {
  readonly chemin: string;
  readonly onClose: () => void;
  readonly onRetour: (() => void) | undefined;
}) => {
  const [zoom, setZoom] = useState(false);
  const distant = /^https?:\/\//i.test(chemin);
  const nom = distant ? (chemin.split("/").pop() ?? chemin) : baseName(chemin);
  const source = distant ? chemin : fileUrl(chemin);
  const retour = useMemo(
    () => (onRetour === undefined ? undefined : { action: onRetour, libelle: "Back to files" }),
    [onRetour],
  );
  return (
    <Feuille titre={nom} onClose={onClose} large retour={retour}>
      <p className="mono discret visionneuse__chemin">{chemin}</p>
      {isImagePath(chemin) ? (
        <button
          type="button"
          className={zoom ? "visionneuse__image visionneuse__image--zoom" : "visionneuse__image"}
          onClick={() => setZoom((valeur) => !valeur)}
          aria-label={zoom ? "Zoom out" : "Zoom in"}
        >
          <img src={source} alt={nom} />
        </button>
      ) : (
        <Texte chemin={chemin} />
      )}
    </Feuille>
  );
};
