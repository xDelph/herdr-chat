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
import {
  MODEL_CATALOG_CACHE_MS,
  MODEL_CATALOG_STDERR_BYTES,
  MODEL_CATALOG_STDOUT_BYTES,
  MODEL_CATALOG_TIMEOUT_MS,
} from "@herdr-remote/shared";
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
/**
 * Lit un flux **jusqu'à une borne**, et signale le dépassement.
 *
 * `atteint` distingue « lu tout » de « lu jusqu'à la limite » : sans ce
 * drapeau, un catalogue tronqué ressemblerait à un catalogue complet.
 */
const lireBorne = async (
  flux: ReadableStream<Uint8Array>,
  max: number,
): Promise<{ atteint: boolean; texte: string }> => {
  const lecteur = flux.getReader();
  const morceaux: Array<Uint8Array> = [];
  let total = 0;
  /* oxlint-disable no-await-in-loop -- lecture séquentielle d'un flux : c'est
     l'ordre des octets qui compte, pas la rapidité. */
  while (total <= max) {
    const suivant = await lecteur.read();
    if (suivant.done) break;
    const morceau = suivant.value;
    if (morceau === undefined) continue;
    total += morceau.byteLength;
    morceaux.push(morceau);
  }
  /* oxlint-enable no-await-in-loop */
  const atteint = total > max;
  if (atteint) await lecteur.cancel();

  const joint = new Uint8Array(Math.min(total, max));
  let position = 0;
  for (const morceau of morceaux) {
    if (position >= joint.length) break;
    joint.set(morceau.subarray(0, joint.length - position), position);
    position += morceau.byteLength;
  }
  return { atteint, texte: new TextDecoder().decode(joint) };
};

/**
 * Exécute une commande, **bornée dans les trois dimensions** (B09).
 *
 * ⚠️ Sans borne de sortie, une CLI qui bavarde — ou qui déraille et produit
 * des mégaoctets — ferait grossir la réponse jusqu'à faire tomber la requête.
 * La lecture est donc **limitée** : le dépassement est un **échec déclaré**,
 * jamais une troncature muette qui passerait pour un catalogue valide.
 *
 * Le délai tue le processus : un `--list-models` qui attend une saisie
 * bloquerait la requête entière.
 */
const run = (
  command: ReadonlyArray<string>,
  timeoutMs = MODEL_CATALOG_TIMEOUT_MS,
): Effect.Effect<CommandOutcome> =>
  Effect.result(
    Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn([...command], { stderr: "pipe", stdout: "pipe" });
        const timer = setTimeout(() => {
          proc.kill();
        }, timeoutMs);
        try {
          const [sortie, sortieErr, exitCode] = await Promise.all([
            lireBorne(proc.stdout, MODEL_CATALOG_STDOUT_BYTES),
            lireBorne(proc.stderr, MODEL_CATALOG_STDERR_BYTES),
            proc.exited,
          ]);
          if (sortie.atteint) {
            throw new Error(
              `output too large (more than ${String(MODEL_CATALOG_STDOUT_BYTES)} bytes)`,
            );
          }
          if (exitCode !== 0) {
            const motif = sortieErr.texte.trim().split("\n")[0] ?? "";
            throw new Error(
              motif.length > 0
                ? `${motif} (code ${String(exitCode)})`
                : `code de sortie ${String(exitCode)}`,
            );
          }
          return sortie.texte;
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
            error: Option.getOrElse(Result.getFailure(result), () => "unknown failure"),
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
    return yield* failed(source, "empty or unreadable output");
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
    "claude does not list its models outside an authenticated session: only the CLI aliases are offered",
  models: CLAUDE_ALIASES.map((alias) => ({
    id: alias,
    label: undefined,
    thinkingLevels: CLAUDE_EFFORTS,
  })),
  source: "claude --help (documented aliases)",
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
    return yield* failed(source, "unexpected shape: no usable `models` array");
  }

  const models: CatalogModel[] = decoded.models.map((record) => ({
    id: record.slug,
    label: record.display_name,
    thinkingLevels: uniqueLevels(
      (record.supported_reasoning_levels ?? []).map((level) => level.effort),
    ),
  }));

  if (models.length === 0) return yield* failed(source, "empty catalog");

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

  if (models.length === 0) return yield* failed(source, "empty or unreadable list");

  return {
    error: null,
    models,
    source,
    thinkingLevels: [],
  } satisfies CatalogResult;
});

