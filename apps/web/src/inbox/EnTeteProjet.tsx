/**
 * Le détail d'un projet (`#/projet/<id>`) : ses agents, et « Nouvel agent ».
 *
 * ⚠️ **Parité.** L'ancienne app routait ce détail ; la réécriture gardait la
 * route mais n'affichait plus que la liste entière. Le détail est la liste,
 * **filtrée** sur ce projet, sous cet en-tête — un seul écran de lignes, pas
 * deux qui divergeraient.
 *
 * ⚠️ « Nouvel agent » reste possible même si le projet en a déjà un (D019.2) :
 * il crée un nouvel onglet ; rien n'est lancé sans ce geste.
 */
import { memo } from "react";
import { HOME } from "../routing.ts";
import { Avis } from "../ui/atomes.tsx";
import { Icone } from "../ui/Icone.tsx";

export const EnTeteProjet = memo(
  ({
    nom,
    existe,
    lu,
    onLancer,
  }: {
    readonly nom: string;
    /** Le projet est dans la dernière lecture d'Herdr. */
    readonly existe: boolean;
    /** Une lecture des projets a déjà réussi. */
    readonly lu: boolean;
    readonly onLancer: () => void;
  }) => (
    <div className="projet-tete">
      <a className="lien projet-tete__retour" href={HOME}>
        <Icone nom="back" petite /> Tous les agents
      </a>
      <div className="projet-tete__ligne">
        <h2>{nom}</h2>
        <button
          type="button"
          className="bouton bouton--principal"
          disabled={lu && !existe}
          onClick={onLancer}
        >
          <Icone nom="plus" petite /> Nouvel agent
        </button>
      </div>
      {lu && !existe ? (
        <Avis ton="attention" annonce="statut">
          Ce projet n'existe plus dans Herdr.
        </Avis>
      ) : null}
    </div>
  ),
);
EnTeteProjet.displayName = "EnTeteProjet";
