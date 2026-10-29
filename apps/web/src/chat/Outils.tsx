/**
 * Le travail d'un tour : des **lignes**, pas des blocs encadrés.
 *
 * ```
 * ▤ Lu        herdrchat/src/main.rs         176 l.
 * ✎ Modifié   herdrchat/src/main.rs         +4 −5   ← le diff s'ouvre sur place
 * ▸ Lancé     cargo test -p sessions        ✓
 * ```
 *
 * Verbe, cible en mono, résultat. Le détail (diff, sortie, réflexion) s'ouvre
 * au toucher, sur place. Un échec se marque sur SA ligne, jamais sur tout le
 * travail.
 */
import { memo, useState } from "react";
import {
  lignesDeTravail,
  regrouperCommandes,
  type LigneAffichee,
  type LigneCommande,
} from "../actions.ts";
import {
  commandeSansCd,
  commandTextOf,
  editionsDe,
  patchFilesOf,
  relativeWorkspacePath,
  type Block,
  type RenderedMessage,
} from "../blocks.ts";
import { Markdown } from "../Markdown.tsx";
import { Icone } from "../ui/Icone.tsx";

const LIGNES_SORTIE = 60;
const LIGNES_DIFF = 80;
const ETAPES_VISIBLES_EN_COURS = 4;

/** Un diff compact : rouge retiré, vert ajouté. */
export const Diff = ({
  editions,
}: {
  readonly editions: ReadonlyArray<{ readonly oldText: string; readonly newText: string }>;
}) => {
  const lignes: Array<{ readonly genre: "del" | "add" | "sep"; readonly texte: string }> = [];
  for (const [rang, edition] of editions.entries()) {
    if (rang > 0) lignes.push({ genre: "sep", texte: "…" });
    if (edition.oldText.length > 0) {
      for (const ligne of edition.oldText.split("\n")) lignes.push({ genre: "del", texte: ligne });
    }
    if (edition.newText.length > 0) {
      for (const ligne of edition.newText.split("\n")) lignes.push({ genre: "add", texte: ligne });
    }
  }
  const visibles = lignes.slice(0, LIGNES_DIFF);
  return (
    <div className="diff">
      {visibles.map((ligne, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- lignes de texte sans identité propre
        <div key={index} className={`diff__${ligne.genre}`}>
          {ligne.genre === "del" ? "−" : ligne.genre === "add" ? "+" : " "} {ligne.texte}
        </div>
      ))}
      {lignes.length > LIGNES_DIFF ? (
        <div className="diff__sep">… {String(lignes.length - LIGNES_DIFF)} lignes de plus</div>
      ) : null}
    </div>
  );
};

/** Une sortie de commande, repliée au-delà de 60 lignes. */
const Sortie = ({ texte, erreur }: { readonly texte: string; readonly erreur: boolean }) => {
  const [tout, setTout] = useState(false);
  const lignes = texte.replace(/\s+$/, "").split("\n");
  if (texte.trim().length === 0) return <p className="discret">Aucune sortie.</p>;
  const visibles = tout ? lignes : lignes.slice(0, LIGNES_SORTIE);
  return (
    <>
      <pre className={erreur ? "sortie sortie--erreur" : "sortie"}>{visibles.join("\n")}</pre>
      {lignes.length > LIGNES_SORTIE ? (
        <button type="button" className="lien" onClick={() => setTout((valeur) => !valeur)}>
          {tout ? "Replier" : `Afficher tout (${String(lignes.length)} lignes)`}
        </button>
      ) : null}
    </>
  );
};

const editionsDuBloc = (
  block: Extract<Block, { kind: "toolCall" }>,
): ReadonlyArray<{ readonly oldText: string; readonly newText: string }> => {
  const nom = block.name.toLowerCase();
  if (["exec", "exec_command", "apply_patch"].includes(nom)) {
    return patchFilesOf(commandTextOf(block.arguments) ?? "").flatMap((patch) => patch.edits);
  }
  if (nom === "write") {
    const contenu = block.arguments["content"];
    return typeof contenu === "string" ? [{ newText: contenu, oldText: "" }] : [];
  }
  return editionsDe(block.arguments);
};

