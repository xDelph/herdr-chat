/**
 * La connexion au démon, **dans** la conversation.
 *
 * ⚠️ **Le défaut (P1).** Sur téléphone, la liste est cachée pendant le chat, et
 * avec elle le seul indicateur « En direct / Hors ligne ». Le fil pouvait être
 * figé depuis dix minutes sans que rien ne le dise. Ce bandeau compact dit la
 * même chose que l'indicateur de la liste (`connexion.ts`), avec la cause et
 * « Réessayer ». Sur grand écran, la liste reste visible : il s'efface (CSS).
 */
import { memo } from "react";
import { magasin } from "../app/services.ts";
import { useDonnees, useEnLigne, useMaintenant } from "../app/hooks.ts";
import { etatConnexion } from "../connexion.ts";
import { heureLue } from "../etats.ts";

const OUVERTURE = Date.now();

export const BandeauConnexion = memo(() => {
  const donnees = useDonnees();
  const enLigne = useEnLigne();
  // L'horloge ne bat que hors du direct : le démarrage doit pouvoir finir.
  const maintenant = useMaintenant(donnees.direct === "live" ? null : 5_000);
  const etat = etatConnexion({
    dernierSucces: donnees.dernierSucces,
    depuisOuverture: maintenant - OUVERTURE,
    direct: donnees.direct,
    enLigne,
    erreur: donnees.erreurs.conversations,
  });
  if (etat.phase === "direct") return null;

  const reessayer =
    etat.phase === "connexion" ? null : (
      <button
        type="button"
        className="lien bandeau-connexion__action"
        disabled={donnees.chargement}
        onClick={() => void magasin.rafraichit()}
      >
        {donnees.chargement ? "Lecture…" : "Réessayer"}
      </button>
    );

  return (
    <output className={`bandeau-connexion bandeau-connexion--${etat.phase}`}>
      {etat.phase === "hors-ligne" ? (
        <span>
          Hors ligne — dernière lecture à {heureLue(etat.dernierSucces) ?? "?"} · {etat.cause}
        </span>
      ) : etat.phase === "reconnexion" ? (
        <span>
          <span className="spin" aria-hidden="true" /> Reconnexion au direct… le fil peut avoir du
          retard.
        </span>
      ) : (
        <span>
          <span className="spin" aria-hidden="true" /> Connexion au démon…
        </span>
      )}
      {reessayer}
    </output>
  );
});
BandeauConnexion.displayName = "BandeauConnexion";
