/**
 * Catalogue de modèles par type d'agent — **mesuré, jamais codé en dur**.
 *
 * Chaque agent a son propre vocabulaire : ce que `pi` appelle `--thinking`,
 * Claude l'appelle `--effort`, Codex le prend par configuration, et Cursor
 * n'en a **pas** séparé du nom du modèle. Un adaptateur unique aurait été
 * faux pour les trois autres.
 *
 * Donc un adaptateur par kind, et chaque ligne de `ADAPTERS` porte la mesure
 * qui la justifie :
 *
 * | kind   | liste                              | niveaux                    |
 * |--------|------------------------------------|----------------------------|
 * | `pi`   | `pi --list-models`                 | colonne `thinking` du tableau |
 * | `claude`| `--help` + erreur d'argument       | `low, medium, high, max`   |
 * | `codex`| `codex debug models` (JSON)        | `supported_reasoning_levels` par modèle |
 * | `cursor`| `cursor-agent --list-models`       | **imbriqué dans le nom**   |
 *
 * ⚠️ Un kind absent de cette table n'est pas un bug : c'est la déclaration
 * qu'on ne sait pas encore lister ses modèles. L'API renvoie alors
 * `models: []` avec la raison, et l'interface affiche l'absence au lieu
 * d'inventer une liste (`AGENTS.md` — « ne pas exposer un état qu'on ne peut
 * pas vérifier »).
 */
import { Effect, Option, Result, Schema } from "effect";

/** Message d'échec d'une commande, lisible à l'écran. */

/** Un modèle d'agent, avant validation par le contrat partagé. */
export interface CatalogModel {
  readonly id: string;
  readonly label: string | undefined;
  readonly thinkingLevels: ReadonlyArray<string>;
}

export interface CatalogResult {
  readonly error: string | null;
  readonly models: ReadonlyArray<CatalogModel>;
  readonly source: string;
  readonly thinkingLevels: ReadonlyArray<string>;
}

interface Adapter {
  /** Catalogue, ou la raison de l'échec. */
  readonly catalog: Effect.Effect<CatalogResult>;
}

/** Sortie d'une commande, ou la raison de son échec. */
interface CommandOutcome {
  readonly error: string | null;
  readonly out: string;
}

/**
 * Exécute une commande et capture stdout.
 *
 * ⚠️ Jamais `stderr` comme sortie : une CLII qui écrit un avertissement sur
 * stderr ne doit pas produire un « catalogue » composé de son avertissement.
 * Un échec est **déclaré**, jamais silentieux.
 */
const run = (command: ReadonlyArray<string>, timeoutMs = 20_000): Effect.Effect<CommandOutcome> =>
  Effect.result(
    Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
        const timer = setTimeout(() => {
          proc.kill();
        }, timeoutMs);
        try {
          const [out, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            proc.exited,
          ]);
          if (exitCode !== 0) throw new Error(`code de sortie ${String(exitCode)}`);
          return out;
        } finally {
          clearTimeout(timer);
        }
      },
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    }),
  ).pipe(
    Effect.map((result) =>
      Result.isSuccess(result)
        ? {
            error: null,
            out: Option.getOrElse(Result.getSuccess(result), () => ""),
          }
        : {
            error: Option.getOrElse(Result.getFailure(result), () => "échec inconnu"),
            out: "",
          },
    ),
  );

/** Échec déclaratif : la source n'a pas répondu, et on le dit. */
const failed = (source: string, error: string): Effect.Effect<CatalogResult> =>
  Effect.succeed({ error, models: [], source, thinkingLevels: [] });

/** Réduit une liste de niveaux à l'ordre d'apparition, sans doublon. */
const uniqueLevels = (levels: Iterable<string>): ReadonlyArray<string> => [...new Set(levels)];

/**
 * Niveaux de Pi — relevés sur `pi --thinking` **et** confirmés par exécution
 * (`/thinking low` observé sur un pane jetable).
 */
const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * `pi --list-models` — sortie tabulaire mesurée :
 * `provider · model · context · max-out · thinking · images`.
 *
 * Le `model` contient déjà `provider/model` (ou `~provider/model` pour les
 * entrées latest), ce que `--model` attend.
 */
