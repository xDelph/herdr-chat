/**
 * Contrat d'API — **une seule définition**, et elle vient du Rust (T057).
 *
 * Ce module existe à cause d'un bug réel : le handler `/api/health` omettait
 * `reachable` dans sa branche succès, alors que le schéma du client l'exigeait.
 * Le client échouait à décoder une réponse valide, et l'interface affichait
 * « Herdr injoignable » — un seul défaut, deux symptômes.
 *
 * La cause n'était pas le champ oublié : c'était d'avoir **deux définitions du
 * même contrat**, libres de diverger. Depuis T057, les schémas sont **générés
 * depuis les DTO Rust** (`cargo xtask contracts export` →
 * `generated/schemas.ts`) : le serveur sérialise avec, le client décode avec,
 * et un test de parité échoue si les deux s'écartent (C01).
 *
 * ⚠️ **Ce fichier ne garde QUE ce qui n'est pas un DTO de notre HTTP** :
 * - le codec de curseur (`SessionCursor` + helpers) — format interne du serveur ;
 * - les charges **amont Herdr** (`SnapshotPayload`, `PaneLayout`, `TabInfo`…),
 *   qui appartiennent au protocole d'Herdr, pas à notre API (TECH §5).
 */
import { Option, Schema } from "effect";
import { AgentInfo, WorkspaceInfo } from "./protocol.ts";

// ── Le contrat, généré depuis les DTO Rust (ne pas éditer ici) ──────────────
export * from "../generated/schemas.ts";

// Alias historiques : le client suffixait ses schémas (`AgentViewSchema`) et
// nommait `Choix` ce que le contrat appelle `Choice`. Les types gardent leur
// nom (`AgentView`, `WorkspaceView`, …) — seule la valeur porte le suffixe.
export { AgentView as AgentViewSchema } from "../generated/schemas.ts";
export { WorkspaceView as WorkspaceViewSchema } from "../generated/schemas.ts";
export { SessionEntry as SessionEntrySchema } from "../generated/schemas.ts";
export { RecentImage as RecentImageSchema } from "../generated/schemas.ts";
export { Choice as Choix } from "../generated/schemas.ts";

/**
 * Curseur opaque de lecture d'une session.
 *
 * ⚠️ **Opaque** : le client ne doit jamais le construire ni l'interpréter. Un
 * simple `offset` ne suffit pas, parce que le fichier peut avoir changé entre
 * deux appels — un numéro d'octet désigne alors un **autre** endroit, sans
 * erreur visible.
 *
 * Le triplet `dev`, `ino`, `offset` identifie le fichier **et** la position.
 * Une rotation (nouvel `ino`) ou un changement de device invalide donc le
 * curseur au lieu de renvoyer des entrées arbitraires.
 *
 * `offset` désigne toujours la position **après le dernier saut de ligne
 * complet** : une ligne partielle est conservée côté serveur et n'avance pas le
 * curseur.
 */
export const SessionCursor = Schema.Struct({
  dev: Schema.Number,
  ino: Schema.Number,
  offset: Schema.Number,
});
export type SessionCursor = typeof SessionCursor.Type;

/**
 * Rend un curseur **opaque** sur le réseau.
 *
 * L'encodage est base64 d'un JSON : lisible par un humain qui débogue, mais le
 * contrat n'impose pas ce format au client. Un jour de format pourra changer
 * sans casser les versions déployées.
 *
 * `null` si le triplet est incomplet — alors le client est traité comme
 * nouveau, ce qui vaut mieux qu'un curseur faux.
 */
export const encodeCursor = (cursor: SessionCursor): string => {
  const raw = JSON.stringify(cursor);
  return typeof btoa === "function"
    ? btoa(raw)
    : // Node sans `btoa` : mêmes alphabets, même résultat.
      Buffer.from(raw, "utf8").toString("base64");
};

