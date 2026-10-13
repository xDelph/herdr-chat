/**
 * Contrat d'API — **définition unique** des réponses du backend.
 *
 * Ce module existe à cause d'un bug réel : le handler `/api/health` du serveur
 * omettait `reachable` dans sa branche succès, alors que le schéma du client
 * l'exigeait. Le client échouait donc à décoder une réponse valide, et
 * l'interface affichait « Herdr injoignable » — un seul défaut, deux symptômes,
 * et rien pour le détecter.
 *
 * La cause n'était pas le champ oublié : c'était d'avoir **deux définitions du
 * même contrat**, une côté serveur et une côté client, libres de diverger.
 *
 * Désormais : le serveur **produit** selon ces schémas, le client **décode**
 * selon les mêmes, et un test de contrat échoue si l'un des deux s'en écarte.
 */
import { Option, Schema } from "effect";
import { AgentInfo, AgentStatus, WorkspaceInfo } from "./protocol.ts";

/** État du backend **et** joignabilité d'Herdr. */
export const HealthResponse = Schema.Struct({
  herdr: Schema.Struct({
    /** Absent quand Herdr est injoignable : on ne prétend pas connaître la version. */
    protocol: Schema.optional(Schema.Number),
    reachable: Schema.Boolean,
    socket: Schema.String,
    version: Schema.optional(Schema.String),
  }),
  /** Chemin du journal d'erreurs, pour le retrouver vite. */
  log: Schema.optional(Schema.String),
  ok: Schema.Boolean,
  uptimeMs: Schema.optional(Schema.Number),
});
export type HealthResponse = typeof HealthResponse.Type;

export const AgentViewSchema = Schema.Struct({
  agent: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  focused: Schema.Boolean,
  paneId: Schema.String,
  parentSession: Schema.NullOr(Schema.String),
  sessionCwd: Schema.NullOr(Schema.String),
  /** `null` = non vérifiable, volontairement distinct de `false`. */
  sessionCwdMatches: Schema.NullOr(Schema.Boolean),
  sessionId: Schema.NullOr(Schema.String),
  sessionKind: Schema.NullOr(Schema.Literals(["id", "path"])),
  sessionPath: Schema.NullOr(Schema.String),
  /** Union fermée (A04) : pas de string libre pour un état métier. */
  status: AgentStatus,
  /** Libellé humain de l'onglet, quand Herdr en fournit un. */
  tabLabel: Schema.NullOr(Schema.String),
  tabId: Schema.String,
  tabNumber: Schema.NullOr(Schema.Number),
  title: Schema.NullOr(Schema.String),
  /** Libellé humain du projet. `null` = nom par défaut côté Herdr. */
  workspaceLabel: Schema.NullOr(Schema.String),
  workspaceId: Schema.String,
});
export type AgentView = typeof AgentViewSchema.Type;

export const WorkspaceViewSchema = Schema.Struct({
  /** Panes d'agents de ce projet, pour savoir s'il y en a déjà un. */
  agentPanes: Schema.Array(Schema.String),
  agentStatus: Schema.NullOr(AgentStatus),
  /**
   * Chemin du projet. Vient du dossier de travail (`checkout_path`) : c'est
   * **là** qu'un nouvel agent doit démarrer. Sans lui, impossible de lancer
   * un agent sans demander le chemin à la main.
   */
  checkoutPath: Schema.NullOr(Schema.String),
  focused: Schema.Boolean,
  label: Schema.NullOr(Schema.String),
  paneCount: Schema.Number,
  tabCount: Schema.Number,
  workspaceId: Schema.String,
});
export type WorkspaceView = typeof WorkspaceViewSchema.Type;

export const OverviewResponse = Schema.Struct({
  agents: Schema.Array(AgentViewSchema),
  herdrProtocol: Schema.Number,
  herdrVersion: Schema.String,
  withoutSession: Schema.Number,
  workspaces: Schema.Array(WorkspaceViewSchema),
});
export type OverviewResponse = typeof OverviewResponse.Type;

export const SessionEntrySchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  raw: Schema.String,
  timestamp: Schema.optional(Schema.String),
  type: Schema.String,
});
export type SessionEntry = typeof SessionEntrySchema.Type;

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

