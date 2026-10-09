/**
 * Rendu des blocs d'un message.
 *
 * Chaque type a son traitement, décidé à partir d'un **census des sessions
 * réelles** (voir `blocks.ts`) : `bash` 3 964 appels, `edit` 801, `read` 499,
 * `write` 372. Un rendu générique unique obligerait à lire du JSON à l'écran
 * pour comprendre ce que l'agent a fait.
 */
import { memo, useState } from "react";
import { Schema } from "effect";
import { Option } from "effect";
import { Markdown } from "./Markdown.tsx";
import type { Block } from "./blocks.ts";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

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

/** Entête commun : nom de l'outil + cible. */
const ToolHead = ({ name, target }: { name: string; target: string | null }) => (
  <div className="blk__head">
    <span className="blk__tag blk__tag--tool">{name}</span>
    {target !== null && target.length > 0 ? <code className="blk__target">{target}</code> : null}
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
  return (
    <div className="blk blk--tool blk--edit">
      <ToolHead name="edit" target={decoded?.path ?? null} />
      {edits.map((edit, index) => (
        // Clé dérivée du contenu : deux éditions différentes ne partagent jamais
        // la même clé, et une réédition du même bloc garde son état.
        <div
          key={`${str(edit.oldText).slice(0, 32)}->${str(edit.newText).slice(0, 32)}:${String(index)}`}
          className="diff"
        >
          {str(edit.oldText)
            .split("\n")
            .map((line, lineIndex) => (
              <div key={`o:${line}:${String(lineIndex)}`} className="diff__line diff__line--del">
                <span className="diff__sign">−</span>
                {line}
              </div>
            ))}
          {str(edit.newText)
            .split("\n")
            .map((line, lineIndex) => (
              <div key={`n:${line}:${String(lineIndex)}`} className="diff__line diff__line--add">
                <span className="diff__sign">+</span>
                {line}
              </div>
            ))}
        </div>
      ))}
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
const ToolResultBlock = ({ block }: { block: Extract<Block, { kind: "toolResult" }> }) => (
  <div className={block.isError ? "blk blk--result blk--error" : "blk blk--result"}>
    <ToolHead name={block.toolName} target={block.isError ? "échec" : null} />
    {block.text.trim().length > 0 ? (
      <pre className="term term--out">
        <code>{block.text}</code>
      </pre>
    ) : (
      <p className="blk__hint">aucune sortie</p>
    )}
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
export const BlockView = memo(({ block }: { block: Block }) => {
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
    case "image":
      return <ImageContentBlock block={block} />;
    default:
      // Un type de bloc inconnu n'affiche rien plutôt que de casser le message.
      return null;
  }
});
BlockView.displayName = "BlockView";
