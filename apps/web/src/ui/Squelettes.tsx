/**
 * Les écrans de chargement — des **squelettes** à la forme exacte de ce qui
 * arrive : la liste a ses lignes (logo, nom, texte, détails), le fil a ses
 * bulles, son texte et sa carte d'actions.
 *
 * ⚠️ **Retour du 2026-10-31 : « on manque de loading screen, surtout quand
 * l'app est installée sur l'écran d'accueil ».** Un texte « Loading… » au
 * milieu d'un écran vide fait croire à une page cassée ; un squelette dit ce
 * qui vient, à sa place, et le contenu le remplace sans que rien ne saute.
 *
 * Les largeurs sont FIXES (pas aléatoires) : le rendu serveur des tests et le
 * navigateur dessinent la même chose, et rien ne clignote d'un rendu à l'autre.
 * Le miroitement s'arrête si l'appareil demande moins d'animations.
 */
import { memo, type CSSProperties } from "react";

/** Les styles des os, construits une fois (les dimensions sont fixes). */
const STYLES = new Map<string, CSSProperties>();
const styleDe = (largeur: string, hauteur: number): CSSProperties => {
  const cle = `${largeur}|${String(hauteur)}`;
  const connu = STYLES.get(cle);
  if (connu !== undefined) return connu;
  const style: CSSProperties = { height: hauteur, width: largeur };
  STYLES.set(cle, style);
  return style;
};

/** Un os : une barre grise qui miroite. */
const Os = ({ largeur, hauteur = 12 }: { readonly largeur: string; readonly hauteur?: number }) => (
  <span className="os" style={styleDe(largeur, hauteur)} />
);

/** Les largeurs des lignes de la liste — variées, mais toujours les mêmes. */
const LIGNES: ReadonlyArray<readonly [string, string, string]> = [
  ["58%", "86%", "42%"],
  ["44%", "72%", "36%"],
  ["66%", "90%", "48%"],
  ["50%", "64%", "30%"],
  ["62%", "80%", "44%"],
  ["40%", "70%", "38%"],
];

/** La liste en attente de ses conversations. */
export const SqueletteListe = memo(({ libelle }: { readonly libelle: string }) => (
  <output className="squelette" aria-busy="true">
    <span className="sr">{libelle}</span>
    <div className="groupe" aria-hidden="true">
      <div className="groupe__tete">
        <Os largeur="68px" hauteur={10} />
      </div>
      <div className="lignes">
        {LIGNES.map(([nom, texte, details], rang) => (
          // L'ordre est fixe : le rang EST l'identité de la ligne.
          // oxlint-disable-next-line react/no-array-index-key
          <div key={rang} className="ligne ligne--squelette">
            <span className="os os--marque" />
            <Os largeur={nom} hauteur={13} />
            <Os largeur="34px" hauteur={10} />
            <span className="ligne__texte">
              <Os largeur={texte} />
            </span>
            <span className="ligne__details">
              <Os largeur={details} hauteur={10} />
            </span>
          </div>
        ))}
      </div>
    </div>
  </output>
));
SqueletteListe.displayName = "SqueletteListe";

/** Le fil en attente de ses messages : une demande, une réponse, des actions. */
export const SqueletteFil = memo(({ libelle }: { readonly libelle: string }) => (
  <output className="squelette squelette--fil" aria-busy="true">
    <span className="sr">{libelle}</span>
    <div className="squelette__bulle" aria-hidden="true">
      <Os largeur="100%" />
      <Os largeur="62%" />
    </div>
    <div className="squelette__texte" aria-hidden="true">
      <Os largeur="94%" />
      <Os largeur="88%" />
      <Os largeur="56%" />
    </div>
    <div className="squelette__carte" aria-hidden="true">
      <Os largeur="18px" hauteur={18} />
      <Os largeur="38%" />
    </div>
    <div className="squelette__texte" aria-hidden="true">
      <Os largeur="90%" />
      <Os largeur="72%" />
    </div>
    <div className="squelette__bulle squelette__bulle--courte" aria-hidden="true">
      <Os largeur="100%" />
    </div>
  </output>
));
SqueletteFil.displayName = "SqueletteFil";
