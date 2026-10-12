/**
 * Rendu des blocs d'un message.
 *
 * Chaque type a son traitement, décidé à partir d'un **census des sessions
 * réelles** (voir `blocks.ts`) : `bash` 3 964 appels, `edit` 801, `read` 499,
 * `write` 372. Un rendu générique unique obligerait à lire du JSON à l'écran
 * pour comprendre ce que l'agent a fait.
 */
import { createContext, memo, useCallback, useContext, useEffect, useState } from "react";
import { Schema } from "effect";
import { Option } from "effect";
import { Markdown } from "./Markdown.tsx";
import {
  actionDeBloc,
  coutDuGroupe,
  dureeEnMots,
  estBlocDeTravail,
  jetonsCourts,
  lignesDeTravail,
  resumeDuGroupe,
} from "./actions.ts";
import type { LigneTravail } from "./actions.ts";
import { fileUrl } from "./api.ts";

/**
 * Ouvre un fichier dans la visionneuse.
 *
 * Un contexte plutôt qu'une prop traversant trois niveaux : la fonction est
 * utilisée au fond de l'arbre (blocs → bulles → liste) et n'a rien à voir avec
 * les composants intermédiaires.
 */
export const FileOpenerContext = createContext<(path: string) => void>(() => undefined);

/** Ouvrir une image distante dans la visionneuse. */
export const UrlOpenerContext = createContext<(url: string) => void>(() => undefined);
import type { Block, Item, RenderedMessage } from "./blocks.ts";
import { Notice } from "./Notice.tsx";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Dernier segment d'un chemin.
 *
 * `…/apps/server/src/herdr/HerdrClient.ts` → `HerdrClient.ts`. Affiché tel
 * quel sur 375 px, le chemin prenait cinq lignes et masquait le nom du fichier.
 */
const baseName = (path: string): string => {
  const parts = path.split("/").filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  return last !== undefined && last.length > 0 ? last : path;
};

/**
 * La cible est-elle un chemin ?
 *
 * `ToolHead` sert aussi aux commandes shell, qui passent `timeout 400 ms` en
 * guise de cible : le réduire à son dernier segment donnerait « 400 ms ».
 */
const looksLikePath = (target: string): boolean => target.includes("/");

/**
 * Décode les arguments d'un outil.
 *
 * Déclaration de fonction, et non flèche générique : en `.tsx`, `<A>(…)` est lu
 * comme du JSX. Un `<` suivi d'un identifiant n'est pas un paramètre de type.
 */
function decodeArgs<S extends Parameters<typeof Schema.decodeUnknownOption>[0]>(
  schema: S,
  args: Readonly<Record<string, unknown>>,
): S["Type"] | undefined {
  return Option.getOrUndefined(Schema.decodeUnknownOption(schema)(args));
}

// ---------------------------------------------------------------------------
// Blocs de réflexion
// ---------------------------------------------------------------------------

/**
 * Réflexion du modèle.
 *
 * Repliée par défaut : elle est longue (3 218 blocs sur les sessions réelles) et
 * rarement ce qu'on vient lire. Un bloc **masqué** le dit explicitement plutôt
 * que d'afficher un vide inexpliqué.
 */
const ThinkingBlock = ({ block }: { block: Extract<Block, { kind: "thinking" }> }) => {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="blk blk--thinking"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span className="blk__tag">réflexion</span>
        {block.redacted ? (
          <span className="blk__hint">contenu masqué par le fournisseur</span>
        ) : null}
        {!block.redacted && !open ? (
          <span className="blk__preview">{block.thinking.slice(0, 90).replace(/\n/g, " ")}</span>
        ) : null}
      </summary>
      {block.redacted ? null : <Markdown source={block.thinking} />}
    </details>
  );
};

// ---------------------------------------------------------------------------
// Appels d'outils
// ---------------------------------------------------------------------------

const BashArgs = Schema.Struct({
  command: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
});

const EditArgs = Schema.Struct({
  edits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        newText: Schema.optional(Schema.String),
        oldText: Schema.optional(Schema.String),
      }),
    ),
  ),
  path: Schema.optional(Schema.String),
});