export const SessionResponse = Schema.Struct({
  /**
   * Cause de la réponse, **explicite**.
   *
   * `absente` et `vide` ne sont pas des pannes : le client ne doit ni les
   * colorer en rouge, ni réessayer en boucle. Les distinguer évite
   * l'erreur répétée toutes les 2 s sur un agent fraîchement lancé.
   */
  cause: Schema.Literals(["absente", "vide", "invalide", "io"]),
  entries: Schema.Array(SessionEntrySchema),
  /** `true` quand seule la suite a été renvoyée (mode incrémental). */
  incremental: Schema.Boolean,
  /** Curseur à renvoyer au prochain appel. Absent quand la session est nouvelle. */
  cursor: Schema.optional(Schema.String),
  /** `true` quand des entrées précédentes existent mais n'ont pas été renvoyées. */
  hasMore: Schema.Boolean,
  /**
   * `true` quand le curseur fourni ne vaut plus : le fichier a changé de
   * `dev`/`ino`, ou il est plus court que le curseur. Le client doit alors
   * **remplacer** sa vue, pas y ajouter.
   */
  reset: Schema.Boolean,
  sessionPath: Schema.String,
});
export type SessionResponse = typeof SessionResponse.Type;

/** Envoi confirmé. `confirmation` vient du serveur, pas du client. */
export const PromptSentResponse = Schema.Struct({
  confirmation: Schema.Literals(["confirmed", "unknown"]),
  fingerprint: Schema.String,
  status: Schema.Literal("sent"),
});
export type PromptSentResponse = typeof PromptSentResponse.Type;

/**
 * Envoi **non confirmé** (B05).
 *
 * `attente` : Herdr n'a pas tranché dans le délai — le message est peut-être
 * parti, donc l'interface doit permettre de le renvoyer.
 * `erreur` : Herdr a refusé, l'envoi n'a pas eu lieu.
 * `inconnu` : seul le transport a répondu, sans preuve d'acceptation.
 *
 * Aucun de ces états n'est jamais `sent`.
 */
export const PromptFailedResponse = Schema.Struct({
  detail: Schema.String,
  state: Schema.Literals(["attente", "erreur", "inconnu"]),
});
export type PromptFailedResponse = typeof PromptFailedResponse.Type;

/** Double envoi supprimé — **un état normal, pas une erreur**. */
export const PromptSuppressedResponse = Schema.Struct({
  reason: Schema.String,
  status: Schema.Literal("suppressed"),
});
export type PromptSuppressedResponse = typeof PromptSuppressedResponse.Type;

/** Demande de lancement d'un agent dans un projet. */
export const LaunchAgentRequest = Schema.Struct({
  /** Type d'agent, tel que Herdr le connaît (`pi`, `claude`, `codex`…). */
  kind: Schema.String,
  /**
   * Modèle demandé, **au lancement**.
   *
   * ⚠️ Pas de `default` : un modèle non choisi est un modèle laissé au choix
   * de l'agent, pas un modèle « par défaut » choisi par cette application.
   */
  model: Schema.optional(Schema.String),
  /** Fournisseur du modèle, quand la session l'a déclaré (notamment pour Pi). */
  provider: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  /**
   * Niveau de raisonnement, au lancement.
   *
   * Validé contre le `thinkingLevels` du catalogue du kind : un agent refuse
   * un niveau qu'il ne connaît pas, et le serveur ne doit pas l'inventer.
   */
  thinking: Schema.optional(Schema.String),
});
export type LaunchAgentRequest = typeof LaunchAgentRequest.Type;

export const LaunchAgentResponse = Schema.Struct({
  kind: Schema.String,
  name: Schema.String,
  /** Pane dans lequel l'agent a été lancé. */
  paneId: Schema.String,
  status: Schema.Literal("started"),
  tabId: Schema.String,
});
export type LaunchAgentResponse = typeof LaunchAgentResponse.Type;

/** Un type d'agent **réellement installé** sur la machine. */
export const InstalledKind = Schema.Struct({
  /** Valeur à passer à `agent.start`. */
  kind: Schema.String,
  /** Libellé lisible. */
  label: Schema.String,
  /** `current` ou `outdated` — les deux fonctionnent. */
  state: Schema.String,
});
export type InstalledKind = typeof InstalledKind.Type;

export const InstalledKindsResponse = Schema.Struct({
  kinds: Schema.Array(InstalledKind),
});
export type InstalledKindsResponse = typeof InstalledKindsResponse.Type;

/**
 * Un modèle, tel que l'agent le déclare lui-même.
 *
 * `thinkingLevels` est **la** réponse à « quel raisonnement pour ce modèle » :
 * il est mesuré par agent, et il est vide quand l'agent ne le déclare pas.
 * On n'en déduit jamais un niveau par défaut.
 */
