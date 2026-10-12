/**
 * Titre de section — libellé + filet, comme dans la référence.
 *
 * ⚠️ Le filet porte la **lecture** autant que le style : il aligne le regard
 * sur une même ligne de base d'un bout à l'autre de la liste, et il rend la
 * hiérarchie visible sans une seule bordure de séparation entre les lignes.
 *
 * Le compte est affiché seulement quand il est Multiple de 1 : « En cours (1) »
 * répète un chiffre que personne ne cherche, et allonge chaque titre.
 */
export const SectionTitle = ({
  children,
  count = 0,
}: {
  readonly children: string;
  readonly count?: number;
}) => (
  <h3 className="section">
    <span className="section__label">{children}</span>
    {count > 1 ? <span className="section__count">({String(count)})</span> : null}
    <span className="section__filet" aria-hidden="true" />
  </h3>
);
