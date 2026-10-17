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
  /**
   * Nom de l'agent, **exigé unique** par `agent.start`.
   *
   * ⚠️ `null` pour un agent lancé à la main : mesuré, ses treize agents n'en
   * portaient aucun. C'est donc le seul libellé *choisi* quand il existe, et il
   * n'existe que pour ce que Herdr a lancé.
   */
  name: Schema.NullOr(Schema.String),
  /**
   * Rang du pane dans son tab, en ordre de lecture (1 = premier).
   *
   * ⚠️ Herdr numérote les tabs et les workspaces, **jamais les panes** : c'est
   * la place dans la disposition qui sert de discriminant. `null` quand la
   * disposition n'a pas été lue.
   */
  paneRank: Schema.NullOr(Schema.Number),
  /** Combien de panes compte le tab. `1` = l'agent est seul. */
  tabPaneCount: Schema.Number,
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
  /** Curseur opaque pour demander la page précédente de l'historique. */
  previousCursor: Schema.optional(Schema.String),
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

/** Demande d'interruption envoyée au terminal d'un agent en cours. */
export const StopAgentResponse = Schema.Struct({
  status: Schema.Literals(["interrupt-sent", "not-running"]),
});
export type StopAgentResponse = typeof StopAgentResponse.Type;

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

/**
 * Acquittement : le pane a pris le focus, donc la réponse est réputée lue.
 *
 * ⚠️ Le champ dit `focused`, pas `seen` : c'est **ce qui a réellement eu lieu**.
 * `agent.view.set` prétendait acquitter sans focaliser, et ne changeait rien au
 * statut — mesuré deux fois. Nommer l'effet obtenu plutôt que l'intention évite
 * de recréer la même illusion.
 */
export const AgentFocusedResponse = Schema.Struct({
  /**
   * `false` quand le focus n'a pas pu être posé. **Ce n'est pas une erreur** :
   * l'acquittement est un confort, il ne doit pas empêcher d'ouvrir une
   * conversation.
   */
  focused: Schema.Boolean,
  status: Schema.Literal("agent-focused"),
});
export type AgentFocusedResponse = typeof AgentFocusedResponse.Type;

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
   * Type de l'agent, tel que Herdr le nomme (`pi`, `codex`, `claude`…).
   *
   * ⚠️ **Il voyage avec la ligne parce que la ligne en a besoin** : c'est lui
   * qui choisit la marque affichée devant le nom du projet. Le faire chercher
   * ailleurs par l'affichage aurait obligé la liste à recroiser l'overview —
   * deux sources pour une même vérité, donc deux qui finissent par diverger.
   *
   * `null` = Herdr ne le dit pas. L'affichage montre alors un signe **neutre**,
   * jamais la marque d'un voisin.
   */
  agent: Schema.NullOr(Schema.String),
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
   * Modèle en vigueur.
   *
   * ⚠️ **Deux sources, et la plus récente gagne** : le changement déclaré
   * (`model_change`) *ou* le modèle porté par le dernier message assistant —
   * c'est la forme de pi, et les cinq sources mesurées s'y ramènent. Le message
   * est en pratique la source qui répond : un changement n'est écrit qu'au
   * moment où il change, donc un agent qui n'y a jamais touché n'en a aucun.
   *
   * Absent quand rien ne le déclare : on ne complète pas avec un modèle supposé.
   */
  model: Schema.optional(Schema.String),
  /**
   * Nom de l'agent et place dans son tab — **de quoi l'étiqueter** quand son tab
   * en contient plusieurs.
   *
   * ⚠️ Recopiés depuis la vue d'agent plutôt que recalculés : une seconde
   * déduction du même rang finirait par diverger de la première.
   */
  name: Schema.NullOr(Schema.String),
  paneRank: Schema.NullOr(Schema.Number),
  tabPaneCount: Schema.Number,
  /** Fournisseur explicite du modèle (`model_change`, ou le message lui-même). */
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
  /**
   * Ce que l'agent affiche quand il **attend**, mais qu'aucune question
   * numérotée n'a pu être lue.
   *
   * ⚠️ **Pourquoi ce champ existe.** opencode pose ses questions en
   * **formulaires à plusieurs champs** : on répond champ par champ, puis l'écran
   * passe en **Review** et attend une validation finale. Cet écran de revue n'a
   * **aucun choix numéroté** — `questionDeLEcran` rend `undefined`, la carte
   * disparaît, et l'agent reste `blocked` sans que rien ne dise sur quoi. Mesuré
   * le 2026-10-17 : un agent bloqué sans question, donc **sans recours**.
   *
   * ⚠️ On n'invente **aucun** choix pour autant : on montre l'écran, qui est un
   * fait. Ses dernières lignes non vides, jamais plus, et jamais reformulées.
   */
  waiting: Schema.optional(Schema.String),
  /**
   * Invite de **confiance** à l'écran : un agent attend qu'on approuve un dossier.
   *
   * ⚠️ **Même forme que celle du lancement**, et c'est volontaire : la carte qui
   * la présente et la route qui y répond sont **les mêmes**. Deux formes
   * auraient donné deux cartes et deux décisions pour une seule question.
   *
   * ⚠️ Distincte de `question` : l'invite de confiance n'a pas toujours de choix
   * numérotés (claude présente une **sélection**), donc elle ne passe pas par le
   * même chemin de réponse.
   */
  trust: Schema.optional(TrustRequiredResponse),
  /**
   * Niveau de raisonnement en vigueur (`thinking_level_change`, ou le message).
   *
   * ⚠️ Chaque source lui donne un nom différent — `thinkingLevel` chez pi,
   * `effort` chez codex, `variant` chez opencode — mais c'est la même chose, et
   * les adaptateurs la ramènent à un seul nom avant que quiconque la lise.
   */
  thinking: Schema.optional(Schema.String),
  sessionState: SessionState,
  /** Horodatage de la dernière activité connue. Jamais inventé. */
  timestamp: Schema.optional(Schema.Number),
  /** Titre = premier non vide : titre Herdr, onglet, projet, puis `paneId`. */
  title: Schema.String,
  /** État en union fermée (A04) : une string libre accepterait n'importe quoi. */
  status: AgentStatus,
  workspaceId: Schema.String,
  /**
   * Onglet dont vient l'agent.
   *
   * ⚠️ Sert à retrouver **ses voisins** : c'est la clé de la barre qui permet de
   * passer d'un pane à l'autre sans repasser par la liste.
   */
  tabId: Schema.String,
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
