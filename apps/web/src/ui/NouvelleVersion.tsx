/**
 * « Nouvelle version — recharger » : discret, non bloquant, et absent tant
 * qu'un brouillon ou un envoi attend (recharger les effacerait).
 */
import { useEffect, useSyncExternalStore } from "react";
import { envois, version } from "../app/services.ts";
import { unBrouillonExiste } from "../brouillons.ts";

const jamais = () => false;

export const NouvelleVersion = () => {
  const nouvelle = useSyncExternalStore(version.souscrire, version.nouvelle, jamais);
  // Relu à chaque changement d'envoi ; le brouillon est relu au rendu.
  const enAttente = useSyncExternalStore(envois.souscrire, envois.enAttente, jamais);

  useEffect(() => {
    if (import.meta.env.DEV) return undefined;
    const verifie = () => {
      if (document.visibilityState === "visible") void version.verifie();
    };
    verifie();
    document.addEventListener("visibilitychange", verifie);
    window.addEventListener("focus", verifie);
    return () => {
      document.removeEventListener("visibilitychange", verifie);
      window.removeEventListener("focus", verifie);
    };
  }, []);

  if (!nouvelle || enAttente || unBrouillonExiste()) return null;
  return (
    <output className="nouvelle-version">
      New version available
      <button type="button" className="lien" onClick={() => window.location.reload()}>
        Reload
      </button>
    </output>
  );
};