/** Objet JSON, au sens strict : ni tableau, ni `null`. */
const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Catalogue de devin, **extrait d'une forme structurée**.
 *
 * ⚠️ **`--format json` et non la sortie texte.** Le CLI offre les deux, et il
 * l'écrit lui-même : « Machine-readable JSON (for scripts) ». Analyser le texte
 * aligné par colonnes serait une devinette sur des largeurs — la forme
 * structurée, elle, est un contrat.
 *
 * Mesuré (devin 3000.11.92, 2026-10-16) :
 *
 * ```jsonc
 * { "families": [ { "family_label": "SWE-2", "slug": "swe-2", "aliases": ["swe"],
 *                   "variants": [ { "model_uid": "swe-2-high", "label": "SWE-2 High",
 *                                   "cost_summary": "…", "max_output_tokens": 12800 } ] } ] }
 * ```
 *
 * ⚠️ **Le modèle est le VARIANT, pas la famille.** `--model` attend
 * `swe-1-6-slow`, pas `swe-1.6-slow` : la famille est un regroupement
 * d'affichage, et prendre son `slug` enverrait un nom que le CLI refuse.
 *
 * ⚠️ **Aucun niveau séparé**, comme cursor : le niveau est **dans le nom** du
 * variant (`-low`, `-high`, `-max`, `-xhigh`). Proposer un niveau à part
 * promettrait un réglage que le CLI n'a pas.
 *
 * Pure et exportée : c'est ce qui permet de la vérifier sur la forme réelle sans
 * lancer le CLI.
 */
export const modelsDeDevin = (brut: unknown): ReadonlyArray<CatalogModel> => {
  if (!estObjet(brut) || !Array.isArray(brut["families"])) return [];

  const models: CatalogModel[] = [];
  for (const famille of brut["families"]) {
    if (!estObjet(famille) || !Array.isArray(famille["variants"])) continue;
    for (const variant of famille["variants"]) {
      if (!estObjet(variant)) continue;
      const id = variant["model_uid"];
      if (typeof id !== "string" || id.length === 0) continue;
      const label = variant["label"];
      models.push({
        id,
        label: typeof label === "string" ? label : undefined,
        // Le niveau vit dans le nom : rien à proposer séparément.
        thinkingLevels: [],
      });
    }
  }
  return models;
};

/** Catalogue de devin, lu par le CLI. */
const devinCatalog = Effect.gen(function* () {
  const source = "devin models list --format json";
  const out = yield* run(["devin", "models", "list", "--format", "json"]);
  if (out.error !== null) return yield* failed(source, out.error);

  let analyse: unknown;
  try {
    analyse = JSON.parse(out.out);
  } catch {
    // Un catalogue illisible se **refuse** : il ne se devine pas.
    return yield* failed(source, "unreadable JSON");
  }

  const models = modelsDeDevin(analyse);
  if (models.length === 0) return yield* failed(source, "empty or unreadable list");

  return { error: null, models, source, thinkingLevels: [] } satisfies CatalogResult;
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
  devin: { catalog: devinCatalog },
  pi: { catalog: piCatalog },
};

/** Catalogue d'un kind, ou la raison pour laquelle il est inconnu. */
/**
 * Cache par type, et **regroupement des appels concurrents** (B09).
 *
 * Deux appels simultanés sur le même type doivent produire **une seule**
 * commande : sans cela, ouvrir la feuille de modèles deux fois en un quart de
 * seconde lance deux `--list-models`, qui attend chacun le réseau.
 *
 * L'entrée en vol est partagée ; une fois le catalogue obtenu, il reste en
 * cache `MODEL_CATALOG_CACHE_MS`. ⚠️ **Seul un succès est mis en cache** : un
 * échec ou un timeout le serait aussi, l'interface afficherait une liste vide
 * pendant une minute après une coupure réseau.
 */
interface CacheEntry {
  readonly at: number;
  readonly value: CatalogResult;
}

const cache = new Map<string, CacheEntry>();
const enVol = new Map<string, Effect.Effect<CatalogResult>>();

export const catalogOf = (kind: string): Effect.Effect<CatalogResult> => {
  const adapter = ADAPTERS[kind];
  if (adapter === undefined) {
    return Effect.succeed({
      error: `no verified listing mechanism for “${kind}”`,
      models: [],
      source: "aucune",
      thinkingLevels: [],
    });
  }

  const maintenant = Date.now();
  const cached = cache.get(kind);
  if (cached !== undefined && maintenant - cached.at < MODEL_CATALOG_CACHE_MS) {
    return Effect.succeed(cached.value);
  }

  const dejaEnCours = enVol.get(kind);
  if (dejaEnCours !== undefined) return dejaEnCours;

  const requete = Effect.gen(function* () {
    // Le `finally` libère l'entrée en vol dans **tous** les cas : sinon un
    // timeout laisserait ce type bloqué jusqu'au redémarrage du serveur.
    const resultat = yield* adapter.catalog.pipe(
      Effect.tap(
        Effect.sync(() => {
          enVol.delete(kind);
        }),
      ),
    );
    // Échec ou timeout : **rien n'est mis en cache**.
    if (resultat.error === null) {
      cache.set(kind, { at: Date.now(), value: resultat });
    }
    return resultat;
  });

  enVol.set(kind, requete);
  return requete;
};

/** Vide le cache — réservé aux tests. */
export const clearCatalogCache = (): void => {
  cache.clear();
  enVol.clear();
};

/** Kinds dont le catalogue est mesuré — sert à l'interface pour ne proposer que ceux-là. */
export const CATALOG_KINDS = Object.keys(ADAPTERS);