/**
 * Décode un curseur. `undefined` si la chaîne est invalide — le caller doit
 * alors répondre 400, jamais deviner.
 */
export const decodeCursor = (encoded: string): SessionCursor | undefined => {
  let raw: string;
  try {
    raw =
      typeof atob === "function" ? atob(encoded) : Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(SessionCursor)(parsed));
  if (decoded === undefined) return undefined;
  // Un offset négatif ou un device absurde sont des casques : refusés ici,
  // sinon ils produiraient une lecture au hasard.
  if (!Number.isInteger(decoded.offset) || decoded.offset < 0) return undefined;
  return decoded;
};

/** Un onglet Herdr. `label` et `number` sont toujours présents côté Herdr. */
export const TabInfo = Schema.Struct({
  agent_status: Schema.optional(Schema.NullOr(Schema.String)),
  label: Schema.NullOr(Schema.String),
  number: Schema.Number,
  pane_count: Schema.optional(Schema.Number),
  tab_id: Schema.String,
  workspace_id: Schema.String,
});
export type TabInfo = typeof TabInfo.Type;

/**
 * Un pane du snapshot.
 *
 * `cwd` est **la** source du dossier de travail d'un projet : `worktree` est
 * souvent absent, alors que chaque pane en porte un.
 */
export const SnapshotPane = Schema.Struct({
  cwd: Schema.optional(Schema.NullOr(Schema.String)),
  pane_id: Schema.String,
  workspace_id: Schema.optional(Schema.String),
});
export type SnapshotPane = typeof SnapshotPane.Type;

/** Vue du snapshot Herdr telle que consommée par le serveur. */
/**
 * Un pane dans la disposition de son tab.
 *
 * ⚠️ **Les rectangles sont en cellules de terminal**, pas en pixels (mesuré :
 * `width: 190, height: 82` pour une fenêtre pleine). Ils servent donc à *situer*
 * et à *ordonner* — jamais à mesurer un écran.
 */
export const PaneLayoutRect = Schema.Struct({
  height: Schema.Number,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});

export const PaneLayoutPane = Schema.Struct({
  focused: Schema.Boolean,
  pane_id: Schema.String,
  rect: PaneLayoutRect,
});

/**
 * Disposition d'un tab — **déjà présente dans le snapshot** (`snapshot.layouts`).
 *
 * ⚠️ C'est ce qui rend le rang d'un pane gratuit : la route d'aperçu lit déjà le
 * snapshot, donc le calcul ne coûte aucun appel supplémentaire. Mesuré : 24
 * dispositions livrées d'un coup avec les agents.
 *
 * ⚠️ `splits` existe aussi côté Herdr et n'est **pas** décrit ici : on ne
 * déclare que ce qu'on lit. Un champ décrit mais inutilisé finit par laisser
 * croire qu'il sert.
 */
export const PaneLayout = Schema.Struct({
  focused_pane_id: Schema.String,
  panes: Schema.Array(PaneLayoutPane),
  tab_id: Schema.String,
  workspace_id: Schema.String,
  zoomed: Schema.Boolean,
});
export type PaneLayout = typeof PaneLayout.Type;

export const SnapshotPayload = Schema.Struct({
  agents: Schema.Array(AgentInfo),
  /**
   * ⚠️ **À déclarer explicitement.** Un `Schema.Struct` ne garde pas les champs
   * qu'il ne connaît pas : sans cette ligne, les dispositions seraient lues…
   * puis jetées au décodage, et le rang de chaque pane resterait inconnu sans
   * qu'aucune erreur ne le dise.
   */
  layouts: Schema.optional(Schema.Array(PaneLayout)),
  panes: Schema.optional(Schema.Array(SnapshotPane)),
  protocol: Schema.Number,
  tabs: Schema.optional(Schema.Array(TabInfo)),
  version: Schema.String,
  workspaces: Schema.Array(WorkspaceInfo),
});
export type SnapshotPayload = typeof SnapshotPayload.Type;