const DetailBloc = ({ block }: { readonly block: Block }) => {
  switch (block.kind) {
    case "toolCall": {
      const editions = editionsDuBloc(block);
      if (editions.length > 0) return <Diff editions={editions} />;
      const commande = commandTextOf(block.arguments);
      if (commande !== undefined) return <pre className="sortie sortie--commande">{commande}</pre>;
      const nom = block.name.toLowerCase();
      if (["read", "grep", "glob"].includes(nom)) return null;
      return <pre className="sortie">{JSON.stringify(block.arguments, null, 2)}</pre>;
    }
    case "toolResult":
      return (
        <>
          <Sortie texte={block.text} erreur={block.isError} />
          {block.images.map((image) => (
            <img
              key={`${image.mimeType}:${image.data.slice(0, 32)}`}
              className="fil__image"
              src={`data:${image.mimeType};base64,${image.data}`}
              alt="Rendu de l'outil"
            />
          ))}
        </>
      );
    case "bashExecution":
      return (
        <>
          <pre className="sortie sortie--commande">{block.command}</pre>
          <Sortie texte={block.output} erreur={block.exitCode !== null && block.exitCode !== 0} />
          {block.cancelled ? <p className="discret">Commande interrompue.</p> : null}
          {block.truncated ? <p className="discret">Sortie tronquée par l'agent.</p> : null}
        </>
      );
    case "thinking":
      return <p className="reflexion">{block.thinking}</p>;
    case "compaction":
      return block.summary.length > 0 ? <Markdown source={block.summary} /> : null;
    case "subagent":
      return (
        <ul className="sous-agents">
          {block.results.map((resultat) => (
            <li key={resultat.id}>
              <strong>{resultat.agent}</strong>
              {resultat.model === null ? null : <span className="mono"> {resultat.model}</span>}
              <span className="discret"> · {resultat.status}</span>
              {resultat.digest?.summary ? <p>{resultat.digest.summary}</p> : null}
              {resultat.errorMessage === null ? null : (
                <p className="issue issue--erreur">{resultat.errorMessage}</p>
              )}
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
};

/** Le résultat affiché à droite d'une ligne — mesuré, jamais deviné. */
const resultatDe = (
  ligne: LigneCommande,
): { readonly texte: string; readonly ton: "ok" | "err" | "neutre" } | "coche" | null => {
  if (ligne.enEchec) return { texte: "échec", ton: "err" };
  if (ligne.action.delta !== null) {
    return {
      texte: `+${String(ligne.action.delta.added)} −${String(ligne.action.delta.removed)}`,
      ton: "neutre",
    };
  }
  const bash = ligne.details.find((block) => block.kind === "bashExecution");
  if (bash?.kind === "bashExecution" && bash.exitCode !== null) {
    return bash.exitCode === 0 ? "coche" : { texte: `code ${String(bash.exitCode)}`, ton: "err" };
  }
  const sortie = ligne.details.find((block) => block.kind === "toolResult");
  if (sortie?.kind !== "toolResult") return null;
  const lignes = sortie.text.split("\n").filter((texte) => texte.trim().length > 0).length;
  if (ligne.action.icone === "file") return { texte: `${String(lignes)} l.`, ton: "neutre" };
  if (ligne.action.icone === "find") return { texte: String(lignes), ton: "neutre" };
  return "coche";
};

const LigneOutil = memo(
  ({
    ligne,
    cwd,
    onOuvrirFichier,
  }: {
    readonly ligne: LigneCommande;
    readonly cwd: string | null;
    readonly onOuvrirFichier: (chemin: string) => void;
  }) => {
    const [ouvert, setOuvert] = useState(false);
    const { action } = ligne;
    const cible =
      action.cible === null
        ? null
        : action.estFichier
          ? relativeWorkspacePath(action.cible, cwd)
          : commandeSansCd(action.cible, cwd);
    const resultat = resultatDe(ligne);
    const aDuDetail = ligne.details.length > 0;
    return (
      <div className={ligne.enEchec ? "outil outil--echec" : "outil"}>
        <button
          type="button"
          className="outil__ligne"
          aria-expanded={aDuDetail ? ouvert : undefined}
          disabled={!aDuDetail}
          onClick={() => setOuvert((valeur) => !valeur)}
        >
          <Icone nom={action.icone} petite />
          <span className="outil__principal">
            <span className="outil__verbe">{action.singulier}</span>
            {cible === null ? null : <span className="outil__cible">{cible}</span>}
          </span>
          {resultat === null ? null : resultat === "coche" ? (
            <span className="outil__res outil__res--ok" aria-label="réussi">
              <Icone nom="check" petite />
            </span>
          ) : (
            <span className={`outil__res outil__res--${resultat.ton} num`}>{resultat.texte}</span>
          )}
        </button>
        {action.estFichier && action.cible !== null ? (
          <button
            type="button"
            className="outil__fichier"
            aria-label={`Ouvrir ${cible ?? action.cible}`}
            onClick={() => onOuvrirFichier(action.cible ?? "")}
          >
            <Icone nom="file" petite />
          </button>
        ) : null}
        {ouvert ? (
          <div className="outil__detail">
            {ligne.details.map((block, index) => (
              <DetailBloc key={`${block.kind}-${String(index)}`} block={block} />
            ))}
          </div>
        ) : null}
      </div>
    );
  },
);
LigneOutil.displayName = "LigneOutil";

const SousGroupe = ({
  ligne,
  cwd,
  onOuvrirFichier,
}: {
  readonly ligne: Extract<LigneAffichee, { kind: "commands" }>;
  readonly cwd: string | null;
  readonly onOuvrirFichier: (chemin: string) => void;
}) => {
  const [ouvert, setOuvert] = useState(false);
  const echecs = ligne.commands.filter((commande) => commande.enEchec).length;
  return (
    <div className="outil outil--groupe">
      <button
        type="button"
        className="outil__ligne"
        aria-expanded={ouvert}
        onClick={() => setOuvert((valeur) => !valeur)}
      >
        <Icone nom={ligne.commands[0]?.action.icone ?? "term"} petite />
        <span className="outil__principal">
          <span className="outil__verbe">{ligne.libelle}</span>
          <span className="outil__cible outil__cible--texte">{ligne.commands.length}</span>
        </span>
        {echecs > 0 ? (
          <span className="outil__res outil__res--err num">
            {echecs} échec{echecs > 1 ? "s" : ""}
          </span>
        ) : (
          <Icone nom={ouvert ? "down" : "chev"} petite />
        )}
      </button>
      {ouvert ? (
        <div className="outil__sous">
          {ligne.commands.map((commande) => (
            <LigneOutil
              key={commande.cle}
              ligne={commande}
              cwd={cwd}
              onOuvrirFichier={onOuvrirFichier}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Le groupe de travail d'un tour.
 *
 * ⚠️ **Ouvert pendant le travail, replié ensuite — sauf si on a tranché.**
 * `manuel` vaut `null` tant que personne n'a touché l'en-tête : le groupe suit
 * l'état. Dès qu'on l'ouvre ou le ferme, la décision est humaine.
 */
export const GroupeOutils = memo(
  ({
    messages,
    enCours,
    cwd,
    onOuvrirFichier,
  }: {
    readonly messages: ReadonlyArray<RenderedMessage>;
    readonly enCours: boolean;
    readonly cwd: string | null;
    readonly onOuvrirFichier: (chemin: string) => void;
  }) => {
    const [manuel, setManuel] = useState<boolean | null>(null);
    const [toutes, setToutes] = useState(false);
    const ouvert = manuel ?? enCours;
    const lignes = regrouperCommandes(lignesDeTravail(messages));
    const actions = lignes.flatMap((ligne) =>
      ligne.kind === "commands" ? ligne.commands : ligne.kind === "action" ? [ligne] : [],
    );
    const echecs = actions.filter((ligne) => ligne.enEchec).length;
    if (lignes.length === 0) return null;
    const masquees =
      enCours && !toutes && lignes.length > ETAPES_VISIBLES_EN_COURS
        ? lignes.length - ETAPES_VISIBLES_EN_COURS
        : 0;
    return (
      <div className="outils">
        <button
          type="button"
          className="outils__tete"
          aria-expanded={ouvert}
          onClick={() => setManuel(!ouvert)}
        >
          <span className="num">
            {actions.length} action{actions.length > 1 ? "s" : ""}
          </span>
          {enCours ? (
            <span className="etat etat--work">
              <span className="spin" aria-hidden="true" />
              en cours
            </span>
          ) : echecs > 0 ? (
            <span className="etat outils__echec">
              {echecs} échec{echecs > 1 ? "s" : ""}
            </span>
          ) : (
            <span className="etat etat--ok">
              <Icone nom="check" petite />
              terminée{actions.length > 1 ? "s" : ""}
            </span>
          )}
          <span className={ouvert ? "outils__chevron outils__chevron--ouvert" : "outils__chevron"}>
            <Icone nom="chev" petite />
          </span>
        </button>
        {ouvert ? (
          <div className="outils__corps">
            {masquees > 0 ? (
              <button type="button" className="outils__plus" onClick={() => setToutes(true)}>
                {masquees} étape{masquees > 1 ? "s" : ""} précédente{masquees > 1 ? "s" : ""}
              </button>
            ) : null}
            {lignes
              .slice(masquees)
              .map((ligne) =>
                ligne.kind === "commands" ? (
                  <SousGroupe
                    key={ligne.cle}
                    ligne={ligne}
                    cwd={cwd}
                    onOuvrirFichier={onOuvrirFichier}
                  />
                ) : ligne.kind === "action" ? (
                  <LigneOutil
                    key={ligne.cle}
                    ligne={ligne}
                    cwd={cwd}
                    onOuvrirFichier={onOuvrirFichier}
                  />
                ) : null,
              )}
          </div>
        ) : null}
      </div>
    );
  },
);
GroupeOutils.displayName = "GroupeOutils";
