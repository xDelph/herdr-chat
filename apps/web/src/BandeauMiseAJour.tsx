/**
 * Le bandeau « une nouvelle version est prête » (C21, T060).
 *
 * ⚠️ **Il ne recharge rien tout seul.** La mise à jour est une action
 * destructrice : elle efface le composeur et un envoi incertain. Le bouton est
 * donc **désactivé** tant qu'il reste un brouillon ou un envoi non résolu, et
 * la phrase dit POURQUOI — un bouton grisé sans explication est une impasse.
 */
import { useEffect, useState } from "react";
import { Notice } from "./Notice.tsx";
import { unBrouillonExiste } from "./brouillons.ts";
import { envoiEnCours } from "./envois-en-cours.ts";
import {
  appliquerMiseAJour,
  blocageDeMiseAJour,
  souscrireMiseAJour,
  texteDeMiseAJour,
  type Blocage,
} from "./mise-a-jour.ts";

export const BandeauMiseAJour = () => {
  // Les deux faits qui bloquent : un brouillon, un envoi non résolu.
  const [blocage, setBlocage] = useState<Blocage>("aucune");

  const relis = (): void => {
    setBlocage(
      blocageDeMiseAJour({
        brouillon: unBrouillonExiste(),
        envoi: envoiEnCours(),
      }),
    );
  };

  useEffect(() => {
    relis();
    // Le brouillon change à la frappe, l'envoi à l'issue d'un envoi : on
    // réévalue à chaque rendu du bandeau, et à chaque signal du store.
    const desabonner = souscrireMiseAJour(relis);
    return desabonner;
  });

  return (
    <Notice ton="avertissement">
      {texteDeMiseAJour(blocage)}{" "}
      <button
        type="button"
        disabled={blocage !== "aucune"}
        onClick={() => {
          appliquerMiseAJour({
            brouillon: unBrouillonExiste(),
            envoi: envoiEnCours(),
          });
        }}
      >
        Reload to update
      </button>
    </Notice>
  );
};