export const AgentModel = Schema.Struct({
  /** Libellé lisible quand l'agent en fournit un. */
  label: Schema.optional(Schema.String),
  /** Identifiant à passer au flag `--model`. */
  id: Schema.String,
  /** Niveaux de raisonnement **supportés par ce modèle**. */
  thinkingLevels: Schema.Array(Schema.String),
});
export type AgentModel = typeof AgentModel.Type;

/**
 * Catalogue d'un type d'agent.
 *
 * `models` est **mesuré**, jamais codé en dur. Un kind dont la liste n'a pas pu
 * être obtenue est renvoyé avec `models: []` et une `source` qui l'explique :
 * l'interface affiche l'absence, elle ne comble rien.
 */
export const ModelCatalogResponse = Schema.Struct({
  /** `null` quand aucun mécanisme de listage n'est connu pour ce kind. */
  error: Schema.NullOr(Schema.String),
  /** Types d'agent dont le catalogue est **vérifié par exécution**. */
  kind: Schema.String,
  models: Schema.Array(AgentModel),
  /**
   * Niveaux de raisonnement **possibles** sur cet agent, tous modèles
   * confondus. Vide si l'agent ne les déclare pas.
   */
  thinkingLevels: Schema.Array(Schema.String),
  /** La commande qui a produit cette liste — traçable, donc vérifiable. */
  source: Schema.String,
});
export type ModelCatalogResponse = typeof ModelCatalogResponse.Type;

export const RecentImageSchema = Schema.Struct({
  modifiedAt: Schema.Number,
  path: Schema.String,
  size: Schema.Number,
});
export type RecentImage = typeof RecentImageSchema.Type;

export const RecentImagesResponse = Schema.Struct({
  images: Schema.Array(RecentImageSchema),
});
export type RecentImagesResponse = typeof RecentImagesResponse.Type;

/**
 * Un agent a été lancé, mais il attend la **confiance** de l'utilisateur.
 *
 * ⚠️ Répondre « oui » autorise l'agent à **exécuter du code** dans ce dossier,
 * et l'accepte durablement (`~/.codex/config.toml`). La décision est donc
 * prise **dans l'application**, devant le nom du dossier — jamais
 * automatiquement à la création d'un agent.
 */
export const TrustRequiredResponse = Schema.Struct({
  /** Nom lisible du projet, jamais son chemin complet ni un identifiant. */
  folder: Schema.String,
  /** Type d'agent qui demande la confiance (`codex`…). */
  kind: Schema.String,
  /** Explication affichée, jamais une phrase générique. */
  message: Schema.String,
  /** Pane où se trouve l'invite. */
  paneId: Schema.String,
  status: Schema.Literal("trust-required"),
});
export type TrustRequiredResponse = typeof TrustRequiredResponse.Type;

/** Réponse à l'invite de confiance. */
export const TrustResolvedResponse = Schema.Struct({
  /** `false` = le dossier n'est **pas** approuvé. Prouvé par relecture (B06). */
  accepted: Schema.Boolean,
  /**
   * État réel de la décision.
   *
   * `transmise` — la frappe est partie, mais l'écran ne prouve rien encore.
   * ⚠️ Ce n'est **pas** « confiance accordée » : Herdr peut refuser la touche,
   * et l'agent peut redémarrer. L'interface doit rester sur ce mot tant que
   * `acceptee` ou `refusee` n'est pas revenu.
   */
  state: Schema.Literals(["transmise", "acceptee", "refusee", "non-applicable"]),
  status: Schema.Literal("trust-resolved"),
});
export type TrustResolvedResponse = typeof TrustResolvedResponse.Type;

/** Réponse à une question posée par un agent. */
export const QuestionAnsweredResponse = Schema.Struct({
  /** Texte lisible, y compris en cas de refus — jamais une chaîne vide. */
  detail: Schema.String,
  /**
   * État réel de la réponse.
   *
   * ⚠️ `transmise` n'est **pas** « appliquée » : la frappe est partie, mais la
   * question est toujours à l'écran. Même règle que pour la confiance (B06) —
   * un succès de transport n'est pas un succès d'application.
   */
  state: Schema.Literals(["appliquee", "transmise", "refusee"]),
  status: Schema.Literal("question-answered"),
});
export type QuestionAnsweredResponse = typeof QuestionAnsweredResponse.Type;

/** Erreur d'API. */
export const ApiErrorResponse = Schema.Struct({
  /** Cause nommée quand elle est connue (B03). Absente = cause non qualifiée. */
  cause: Schema.optional(Schema.Literals(["absente", "vide", "invalide", "io"])),
  error: Schema.String,
  hint: Schema.optional(Schema.String),
});
export type ApiErrorResponse = typeof ApiErrorResponse.Type;