const piCatalog = Effect.gen(function* () {
  const source = "pi --list-models";
  const out = yield* run(["pi", "--list-models"]);
  if (out.error !== null) return yield* failed(source, out.error);

  const models: CatalogModel[] = [];
  for (const line of out.out.split("\n")) {
    const trimmed = line.trim();
    // La première ligne est l'en-tête ; elle ne décrit aucun modèle.
    if (trimmed.length === 0 || /^provider\s+model\s+context/.test(trimmed)) continue;

    // ⚠️ Découpage sur **2+ espaces** : le nom peut contenir un espace
    // interne (`Anthropic: Claude Opus 5`) et un découpage naïf le casserait.
    const columns = trimmed.split(/\s{2,}/).map((column: string) => column.trim());
    const id = columns[1];
    if (id === undefined || id.length === 0) continue;

    // La colonne `thinking` annonce la **capacité** du modèle, pas le niveau
    // courant : un modèle qui ne raisonne pas n'a aucun niveau à proposer.
    const supportsThinking = columns[4] === "yes";
    models.push({
      id: `${columns[0] ?? ""}/${id}`.replace(/^~\//, ""),
      // Le tableau de Pi ne porte aucun libellé lisible : on ne l'invente pas.
      label: undefined,
      thinkingLevels: supportsThinking ? PI_THINKING_LEVELS : [],
    });
  }

  if (models.length === 0) {
    return yield* failed(source, "sortie vide ou illisible");
  }
  return {
    error: null,
    models,
    source,
    thinkingLevels: PI_THINKING_LEVELS,
  } satisfies CatalogResult;
});

/**
 * Claude — `--model` accepte un **alias** (`sonnet`, `opus`, `haiku`) ou un
 * nom complet. Aucune commande ne liste les modèles sans être authentifié
 * (`claude models` → « Not logged in », mesuré).
 *
 * On propose donc les alias **documentés par le CLI lui-même**, en indiquant
 * que la liste complète n'est pas énumérable hors session.
 */
const CLAUDE_ALIASES = ["default", "sonnet", "opus", "haiku"] as const;

/** Valeurs de `--effort`, obtenues par une erreur d'argument mesurée. */
const CLAUDE_EFFORTS = ["low", "medium", "high", "max"] as const;

const claudeCatalog = Effect.sync((): CatalogResult => ({
  error:
    "claude n'énumère pas ses modèles hors session authentifiée : seuls les alias du CLI sont proposés",
  models: CLAUDE_ALIASES.map((alias) => ({
    id: alias,
    label: undefined,
    thinkingLevels: CLAUDE_EFFORTS,
  })),
  source: "claude --help (alias documentés)",
  thinkingLevels: CLAUDE_EFFORTS,
}));

/**
 * Codex — `codex debug models` rend le catalogue en JSON, avec
 * `supported_reasoning_levels` **par modèle**.
 *
 * C'est la source la plus fidèle du lot : elle donne exactement « quel niveau
 * pour quel modèle », sans rien déduire.
 */
/**
 * Forme utile de `codex debug models`.
 *
 * ⚠️ Décodée par `Schema`, jamais par assertion : un catalogue de fournisseur
 * qui change de forme doit produire une erreur lisible, pas un `undefined`
 * glissant trois lignes plus loin.
 */
const CodexCatalogPayload = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      display_name: Schema.optional(Schema.String),
      slug: Schema.String,
      supported_reasoning_levels: Schema.optional(
        Schema.Array(Schema.Struct({ effort: Schema.String })),
      ),
    }),
  ),
});

const codexCatalog = Effect.gen(function* () {
  const source = "codex debug models";
  const out = yield* run(["codex", "debug", "models"]);
  if (out.error !== null) return yield* failed(source, out.error);

  let parsed: unknown;
  try {
    parsed = JSON.parse(out.out);
  } catch (cause) {
    return yield* failed(
      source,
      `JSON illisible : ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(CodexCatalogPayload)(parsed));
  if (decoded === undefined) {
    return yield* failed(source, "forme inattendue : aucun tableau `models` exploitable");
  }

  const models: CatalogModel[] = decoded.models.map((record) => ({
    id: record.slug,
    label: record.display_name,
    thinkingLevels: uniqueLevels(
      (record.supported_reasoning_levels ?? []).map((level) => level.effort),
    ),
  }));

  if (models.length === 0) return yield* failed(source, "catalogue vide");

  return {
    error: null,
    models,
    source,
    // Union des niveaux de tous les modèles : un agent peut en accepter plus
    // selon le modèle, et c'est le lancement qui tranchera.
    thinkingLevels: uniqueLevels(models.flatMap((model) => model.thinkingLevels)),
  } satisfies CatalogResult;
});

/**
 * Cursor — **aucun paramètre de raisonnement séparé** : le niveau est encodé
 * dans le nom (`gpt-5.6-sol-high`, `claude-opus-5-thinking-xhigh`).
 *
 * On ne fabrique donc **aucun** `thinkingLevels` ici : le choisir, c'est
 * choisir un autre modèle. C'est mesuré sur `cursor-agent --help`, qui ne
 * documente que `--model`.
 */
const CURSOR_LEVEL_SUFFIX = /-(off|minimal|low|medium|high|xhigh|max|thinking)$/;

const cursorCatalog = Effect.gen(function* () {
  const source = "cursor-agent --list-models";
  const out = yield* run(["cursor-agent", "--list-models"]);
  if (out.error !== null) return yield* failed(source, out.error);

  const models: CatalogModel[] = [];
  for (const line of out.out.split("\n")) {
    const match = /^([\w.-]+)\s+-\s+(.+)$/.exec(line.trim());
    if (match === null) continue;
    const id = match[1];
    if (id === undefined) continue;
    models.push({
      id,
      label: match[2],
      // Le niveau est dans le nom : rien à proposer **séparément**.
      thinkingLevels: CURSOR_LEVEL_SUFFIX.test(id) ? [] : [],
    });
  }

  if (models.length === 0) return yield* failed(source, "liste vide ou illisible");

  return {
    error: null,
    models,
    source,
    thinkingLevels: [],
  } satisfies CatalogResult;
});

/**
 * Adaptateurs **vérifiés par exécution**.
 *
 * Un kind absent n'est pas une erreur de code : c'est « je ne sais pas encore ».
 * `catalogOf` le rend explicite pour que l'interface puisse le dire.
 */
const ADAPTERS: Readonly<Record<string, Adapter>> = {
  claude: { catalog: claudeCatalog },
  codex: { catalog: codexCatalog },
  cursor: { catalog: cursorCatalog },
  pi: { catalog: piCatalog },
};

/** Catalogue d'un kind, ou la raison pour laquelle il est inconnu. */
export const catalogOf = (kind: string): Effect.Effect<CatalogResult> => {
  const adapter = ADAPTERS[kind];
  if (adapter === undefined) {
    return Effect.succeed({
      error: `aucun mécanisme de listage vérifié pour « ${kind} »`,
      models: [],
      source: "aucune",
      thinkingLevels: [],
    });
  }
  return adapter.catalog;
};

/** Kinds dont le catalogue est mesuré — sert à l'interface pour ne proposer que ceux-là. */
export const CATALOG_KINDS = Object.keys(ADAPTERS);