const WriteArgs = Schema.Struct({
  content: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
});

const ReadArgs = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  path: Schema.optional(Schema.String),
});

/**
 * En-tête commun : nom de l'outil + cible.
 *
 * La cible d'un fichier est réduite à **son nom**. Le chemin complet prenait
 * cinq lignes dans un bloc de 148 px, coupé en plein milieu des mots
 * (`/Users/thomas.delalonde/projects/pers` / `o/herdr-pwa/…`) : on ne lisait
 * plus le nom du fichier, qui est la seule chose utile à cet endroit. Le
 * chemin entier reste consultable dans la feuille « Fichiers ».
 */
const ToolHead = ({ name, target }: { name: string; target: string | null }) => (
  <div className="blk__head">
    <span className="blk__tag blk__tag--tool">{name}</span>
    {target !== null && target.length > 0 ? (
      <code className="blk__target">{looksLikePath(target) ? baseName(target) : target}</code>
    ) : null}
  </div>
);

/** Commande shell : présentée comme un terminal, pas comme du JSON. */
const BashCall = ({ args }: { args: Readonly<Record<string, unknown>> }) => {
  const decoded = decodeArgs(BashArgs, args);
  return (
    <div className="blk blk--tool blk--bash">
      <ToolHead name="bash" target={decoded?.timeout ? `timeout ${decoded.timeout} ms` : null} />
      <pre className="term">
        <span className="term__prompt">$ </span>
        {decoded?.command ?? ""}
      </pre>
    </div>
  );
};

/**
 * Édition de fichier.
 *
 * Rendu en **diff** : les lignes retirées en rouge, les ajoutées en vert. Un
 * `oldText`/`newText` affiché en JSON brut est illisible dès qu'il dépasse deux
 * lignes, ce qui est le cas courant.
 */
const EditCall = ({ args }: { args: Readonly<Record<string, unknown>> }) => {
  const decoded = decodeArgs(EditArgs, args);
  const edits = decoded?.edits ?? [];
  const [open, setOpen] = useState(false);

  /*
    Comptage des lignes ajoutées et retirées.

    Sans elles, un en-tête replié ne dit rien : « edit » sur un chemin ne
    donne pas d'indication de la taille du changement. C'est le même chiffre
    que celui affiché dans la feuille « Fichiers ».
  */
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    removed += str(edit.oldText).split("\n").length;
    added += str(edit.newText).split("\n").length;
  }

  return (
    <div className="blk blk--tool blk--edit">
      <ToolHead name="edit" target={decoded?.path ?? null} />
      {/*
        Replié par défaut.

        Un diff d'édition peut faire cinquante lignes : déplié, il pousse
        hors de l'écran la réponse de l'agent, qui est ce qu'on vient lire.
        Le chemin reste visible — c'est l'information utile — et la diff
        s'ouvre au toucher.
      */}
      {edits.length > 0 ? (
        <button type="button" className="blk__toggle" onClick={() => setOpen((v) => !v)}>
          <span className="file__stats small">
            <span className="stat stat--add">+{String(added)}</span>
            <span className="stat stat--del">−{String(removed)}</span>
          </span>
          <span>{open ? "masquer la différence" : "voir la différence"}</span>
        </button>
      ) : null}
      {open
        ? edits.map((edit, index) => (
            // Clé dérivée du contenu : deux éditions différentes ne partagent jamais
            // la même clé, et une réédition du même bloc garde son état.
            <div
              key={`${str(edit.oldText).slice(0, 32)}->${str(edit.newText).slice(0, 32)}:${String(index)}`}
              className="diff"
            >
              {str(edit.oldText)
                .split("\n")
                .map((line, lineIndex) => (
                  <div
                    key={`o:${line}:${String(lineIndex)}`}
                    className="diff__line diff__line--del"
                  >
                    <span className="diff__sign">−</span>
                    {line}
                  </div>
                ))}
              {str(edit.newText)
                .split("\n")
                .map((line, lineIndex) => (
                  <div
                    key={`n:${line}:${String(lineIndex)}`}
                    className="diff__line diff__line--add"
                  >
                    <span className="diff__sign">+</span>
                    {line}
                  </div>
                ))}
            </div>
          ))
        : null}
      {edits.length === 0 ? <p className="blk__hint">édition sans contenu lisible</p> : null}
    </div>
  );
};