/**
 * Un état de session tel que la conversation peut l'afficher (B10).
 *
 * `available` = lisible, `absent` = pas encore créée (le JSONL naît au premier
 * message), `error` = présente mais illisible. Le troisième cas existe pour ne
 * **jamais** laisser croire qu'une session est vide alors qu'elle n'a pas pu
 * être lue.
 */
export const SessionState = Schema.Literals(["available", "absent", "error"]);
export type SessionState = typeof SessionState.Type;

/**
 * Une ligne de la liste des conversations.
 *
 * ⚠️ **Aucun champ « non lu ».** Herdr ne fournit aucun compteur exploitable :
 * son `revision` vaut 0 en permanence (E3). Un compteur de non-lus serait donc
 * une **invention**, et c'est exactement ce que ce projet refuse d'exposer.
 *
 * `preview` et `timestamp` sont **facultatifs** : une session absente n'a ni
 * aperçu ni date, et le champ reste absent plutôt que nul pour que l'absence
 * soit visible plutôt que simulée.
 */
/** Un choix proposé par une question affichée à l'écran. */
export const Choix = Schema.Struct({
  detail: Schema.optional(Schema.String),
  libelle: Schema.String,
  numero: Schema.Number,
  selectionne: Schema.Boolean,
});

/** Une question affichée à l'écran d'un pane, avec ses choix. */
export const Question = Schema.Struct({
  choix: Schema.Array(Choix),
  contexte: Schema.Array(Schema.String),
  invite: Schema.optional(Schema.String),
  texte: Schema.String,
});
export type Question = typeof Question.Type;
export type Choix = typeof Choix.Type;

export const ConversationSummary = Schema.Struct({
  /**
   * Branche git du dossier de travail, quand il y en a une.
   *
   * ⚠️ Herdr n'expose **aucune** information de branche : ni le snapshot, ni
   * `worktree` n'en portent. Elle vient donc de `git rev-parse` dans le dossier
   * de travail du projet — la seule source réelle, et un dépôt sans git donne
   * `undefined` plutôt qu'une valeur inventée.
   */
  branch: Schema.optional(Schema.String),
  /**
   * Dernière **demande de l'utilisateur**.
   *
   * Distincte de `preview` : une liste montre ce qu'on a demandé, pas ce que
   * l'agent a répondu — l'un se reconnaît d'un coup d'œil, l'autre oblige à
   * relire.
   */
  lastPrompt: Schema.optional(Schema.String),
  /**
   * Modèle en vigueur, tel que la session l'a enregistré (`model_change`).
   *
   * Absent quand la session n'en déclare aucun : on ne complète pas avec un
   * modèle supposé.
   */
  model: Schema.optional(Schema.String),
  /** Fournisseur explicite pour les modèles Pi (`model_change`). */
  provider: Schema.optional(Schema.String),
  /** Aperçu : dernier message texte de l'agent. Absent s'il n'y en a pas. */
  preview: Schema.optional(Schema.String),
  /**
   * Question posée à l'écran, quand l'agent en attend une.
   *
   * ⚠️ Elle ne vient **pas** de la session : une invite n'est écrite nulle part
   * dans le JSONL. Elle se lit sur le terminal (`agent.read`). Un agent bloqué
   * sans question lisible garde donc ce champ **absent** — l'état est connu, la
   * question ne l'est pas.
   */
  question: Schema.optional(Question),
  /** Niveau de raisonnement en vigueur (`thinking_level_change`). */
  thinking: Schema.optional(Schema.String),
  sessionState: SessionState,
  /** Horodatage de la dernière activité connue. Jamais inventé. */
  timestamp: Schema.optional(Schema.Number),
  /** Titre = premier non vide : titre Herdr, onglet, projet, puis `paneId`. */
  title: Schema.String,
  /** État en union fermée (A04) : une string libre accepterait n'importe quoi. */
  status: AgentStatus,
  workspaceId: Schema.String,
  paneId: Schema.String,
});
export type ConversationSummary = typeof ConversationSummary.Type;

export const ConversationsResponse = Schema.Struct({
  conversations: Schema.Array(ConversationSummary),
});
export type ConversationsResponse = typeof ConversationsResponse.Type;

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
export const SnapshotPayload = Schema.Struct({
  agents: Schema.Array(AgentInfo),
  panes: Schema.optional(Schema.Array(SnapshotPane)),
  protocol: Schema.Number,
  tabs: Schema.optional(Schema.Array(TabInfo)),
  version: Schema.String,
  workspaces: Schema.Array(WorkspaceInfo),
});
export type SnapshotPayload = typeof SnapshotPayload.Type;
