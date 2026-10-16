/**
 * Marque d'un agent — le logo qui precede le nom du projet, dans la liste des
 * conversations.
 *
 * ⚠️ **Ce sont les vraies marques**, recuperees a leur source et non
 * redessinees : `logos.tsx` porte l'adresse de chacune, et le detail de leurs
 * couleurs. Une imitation dessinee a la main ne ressemblerait pas au vrai logo —
 * donc elle tromperait — et reprendrait une marque sans droit.
 *
 * ⚠️ **Deux rendus, choisis dans les reglages.** « Standard » montre la marque
 * telle que son editeur la publie (c'est le defaut) ; « a la couleur du theme »
 * la dessine dans l'accent, ce qui rend la liste homogene mais fait perdre la
 * reconnaissance immediate. Le choix est un attribut sur `<html>`, et le CSS
 * ecrase les `fill` — les deux rendus sortent donc des **memes tracés**.
 *
 * ⚠️ **Decorative, et `aria-hidden` le dit.** Le type de l'agent est ecrit en
 * toutes lettres a cote du projet (la ligne de details porte `pi`, `claude`…) :
 * la marque aide a reconnaitre d'un coup d'oeil, elle n'est jamais le seul
 * porteur de l'information. Un lecteur d'ecran qui l'annoncerait dirait deux
 * fois la meme chose.
 *
 * ⚠️ **Le repli est neutre.** Un type inconnu — un agent dont on n'a pas encore
 * mesure le magasin — recoit un disque, jamais la marque d'un voisin : emprunter
 * un logo ferait croire a un type qu'on n'a pas verifie. Ce disque n'a pas de
 * `fill`, donc il suit `currentColor` dans les deux modes : il ne represente
 * aucune marque, il n'en suit aucune.
 */
import { LOGOS } from "./logos.tsx";

/**
 * Classe de la marque.
 *
 * ⚠️ Le type y est repris **tel que Herdr l'expose**, sans normalisation : c'est
 * ce qui permet de verifier dans le DOM quelle marque a ete rendue pour quel
 * type, sans passer par une image.
 */
export const classeDeMarque = (kind: string | null): string =>
  `agent-badge agent-badge--${kind ?? "inconnu"}`;

/** Le signe neutre, pour un type dont on n'a pas la marque. */
const NEUTRE = <circle cx="12" cy="12" r="9" />;

export const AgentBadge = ({ kind }: { readonly kind: string | null }) => (
  <span className={classeDeMarque(kind)} aria-hidden="true">
    {/*
      Les marques sont **deja normalisees** dans une boite de 24x24 par
      `logos.tsx` : le `viewBox` est donc le meme pour toutes, et la pastille ne
      change pas de taille d'un agent a l'autre.
    */}
    <svg fill="currentColor" viewBox="0 0 24 24">
      {LOGOS[kind ?? ""] ?? NEUTRE}
    </svg>
  </span>
);