const WriteCall = ({ args }: { args: Readonly<Record<string, unknown>> }) => {
  const decoded = decodeArgs(WriteArgs, args);
  const content = decoded?.content ?? "";
  const [open, setOpen] = useState(false);
  return (
    <div className="blk blk--tool blk--write">
      <ToolHead name="write" target={decoded?.path ?? null} />
      <button type="button" className="blk__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "masquer" : `voir le contenu (${content.split("\n").length} lignes)`}
      </button>
      {open ? (
        <pre className="term term--file">
          <code>{content}</code>
        </pre>
      ) : null}
    </div>
  );
};

const ReadCall = ({ args }: { args: Readonly<Record<string, unknown>> }) => {
  const decoded = decodeArgs(ReadArgs, args);
  const range =
    decoded?.offset !== undefined || decoded?.limit !== undefined
      ? `lignes ${decoded.offset ?? 0}${decoded.limit !== undefined ? `–${String((decoded.offset ?? 0) + decoded.limit)}` : "+"}`
      : null;
  return (
    <div className="blk blk--tool">
      <ToolHead name="read" target={decoded?.path ?? null} />
      {range !== null ? <p className="blk__hint">{range}</p> : null}
    </div>
  );
};

/** Outil sans rendu dédié : arguments en JSON replié, jamais masqués. */
const GenericCall = ({ name, args }: { name: string; args: Readonly<Record<string, unknown>> }) => (
  <details className="blk blk--tool">
    <summary>
      <span className="blk__tag blk__tag--tool">{name}</span>
    </summary>
    <pre className="term term--json">
      <code>{JSON.stringify(args, null, 2)}</code>
    </pre>
  </details>
);

const ToolCallBlock = ({ block }: { block: Extract<Block, { kind: "toolCall" }> }) => {
  switch (block.name) {
    case "bash":
      return <BashCall args={block.arguments} />;
    case "edit":
      return <EditCall args={block.arguments} />;
    case "write":
      return <WriteCall args={block.arguments} />;
    case "read":
      return <ReadCall args={block.arguments} />;
    default:
      return <GenericCall args={block.arguments} name={block.name} />;
  }
};

// ---------------------------------------------------------------------------
// Résultats et exécutions
// ---------------------------------------------------------------------------

/**
 * Résultat d'outil.
 *
 * Un échec est **visuellement distinct** : confondre une sortie normale et une
 * erreur fait perdre du temps à qui relit une session.
 */
const ToolResultBlock = ({ block }: { block: Extract<Block, { kind: "toolResult" }> }) => {
  const lines = block.text.split("\n");
  const preview = lines.find((line) => line.trim().length > 0)?.slice(0, 80) ?? "";

  // ⚠️ Un échec est **déplié d'office**. Le replier derrière un résumé serait
  // masquer le seul élément qui demande une action.
  const [open, setOpen] = useState(block.isError);

  return (
    <div className={block.isError ? "blk blk--result blk--error" : "blk blk--result"}>
      <button
        type="button"
        className="blk__row"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <ToolHead name={block.toolName} target={block.isError ? "échec" : null} />
        {!open && preview.length > 0 ? <span className="blk__preview">{preview}</span> : null}
        {!open ? <span className="blk__hint">{lines.length} lignes</span> : null}
      </button>

      {open ? (
        block.text.trim().length > 0 ? (
          <pre className="term term--out">
            <code>{block.text}</code>
          </pre>
        ) : (
          <p className="blk__hint">aucune sortie</p>
        )
      ) : null}

      {block.images.map((image, index) => (
        <img
          key={`${image.mimeType}:${image.data.slice(0, 32)}:${String(index)}`}
          className="blk__image"
          src={`data:${image.mimeType};base64,${image.data}`}
          alt="contenu renvoyé par l'outil"
        />
      ))}
    </div>
  );
};

