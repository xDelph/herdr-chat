/**
 * L'issue d'un geste, annoncée par un `<output>` (région « status »).
 *
 * Trois tons et jamais un « fait » sans preuve : `ok` (appliqué), `attention`
 * (parti, mais non confirmé), `erreur` (refusé — la cause est affichée telle
 * quelle).
 */
import type { EtatAction } from "../actions-locales.ts";

export const IssueAction = ({
  issue,
  enCours,
}: {
  readonly issue: EtatAction | undefined;
  readonly enCours: string;
}) => {
  if (issue === undefined) return null;
  if (issue.phase === "en-cours") {
    return <output className="issue">{enCours}</output>;
  }
  return <output className={`issue issue--${issue.ton}`}>{issue.texte}</output>;
};
