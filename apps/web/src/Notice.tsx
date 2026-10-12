/**
 * Un avis, et **la bonne annonce** pour un lecteur d'écran (U11).
 *
 * ⚠️ Il y avait dix-huit `<p className="notice notice--error">` dans
 * l'application, et **aucun** ne portait de rôle d'annonce. Un lecteur d'écran
 * passait dessus en silence : l'erreur s'affichait, elle ne se prononçait pas.
 *
 * Le rôle suit la gravité, et c'est tout le sujet du fichier :
 *
 * - `alerte` — une erreur. Annoncée **immédiatement**, même si le focus est
 *   ailleurs : c'est précisément le cas où l'utilisateur ne l'a pas demandée.
 * - `statut` — un avertissement ou une information. Annoncée **doucement**, à
 *   la suite : « cet agent attend une décision » ne doit pas interrompre une
 *   lecture en cours.
 *
 * ⚠️ Un avis d'erreur est annoncé **une fois**, à son apparition. Le contenu ne
 * doit donc pas changer tout seul — c'est pour ça que la fraîcheur s'affiche
 * en heure fixe (`heureLue`) et pas en « il y a 3 min », qui change à chaque
 * lecture et ferait répéter l'annonce en boucle.
 */
import type { ReactNode } from "react";

/** Gravité de l'avis. */
export type Ton = "neutre" | "avertissement" | "erreur";

const CLASSES: Record<Ton, string> = {
  neutre: "notice",
  avertissement: "notice notice--warn",
  erreur: "notice notice--error",
};

export const Notice = ({
  children,
  ton = "neutre",
}: {
  readonly children: ReactNode;
  readonly ton?: Ton;
}) => (
  <div className={CLASSES[ton]} role={ton === "erreur" ? "alert" : "status"}>
    {children}
  </div>
);