/**
 * Résultat de sous-agent.
 *
 * Pi rapporte une **structure riche** : agent, modèle, statut, fichiers
 * modifiés, résumé, auto-vérification, questions ouvertes. Tout cela était
 * jusqu'ici déversé en sortie brute — c'est-à-dire illisible.
 *
 * ⚠️ `status` et `digest.status` peuvent diverger. Les deux sont affichés :
 * choisir l'un des deux serait mentir sur l'état réel.
 */
const SubagentBlock = ({ block }: { block: Extract<Block, { kind: "subagent" }> }) => (
  <div className="blk blk--tool blk--subagent">
    <ToolHead name="subagent" target={`${block.mode} · ${String(block.results.length)}`} />
    {block.results.map((result) => (
      <div key={result.id} className="sa">
        <div className="sa__head">
          <strong>{result.agent}</strong>
          {result.model !== null ? <span className="sa__model">{result.model}</span> : null}
          <span className={`sa__status sa__status--${result.status}`}>{result.status}</span>
        </div>

        {/* Les deux statuts, côte à côte, quand ils divergent. */}
        {result.digest?.status !== null &&
        result.digest?.status !== undefined &&
        result.digest.status !== result.status ? (
          <p className="blk__hint">
            exécution : {result.status}
            {result.stopReason !== null ? ` (${result.stopReason})` : ""} · auto-évaluation :{" "}
            {result.digest.status}
          </p>
        ) : null}

        {result.digest?.summary !== null && result.digest?.summary !== undefined ? (
          <p className="sa__summary">{result.digest.summary}</p>
        ) : null}

        {result.digest !== null && result.digest.filesChanged.length > 0 ? (
          <ul className="sa__files">
            {result.digest.filesChanged.map((file) => (
              <li key={file} className="mono small">
                {file}
              </li>
            ))}
          </ul>
        ) : null}

        {result.digest?.verified !== null && result.digest?.verified !== undefined ? (
          <p className="sa__verified">
            <span className="blk__tag">vérifié</span> {result.digest.verified}
          </p>
        ) : null}

        {result.digest?.questions !== null &&
        result.digest?.questions !== undefined &&
        result.digest.questions !== "none" ? (
          <p className="sa__questions">question : {result.digest.questions}</p>
        ) : null}

        {result.errorMessage !== null ? <Notice ton="erreur">{result.errorMessage}</Notice> : null}
      </div>
    ))}
  </div>
);

/** Point où le contexte a été résumé — un repère, pas un message. */
const CompactionBlock = ({ block }: { block: Extract<Block, { kind: "compaction" }> }) => (
  <details className="blk blk--compaction">
    <summary>
      <span className="blk__tag">contexte résumé</span>
      {block.tokensBefore !== null ? (
        <span className="blk__hint">{block.tokensBefore.toLocaleString("fr-FR")} jetons</span>
      ) : null}
      <span className="blk__preview">{block.summary.slice(0, 80)}</span>
    </summary>
    {block.summary.length > 0 ? <Markdown source={block.summary} /> : null}
  </details>
);

/** Exécution shell directe : commande, sortie, code de retour. */
const BashExecutionBlock = ({ block }: { block: Extract<Block, { kind: "bashExecution" }> }) => (
  <div className="blk blk--bash-exec">
    <ToolHead
      name="shell"
      target={block.exitCode === null ? null : `code ${String(block.exitCode)}`}
    />
    <pre className="term">
      <span className="term__prompt">$ </span>
      {block.command}
    </pre>
    {block.output.trim().length > 0 ? (
      <pre className="term term--out">
        <code>{block.output}</code>
      </pre>
    ) : null}
    {block.cancelled ? <p className="blk__hint">commande interrompue</p> : null}
    {block.truncated ? <p className="blk__hint">sortie tronquée</p> : null}
  </div>
);

// ---------------------------------------------------------------------------

/**
 * Image désignée par un chemin : rendue **en ligne** et ouvrable.
 *
 * Un agent qui cite `/tmp/capture.png` doit la montrer — c'est tout l'objet de
 * cette application.
 */
const ImagePathBlock = ({ block }: { block: Extract<Block, { kind: "imagePath" }> }) => {
  const openFile = useContext(FileOpenerContext);
  const [failed, setFailed] = useState(false);

  if (failed) {
    // Le fichier peut avoir été déplacé ou supprimé : on le dit, on n'affiche
    // pas une image cassée.
    return <p className="blk__hint">image indisponible : {block.path}</p>;
  }

  return (
    <button type="button" className="inline-image" onClick={() => openFile(block.path)}>
      <img
        className="inline-image__img"
        src={fileUrl(block.path)}
        alt={block.path}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <span className="inline-image__path mono small">{block.path}</span>
    </button>
  );
};

/**
 * Image désignée par une URL.
 *
 * L'URL est aussi proposée en repli : si l'image ne charge pas — hôte éteint,
 * fichier déplacé — on ne laisse pas l'utilisateur devant un vide.
 */
const ImageUrlBlock = ({ block }: { block: Extract<Block, { kind: "imageUrl" }> }) => {
  const [failed, setFailed] = useState(false);
  // Le contexte ouvre la visionneuse : une URL distante s'y affiche comme une
  // image locale, sans quitter l'application.
  const openUrl = useContext(UrlOpenerContext);

  if (failed) {
    return (
      <a
        className="inline-image__path mono small"
        href={block.url}
        rel="noreferrer"
        target="_blank"
      >
        image indisponible — {block.url}
      </a>
    );
  }

  // ⚠️ Un `button`, pas un `<a>` : un lien ouvrait un **nouvel onglet**, donc on
  // sortait de l'application pour regarder une image.
  return (
    <button type="button" className="inline-image" onClick={() => openUrl(block.url)}>
      <img
        className="inline-image__img"
        src={block.url}
        alt={block.url}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <span className="inline-image__path mono small">{block.url}</span>
    </button>
  );
};

const ImageContentBlock = ({ block }: { block: Extract<Block, { kind: "image" }> }) => (
  <img
    className="blk__image"
    src={`data:${block.mimeType};base64,${block.data}`}
    alt="pièce jointe"
  />
);

/**
 * Rendu d'un bloc, mémoïsé.
 *
 * Un bloc ne se redessine que si **son contenu** change. Sans cela, taper dans
 * le composeur redessinait chaque bloc de chaque message.
 */
/**
 * Rendu **riche** d'un bloc : le détail d'une ligne.
 *
 * ⚠️ Nommé à part de `BlockView` pour une raison précise : la ligne compacte
 * affiche son détail en l'appelant. Si le détail repassait par `BlockView`, il
 * redeviendrait une ligne, qui redemanderait son détail — une boucle infinie.
 */
/**
 * Un bloc, dans un tableau stable.
 *
 * ⚠️ Le tableau est mémorisé **par bloc** : en créer un neuf à chaque rendu
 * ferait redessiner la ligne à chaque frappe dans le composeur.
 */
const unSeulCache = new WeakMap<Block, ReadonlyArray<Block>>();
const UN_SEUL_BLOC = (block: Block): ReadonlyArray<Block> => {
  const connu = unSeulCache.get(block);
  if (connu !== undefined) return connu;
  const neuf = [block];
  unSeulCache.set(block, neuf);
  return neuf;
};

export const BlockView = memo(({ block }: { block: Block }) => {
  /*
    ⚠️ **Par bloc, pas par message.** Une ligne compacte se décidait jusqu'ici au
    niveau du message entier — donc jamais pour `text + thinking + toolCall`, la
    forme la plus courante d'une session réelle (565 messages sur 1080 mesurés).
    La réflexion et les éditions y gardaient leur ancien bloc encadré.

    Une ligne se décide donc **bloc par bloc**, et le détail passe par
    `VueDetail` : sans cette séparation, la ligne afficherait son détail en
    repassant par elle-même.
  */
  if (estBlocDeTravail(block)) {
    return <LigneDeTravail action={actionDeBloc(block)} details={UN_SEUL_BLOC(block)} />;
  }

  return <VueDetail block={block} />;
});
BlockView.displayName = "BlockView";

const VueDetail = memo(({ block }: { block: Block }) => {
  switch (block.kind) {
    case "text":
      // Le texte du modèle est du markdown : il est rendu comme tel.
      return <Markdown source={block.text} />;
    case "thinking":
      return <ThinkingBlock block={block} />;
    case "toolCall":
      return <ToolCallBlock block={block} />;
    case "toolResult":
      return <ToolResultBlock block={block} />;
    case "bashExecution":
      return <BashExecutionBlock block={block} />;
    case "subagent":
      return <SubagentBlock block={block} />;
    case "compaction":
      return <CompactionBlock block={block} />;
    case "image":
      return <ImageContentBlock block={block} />;
    case "imagePath":
      return <ImagePathBlock block={block} />;
    case "imageUrl":
      return <ImageUrlBlock block={block} />;
    default:
      // Un type de bloc inconnu n'affiche rien plutôt que de casser le message.
      return null;
  }
});
VueDetail.displayName = "VueDetail";

// ---------------------------------------------------------------------------
// Groupes d'appels d'outils
// ---------------------------------------------------------------------------

/** Heure courte d'un horodatage ISO. Toute valeur illisible donne une chaîne vide. */
const timeOf = (iso: string | null): string => {
  if (iso === null) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

/** Une bulle : rôle, métadonnées, blocs. Mémoïsée. */
export const MessageBubble = memo(({ message }: { message: RenderedMessage }) => (
  <article className={`bubble bubble--${message.role}`}>
    {message.blocks.map((block, index) => (
      <BlockView key={`${message.id}-${String(index)}`} block={block} />
    ))}
    {/*
      Les métadonnées passent **sous** le contenu.

      ⚠️ Au-dessus, elles s'interposent entre le message précédent et celui
      qu'on commence à lire ; le rôle, le modèle et l'heure se lisent après coup,
      quand on se demande d'où vient ce qu'on vient de lire. C'est aussi l'ordre
      de la référence.
    */}
    {/*
      ⚠️ **Ni modèle ni jetons ici.** Le modèle ne dit rien de ce qu'on lit, et
      les jetons appartiennent au **travail** — ils vivent dans l'en-tête du
      groupe, sommés sur ce qui a été fait. Ici il ne reste que l'heure.
    */}
    <span className="bubble__role">{timeOf(message.at)}</span>
  </article>
));
MessageBubble.displayName = "MessageBubble";

/**
 * Suite d'appels d'outils, repliée en un résumé.
 *
 * Une session réelle alterne `assistant(toolCall)` → `toolResult` sur des
 * centaines de tours. Les afficher un par un rend la conversation illisible :
 * les décisions et les réponses disparaissent dans le bruit.
 *
 * ⚠️ Un groupe contenant une **erreur** s'ouvre **d'office**. Replier un échec
 * derrière un résumé reviendrait à le cacher.
 */
/**
 * Une ligne de travail : un appel, dépliable.
 *
 * ⚠️ **Repliée par défaut**, même quand le groupe est ouvert. Une commande, une
 * édition et une sortie dépliées d'office noient la ligne de résumé ; elles
 * s'ouvrent à la demande, une par une.
 */
const LigneDeTravail = ({ action, details }: Pick<LigneTravail, "action" | "details">) => {
  const [open, setOpen] = useState(false);
  const cible = action.cible;

  return (
    <div className="ligne">
      <button
        type="button"
        className="ligne__head"
        aria-expanded={open}
        onClick={() => setOpen((valeur) => !valeur)}
        disabled={details.length === 0}
      >
        <span className="ligne__icone" aria-hidden="true">
          {action.icone}
        </span>
        <span className="ligne__verbe">{action.singulier}</span>
        {cible === null ? null : action.estFichier ? (
          // Un chemin de fichier se souligne : il mène à quelque chose. Un
          // argument qui n'est pas un fichier ne promet pas d'ouverture.
          <span className="ligne__cible ligne__cible--lien">{cible}</span>
        ) : (
          <span className="ligne__cible mono">{cible}</span>
        )}
        {/*
          ⚠️ Le delta se tait quand il n'y a rien à mesurer : `+0 −0` sur une
          lecture laisserait croire à un changement constaté.
        */}
        {action.delta === null ? null : (
          <span className="ligne__delta">
            <span className="ligne__delta--plus">+{action.delta.added}</span>
            <span className="ligne__delta--moins">−{action.delta.removed}</span>
          </span>
        )}
      </button>
      {open && details.length > 0 ? (
        <div className="ligne__body">
          {details.map((block, index) => (
            <VueDetail key={`${String(index)}-${block.kind}`} block={block} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Un travail : « Working for » pendant, « Worked for » après.
 *
 * ⚠️ **Le dépliage suit l'état du travail.** Pendant, le groupe est ouvert —
 * on vient voir ce qui se passe, et la réflexion est dedans. À la fin, il se
 * **replie tout seul** : la réponse finale est ce qu'on veut lire, et un groupe
 * resté ouvert la repousserait hors de l'écran.
 *
 * Le repli est décidé par l'état, pas par un clic : `enCours` qui passe à
 * `false` referme. Un groupe qu'on a ouvert à la main sur un travail terminé le
 * reste, lui, parce que c'est un choix.
 */
const ToolGroup = ({
  item,
  enCours,
}: {
  item: Extract<Item, { kind: "tools" }>;
  enCours: boolean;
}) => {
  const [open, setOpen] = useState(enCours || item.hasError);
  const [toucheParUtilisateur, setToucheParUtilisateur] = useState(false);

  useEffect(() => {
    // L'utilisateur a tranché : l'état du travail ne revient plus dessus.
    if (toucheParUtilisateur) return;
    setOpen(enCours || item.hasError);
  }, [enCours, item.hasError, toucheParUtilisateur]);

  const basculer = useCallback(() => {
    setToucheParUtilisateur(true);
    setOpen((valeur) => !valeur);
  }, []);

  const lignes = lignesDeTravail(item.messages);
  const cout = coutDuGroupe(item.messages);
  const duree = dureeEnMots(cout.dureeMs ?? 0);
  const jetons = cout.jetons === null ? "" : jetonsCourts(cout.jetons);
  const resume = resumeDuGroupe(item.tools.map((outil) => outil.name));

  return (
    <div className={item.hasError ? "group group--error" : "group"}>
      <button type="button" className="group__head" onClick={basculer} aria-expanded={open}>
        {/* « Working » pendant, « Worked » après : le mot dit l'état, la durée
            dit le coût. */}
        <span className="group__titre">
          {enCours ? "En cours" : "A travaillé"}
          {duree.length > 0 ? ` ${duree}` : ""}
        </span>
        {resume.length > 0 ? <span className="group__resume">{resume}</span> : null}
        {/* ⚠️ Les jetons du **travail**, pas le cumul de la session. */}
        {jetons.length > 0 ? <span className="group__jetons">{jetons}</span> : null}
        {item.hasError ? <span className="group__flag">échec</span> : null}
      </button>

      {open ? (
        <div className="group__body">
          {lignes.map((ligne, index) => (
            <LigneDeTravail
              action={ligne.action}
              details={ligne.details}
              key={`${String(index)}-${ligne.action.icone}`}
            />
          ))}
          {lignes.length === 0 ? <p className="blk__hint">aucun appel enregistré</p> : null}
        </div>
      ) : null}
    </div>
  );
};

/** Rend une liste d'éléments de conversation. */
export const ItemsView = ({
  items,
  enCours = false,
}: {
  readonly items: ReadonlyArray<Item>;
  /** L'agent travaille-t-il en ce moment ? Décide du dépliage du dernier groupe. */
  readonly enCours?: boolean;
}) => (
  <>
    {items.map((item) =>
      item.kind === "single" ? (
        <MessageBubble key={item.message.id} message={item.message} />
      ) : (
        <ToolGroup key={item.id} item={item} enCours={enCours && item === items.at(-1)} />
      ),
    )}
  </>
);
