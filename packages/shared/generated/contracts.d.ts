// Généré par `cargo xtask contracts export` — ne pas éditer.
// Source : contracts.schema.json (61 définitions).

/**
 * Un focus appliqué (`AgentFocusedResponse`).
 */
export interface AgentFocusedResponse {
  focused: boolean;
  /**
   * Le littéral `"agent-focused"`, vérifié au décodage.
   */
  status: "agent-focused";
}

/**
 * Un agent lancé (`event: agent-launched`, mesuré —
 * `{ kind, paneId, workspaceId }`).
 */
export interface AgentLaunched {
  kind: string;
  paneId: string;
  workspaceId: string;
}

/**
 * Un modèle d'agent (`AgentModel`).
 */
export interface AgentModel {
  id: string;
  label?: string;
  thinkingLevels: string[];
}

/**
 * État d'un agent : `idle | working | blocked | done | unknown`.
 *
 * ⚠️ `unknown` est un état **réel**, vérifié dans l'énum du schéma — pas un
 * fourre-tout local. Déclaré ici avec l'orthographe exacte du fil.
 */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/**
 * Un état d'agent a changé (`event: agent_status`, mesuré —
 * `{ from, kind, paneId, to }`).
 *
 * ⚠️ `from` est `null` quand l'agent **apparaît** (aucun état antérieur) —
 * un null mesuré, jamais un absent. `to` est le fil tel quel : `"gone"`
 * (agent disparu — **pas** un `AgentStatus`) ou un libellé d'état ; la
 * chaîne passe sans réécriture, l'affichage tranche.
 */
export interface AgentStatusChanged {
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  from: string | null;
  /**
   * Le genre de changement d'état, union fermée mesurée d'AgentWatcher
   * (`"status" | "appeared" | "disappeared"`).
   */
  kind: "status" | "appeared" | "disappeared";
  paneId: string;
  to: string;
}

/**
 * Une ligne d'agent de l'overview (homologue exact de `AgentViewSchema`) :
 * **tous les champs sont présents** — les vagues d'information passent par
 * `Nullable` (null mesuré), jamais par une absence.
 */
export interface AgentView {
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  agent: string | null;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  cwd: string | null;
  focused: boolean;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  name: string | null;
  paneId: string;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  paneRank: number | null;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  parentSession: string | null;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  sessionCwd: string | null;
  /**
   * Trois états sur le fil : `true | false | null` — null = non
   * vérifiable (D03), jamais confondu avec faux.
   */
  sessionCwdMatches: boolean | null;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  sessionId: string | null;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  sessionKind: ("id" | "path") | null;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  sessionPath: string | null;
  /**
   * État d'un agent : `idle | working | blocked | done | unknown`.
   *
   * ⚠️ `unknown` est un état **réel**, vérifié dans l'énum du schéma — pas un
   * fourre-tout local. Déclaré ici avec l'orthographe exacte du fil.
   */
  status: "idle" | "working" | "blocked" | "done" | "unknown";
  tabId: string;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  tabLabel: string | null;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  tabNumber: number | null;
  tabPaneCount: number;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  title: string | null;
  workspaceId: string;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  workspaceLabel: string | null;
}

/**
 * Le corps de réponse à une question (`AnswerBody`, mesuré) — `texte` est
 * **omissible mais décisif** : c'est lui qui répond à l'option de saisie
 * libre d'opencode.
 */
export interface AnswerRequest {
  numero: number;
  texte?: string;
}

/**
 * L'union fermée des états d'une réponse.
 */
export type AnswerState = "appliquee" | "transmise" | "refusee";

/**
 * `ApiErrorResponse` (api.ts) : le message réel, un indicateur optionnel,
 * et la cause de lecture quand il y en a une — nommée, jamais reformée.
 */
export interface ApiErrorResponse {
  /**
   * `absente | vide | invalide | io` — la cause de lecture, présente
   * seulement quand l'erreur en porte une.
   */
  cause?: "absente" | "vide" | "invalide" | "io";
  error: string;
  hint?: string;
}

/**
 * Le genre de changement d'état, union fermée mesurée d'AgentWatcher
 * (`"status" | "appeared" | "disappeared"`).
 */
export type ChangeKind = "status" | "appeared" | "disappeared";

/**
 * Un choix proposé (`Choix` de api.ts/question.ts) — les noms du fil
 * **restent** : `numero`, `libelle`, `selectionne`, `detail` (TECH §5 :
 * renommer les identifiants Rust ne change pas le fil).
 */
export interface Choice {
  detail?: string;
  libelle: string;
  numero: number;
  selectionne: boolean;
}

/**
 * Le corps de log client (inline mesuré Api.ts) : niveau **fermé sur
 * `"error"`** aujourd'hui — l'union grandira avec le fil, pas avant.
 */
export interface ClientLogRequest {
  detail?: unknown;
  /**
   * L'union des niveaux acceptés du fil — un seul membre mesuré (`"error"`).
   */
  level: "error";
  message: string;
}

/**
 * L'acquittement du log — le `{ok}` du fil : un booléen réel, pas un
 * succès fabriqué (400 quand le corps est refusé).
 */
export interface ClientLogResponse {
  ok: boolean;
}

/**
 * L'union fermée de confirmation du fil (`"confirmed" | "unknown"`).
 */
export type Confirmation = "confirmed" | "unknown";

/**
 * Le résumé d'une conversation (`ConversationSummary`) — tout ce que la
 * liste doit afficher, rien de plus ; chaque champ omissible l'est **mesuré**
 * (absent tant que la source n'en dit rien).
 */
export interface ConversationSummary {
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  agent: string | null;
  branch?: string;
  lastPrompt?: string;
  model?: string;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  name: string | null;
  paneId: string;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  paneRank: number | null;
  preview?: string;
  provider?: string;
  /**
   * Une question posée par un agent (`Question`) — contexte en tableau
   * (peut être vide : un fait, pas une absence).
   */
  question?: {
    /**
     * Items: Un choix proposé (`Choix` de api.ts/question.ts) — les noms du fil
     * **restent** : `numero`, `libelle`, `selectionne`, `detail` (TECH §5 :
     * renommer les identifiants Rust ne change pas le fil).
     */
    choix: {
      detail?: string;
      libelle: string;
      numero: number;
      selectionne: boolean;
    }[];
    contexte: string[];
    invite?: string;
    texte: string;
  };
  /**
   * État de la conversation visible sur une ligne de conversation
   * (`available | absent | error`, B10).
   */
  sessionState: "available" | "absent" | "error";
  /**
   * État d'un agent : `idle | working | blocked | done | unknown`.
   *
   * ⚠️ `unknown` est un état **réel**, vérifié dans l'énum du schéma — pas un
   * fourre-tout local. Déclaré ici avec l'orthographe exacte du fil.
   */
  status: "idle" | "working" | "blocked" | "done" | "unknown";
  tabId: string;
  tabPaneCount: number;
  thinking?: string;
  timestamp?: number;
  title: string;
  /**
   * La confiance exigée avant d'agir (`TrustRequiredResponse`).
   */
  trust?: {
    folder: string;
    kind: string;
    message: string;
    paneId: string;
    /**
     * Le littéral `"trust-required"` — union à un membre.
     */
    status: "trust-required";
  };
  waiting?: string;
  workspaceId: string;
}

/**
 * La réponse conversations (`ConversationsResponse`).
 */
export interface ConversationsResponse {
  /**
   * Items: Le résumé d'une conversation (`ConversationSummary`) — tout ce que la
   * liste doit afficher, rien de plus ; chaque champ omissible l'est **mesuré**
   * (absent tant que la source n'en dit rien).
   */
  conversations: {
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    agent: string | null;
    branch?: string;
    lastPrompt?: string;
    model?: string;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    name: string | null;
    paneId: string;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    paneRank: number | null;
    preview?: string;
    provider?: string;
    /**
     * Une question posée par un agent (`Question`) — contexte en tableau
     * (peut être vide : un fait, pas une absence).
     */
    question?: {
      /**
       * Items: Un choix proposé (`Choix` de api.ts/question.ts) — les noms du fil
       * **restent** : `numero`, `libelle`, `selectionne`, `detail` (TECH §5 :
       * renommer les identifiants Rust ne change pas le fil).
       */
      choix: {
        detail?: string;
        libelle: string;
        numero: number;
        selectionne: boolean;
      }[];
      contexte: string[];
      invite?: string;
      texte: string;
    };
    /**
     * État de la conversation visible sur une ligne de conversation
     * (`available | absent | error`, B10).
     */
    sessionState: "available" | "absent" | "error";
    /**
     * État d'un agent : `idle | working | blocked | done | unknown`.
     *
     * ⚠️ `unknown` est un état **réel**, vérifié dans l'énum du schéma — pas un
     * fourre-tout local. Déclaré ici avec l'orthographe exacte du fil.
     */
    status: "idle" | "working" | "blocked" | "done" | "unknown";
    tabId: string;
    tabPaneCount: number;
    thinking?: string;
    timestamp?: number;
    title: string;
    /**
     * La confiance exigée avant d'agir (`TrustRequiredResponse`).
     */
    trust?: {
      folder: string;
      kind: string;
      message: string;
      paneId: string;
      /**
       * Le littéral `"trust-required"` — union à un membre.
       */
      status: "trust-required";
    };
    waiting?: string;
    workspaceId: string;
  }[];
}

/**
 * L'enveloppe SSE entière — `{"event": nom, "data": charge}` telle que la
 * boucle de flux l'écrit (mesuré sur routes-events.ts) : le nom d'événement
 * et sa charge sont **inséparables** au décodage. `agent_status` porte un
 * soulignement (mesuré), les autres des traits d'union.
 */
export type EvenementSse =
  | {
      /**
       * Le signal de vie : le flux est établi, voici le curseur de départ
       * (`event: ready`, mesuré — `{ cursor }`).
       */
      data: {
        cursor: number;
      };
      event: "ready";
    }
  | {
      /**
       * Un état d'agent a changé (`event: agent_status`, mesuré —
       * `{ from, kind, paneId, to }`).
       *
       * ⚠️ `from` est `null` quand l'agent **apparaît** (aucun état antérieur) —
       * un null mesuré, jamais un absent. `to` est le fil tel quel : `"gone"`
       * (agent disparu — **pas** un `AgentStatus`) ou un libellé d'état ; la
       * chaîne passe sans réécriture, l'affichage tranche.
       */
      data: {
        /**
         * Une valeur **présente** qui peut valoir null — l'homologue exact de
         * `Schema.NullOr(Schema.X)`.
         *
         * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
         * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
         * champ manquant — sans `default` serde, un champ absent est une erreur).
         *
         * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
         * `deserialize_option` : le `missing_field` de serde délègue à
         * `deserialize_option` — un champ absent deviendrait silencieusement
         * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
         * un null explicite devient `Nulle`, une valeur délègue à `T`.
         *
         * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
         * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
         * représentation réelle, pas la représentation par défaut étiquetée.
         */
        from: string | null;
        /**
         * Le genre de changement d'état, union fermée mesurée d'AgentWatcher
         * (`"status" | "appeared" | "disappeared"`).
         */
        kind: "status" | "appeared" | "disappeared";
        paneId: string;
        to: string;
      };
      event: "agent_status";
    }
  | {
      /**
       * La confirmation d'un prompt livré (`event: prompt`, mesuré —
       * `{ paneId, confirmation, fingerprint, status }`, la charge étant la
       * réponse `PromptSentResponse` complétée du pane).
       */
      data: {
        /**
         * `confirmed` | `unknown` — l'union du fil : une réponse sans preuve
         * d'acceptation reste inconnue (A02).
         */
        confirmation: "confirmed" | "unknown";
        fingerprint: string;
        paneId: string;
        /**
         * L'état d'un prompt, tel qu'annoncé sur le flux — l'union fermée du fil
         * (`"sent"`), jamais un état inventé.
         */
        status: "sent";
      };
      event: "prompt";
    }
  | {
      /**
       * Un double envoi assumé (`event: prompt-suppressed`, mesuré —
       * `{ paneId, reason }`), D007.2 : pas une erreur, un no-op nommé.
       */
      data: {
        paneId: string;
        reason: string;
      };
      event: "prompt-suppressed";
    }
  | {
      /**
       * Un agent lancé (`event: agent-launched`, mesuré —
       * `{ kind, paneId, workspaceId }`).
       */
      data: {
        kind: string;
        paneId: string;
        workspaceId: string;
      };
      event: "agent-launched";
    }
  | {
      /**
       * La source de session d'un pane a changé (`event: session_changed`) —
       * **événement AJOUTÉ par la migration** (C26), pas mesuré sur le fil.
       *
       * ⚠️ La matière est **l'observation de la source seule** : le chemin publié
       * par Herdr (ou son absence). Aucun compteur de messages n'existe côté
       * Herdr — prétendre « nouveau message » exigerait de lire la session, ce
       * que le flux ne fait pas. Le client invalide, il ne devine pas.
       */
      data: {
        paneId: string;
        /**
         * La source APRÈS le changement — `null` quand elle a disparu (agent
         * parti ou chemin retiré) : un null mesuré, jamais un absent.
         */
        path: string | null;
      };
      event: "session_changed";
    }
  | {
      /**
       * L'ordre de resynchronisation : la continuité du journal n'est plus
       * garantie — recharger l'état complet, jamais croire à un trou.
       * (`event: resync`, mesuré — `{ reason: "truncated journal", resumeFrom }`.)
       */
      data: {
        /**
         * La raison, telle qu'émise aujourd'hui : « truncated journal ». Une
         * chaîne, pas une union : le producteur reste libre de nommer mieux —
         * et le client l'affiche, il ne la devine pas.
         */
        reason: string;
        /**
         * L'identifiant **courant** du journal (B04 : repartir de là, sinon un
         * second resync revient à la boucle suivante).
         */
        resumeFrom: number;
      };
      event: "resync";
    };

/**
 * Le littéral `"agent-focused"` — union à un membre.
 */
export type FocusStatus = "agent-focused";

/**
 * La santé du service (mesurée sur `HealthResponse` de api.ts).
 */
export interface HealthResponse {
  /**
   * La partie Herdr de la santé — protocol/version **omissibles** (mesuré :
   * absents tant qu'aucun ping n'a réussi), socket et reachable toujours là.
   */
  herdr: {
    protocol?: number;
    reachable: boolean;
    socket: string;
    version?: string;
  };
  /**
   * Absent ou valeur — un null explicite est un refus (`Schema.optional`).
   */
  log?: string;
  ok: boolean;
  uptimeMs?: number;
}

/**
 * La partie Herdr de la santé — protocol/version **omissibles** (mesuré :
 * absents tant qu'aucun ping n'a réussi), socket et reachable toujours là.
 */
export interface HerdrHealth {
  protocol?: number;
  reachable: boolean;
  socket: string;
  version?: string;
}

/**
 * Un type d'agent installé sur la machine (`InstalledKind`).
 */
export interface InstalledKind {
  kind: string;
  label: string;
  state: string;
}

/**
 * La liste des types installés (`InstalledKindsResponse`).
 */
export interface InstalledKindsResponse {
  /**
   * Items: Un type d'agent installé sur la machine (`InstalledKind`).
   */
  kinds: {
    kind: string;
    label: string;
    state: string;
  }[];
}

/**
 * Le corps de lancement (`LaunchAgentRequest`) — tout est omissible sauf le
 * type : les réglages absents laissent le profil de l'agent parler.
 */
export interface LaunchAgentRequest {
  kind: string;
  model?: string;
  name?: string;
  provider?: string;
  thinking?: string;
}

/**
 * Un lancement réussi (`LaunchAgentResponse`) — 201 sur le fil.
 */
export interface LaunchAgentResponse {
  kind: string;
  name: string;
  paneId: string;
  /**
   * Le littéral `"started"` — union à un membre, vérifiée au décodage.
   */
  status: "started";
  tabId: string;
}

/**
 * L'échec typé du lancement (`LaunchFailed`) — le pane peut exister déjà :
 * c'est pourquoi il est nullable et pourquoi l'onglet n'est pas refermé
 * dans ce cas.
 */
export interface LaunchFailed {
  detail: string;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  paneId: string | null;
  /**
   * L'étape d'un lancement qui a coincé, union fermée mesurée
   * (`validation | onglet | agent | detection`) — l'interface dit OÙ ça a
   * coincé, l'utilisateur sait s'il faut nettoyer un onglet ou réessayer.
   */
  phase: "validation" | "onglet" | "agent" | "detection";
}

/**
 * L'étape d'un lancement qui a coincé, union fermée mesurée
 * (`validation | onglet | agent | detection`) — l'interface dit OÙ ça a
 * coincé, l'utilisateur sait s'il faut nettoyer un onglet ou réessayer.
 */
export type LaunchPhase = "validation" | "onglet" | "agent" | "detection";

/**
 * Le catalogue d'un type (`ModelCatalogResponse`) — `error` est **nullable
 * obligatoire** : présent, souvent null ; une panne de catalogage reste
 * visible, jamais effacée.
 */
export interface ModelCatalogResponse {
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  error: string | null;
  kind: string;
  /**
   * Items: Un modèle d'agent (`AgentModel`).
   */
  models: {
    id: string;
    label?: string;
    thinkingLevels: string[];
  }[];
  source: string;
  thinkingLevels: string[];
}

/**
 * La réponse d'overview complète.
 */
export interface OverviewResponse {
  /**
   * Items: Une ligne d'agent de l'overview (homologue exact de `AgentViewSchema`) :
   * **tous les champs sont présents** — les vagues d'information passent par
   * `Nullable` (null mesuré), jamais par une absence.
   */
  agents: {
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    agent: string | null;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    cwd: string | null;
    focused: boolean;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    name: string | null;
    paneId: string;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    paneRank: number | null;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    parentSession: string | null;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    sessionCwd: string | null;
    /**
     * Trois états sur le fil : `true | false | null` — null = non
     * vérifiable (D03), jamais confondu avec faux.
     */
    sessionCwdMatches: boolean | null;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    sessionId: string | null;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    sessionKind: ("id" | "path") | null;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    sessionPath: string | null;
    /**
     * État d'un agent : `idle | working | blocked | done | unknown`.
     *
     * ⚠️ `unknown` est un état **réel**, vérifié dans l'énum du schéma — pas un
     * fourre-tout local. Déclaré ici avec l'orthographe exacte du fil.
     */
    status: "idle" | "working" | "blocked" | "done" | "unknown";
    tabId: string;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    tabLabel: string | null;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    tabNumber: number | null;
    tabPaneCount: number;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    title: string | null;
    workspaceId: string;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    workspaceLabel: string | null;
  }[];
  herdrProtocol: number;
  herdrVersion: string;
  withoutSession: number;
  /**
   * Items: Une ligne de workspace de l'overview (homologue de `WorkspaceViewSchema`).
   */
  workspaces: {
    agentPanes: string[];
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    agentStatus: ("idle" | "working" | "blocked" | "done" | "unknown") | null;
    /**
     * Le chemin réel où lancer un agent — absent plutôt qu'inventé (D02).
     */
    checkoutPath: string | null;
    focused: boolean;
    /**
     * Une valeur **présente** qui peut valoir null — l'homologue exact de
     * `Schema.NullOr(Schema.X)`.
     *
     * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
     * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
     * champ manquant — sans `default` serde, un champ absent est une erreur).
     *
     * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
     * `deserialize_option` : le `missing_field` de serde délègue à
     * `deserialize_option` — un champ absent deviendrait silencieusement
     * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
     * un null explicite devient `Nulle`, une valeur délègue à `T`.
     *
     * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
     * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
     * représentation réelle, pas la représentation par défaut étiquetée.
     */
    label: string | null;
    paneCount: number;
    tabCount: number;
    workspaceId: string;
  }[];
}

/**
 * La confirmation d'un prompt livré (`event: prompt`, mesuré —
 * `{ paneId, confirmation, fingerprint, status }`, la charge étant la
 * réponse `PromptSentResponse` complétée du pane).
 */
export interface PromptDelivered {
  /**
   * `confirmed` | `unknown` — l'union du fil : une réponse sans preuve
   * d'acceptation reste inconnue (A02).
   */
  confirmation: "confirmed" | "unknown";
  fingerprint: string;
  paneId: string;
  /**
   * L'état d'un prompt, tel qu'annoncé sur le flux — l'union fermée du fil
   * (`"sent"`), jamais un état inventé.
   */
  status: "sent";
}

/**
 * Un prompt qui n'est pas parti — l'état réel, nommé, avec son détail.
 */
export interface PromptFailedResponse {
  detail: string;
  /**
   * `attente | erreur | inconnu` — B05 : trois états, jamais « envoyé ».
   */
  state: "attente" | "erreur" | "inconnu";
}

/**
 * Le corps d'un prompt (`PromptBody`, mesuré — `{ text }`).
 */
export interface PromptRequest {
  text: string;
}

/**
 * Un prompt parti (confirmé ou non prouvé — A02 : deux états sur le fil,
 * jamais « envoyé » au hasard).
 */
export interface PromptSentResponse {
  /**
   * `confirmed | unknown` — la preuve du serveur, ou son absence assumée.
   */
  confirmation: "confirmed" | "unknown";
  fingerprint: string;
  /**
   * Le littéral `"sent"`, union à un membre : sa présence est vérifiée.
   */
  status: "sent";
}

/**
 * L'état d'un prompt, tel qu'annoncé sur le flux — l'union fermée du fil
 * (`"sent"`), jamais un état inventé.
 */
export type PromptStatus = "sent";

/**
 * Un double envoi assumé (`event: prompt-suppressed`, mesuré —
 * `{ paneId, reason }`), D007.2 : pas une erreur, un no-op nommé.
 */
export interface PromptSuppressed {
  paneId: string;
  reason: string;
}

/**
 * Un prompt supprimé — double envoi assumé, pas une erreur (D007.2).
 */
export interface PromptSuppressedResponse {
  reason: string;
  /**
   * Le littéral `"suppressed"` — union à un membre, vérifiée au décodage.
   */
  status: "suppressed";
}

/**
 * L'union **du corps de la route push** : le désabonnement est essayé
 * **d'abord** (précédence mesurée du fil — un corps `{unsubscribe}` n'est
 * jamais un abonnement), sinon l'abonnement.
 */
export type PushBody =
  | {
      unsubscribe: string;
    }
  | {
      endpoint: string;
      /**
       * Une valeur **présente** qui peut valoir null — l'homologue exact de
       * `Schema.NullOr(Schema.X)`.
       *
       * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
       * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
       * champ manquant — sans `default` serde, un champ absent est une erreur).
       *
       * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
       * `deserialize_option` : le `missing_field` de serde délègue à
       * `deserialize_option` — un champ absent deviendrait silencieusement
       * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
       * un null explicite devient `Nulle`, une valeur délègue à `T`.
       *
       * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
       * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
       * représentation réelle, pas la représentation par défaut étiquetée.
       */
      expirationTime?: number | null;
      /**
       * Les deux clefs d'identité d'un abonnement (inline mesuré) — `auth` puis
       * `p256dh`, orthographe exacte du fil.
       */
      keys: {
        auth: string;
        p256dh: string;
      };
    };

/**
 * Le contenu d'une notification, tel que le navigateur le reçoit.
 *
 * ⚠️ `tag` est la clef de groupage du pane : deux notifications du même
 * pane se remplacent au lieu de s'empiler. La composition du texte —
 * étiquettes D04, jamais « a terminé son travail » pour un agent disparu —
 * est l'affaire du service (T030) ; ici, la valeur va telle quelle.
 */
export interface PushPayload {
  body: string;
  /**
   * Clef de groupage (le pane) — Herdr ne la fournit pas, elle se déduit
   * de ce qu'on a.
   */
  tag: string;
  title: string;
  /**
   * La cible ouverte par un clic sur la notification.
   */
  url: string;
}

/**
 * Une question posée par un agent (`Question`) — contexte en tableau
 * (peut être vide : un fait, pas une absence).
 */
export interface Question {
  /**
   * Items: Un choix proposé (`Choix` de api.ts/question.ts) — les noms du fil
   * **restent** : `numero`, `libelle`, `selectionne`, `detail` (TECH §5 :
   * renommer les identifiants Rust ne change pas le fil).
   */
  choix: {
    detail?: string;
    libelle: string;
    numero: number;
    selectionne: boolean;
  }[];
  contexte: string[];
  invite?: string;
  texte: string;
}

/**
 * Une question tranchée (`QuestionAnsweredResponse`) — libellés du fil
 * exacts (`appliquee | transmise | refusee`).
 */
export interface QuestionAnsweredResponse {
  detail: string;
  /**
   * L'union fermée des états d'une réponse.
   */
  state: "appliquee" | "transmise" | "refusee";
  /**
   * Le littéral `"question-answered"` — union à un membre.
   */
  status: "question-answered";
}

/**
 * Cause d'une réponse de session : `absente | vide | invalide | io`.
 *
 * ⚠️ Ces quatre cas se confondent de loin, et les confondre produit soit une
 * erreur rouge en boucle, soit — pire — une vue qui ment :
 *
 * | Cause       | Sens                                     | Réponse          |
 * |-------------|------------------------------------------|------------------|
 * | [`Absente`] | le fichier n'existe pas encore            | 200, vide        |
 * | [`Vide`]    | le fichier existe, zéro entrée            | 200, vide        |
 * | [`Invalide`]| contenu illisible ou ligne tronquée       | 422              |
 * | [`Io`]      | permission, disque, erreur du système     | 502              |
 *
 * `absente` n'est **pas** une panne : Herdr annonce un `agent_session` valide
 * vers un fichier que Pi n'a pas encore créé (le JSONL naît au premier
 * message — mesuré sur un vrai agent devin). Les codes d'orthographe viennent
 * du fil actuel ; ne jamais requalifier un autre code.
 */
export type ReadCause = "absente" | "vide" | "invalide" | "io";

/**
 * Source d'une lecture de terminal — libellés exacts du fil.
 */
export type ReadSource = "visible" | "recent" | "recent_unwrapped" | "detection";

/**
 * Le signal de vie : le flux est établi, voici le curseur de départ
 * (`event: ready`, mesuré — `{ cursor }`).
 */
export interface Ready {
  cursor: number;
}

/**
 * Une image récente (`RecentImageSchema`) — millisecondes mesurées, jamais
 * recalées.
 */
export interface RecentImage {
  modifiedAt: number;
  path: string;
  size: number;
}

/**
 * La réponse d'images récentes (`RecentImagesResponse`).
 */
export interface RecentImagesResponse {
  /**
   * Items: Une image récente (`RecentImageSchema`) — millisecondes mesurées, jamais
   * recalées.
   */
  images: {
    modifiedAt: number;
    path: string;
    size: number;
  }[];
}

/**
 * L'ordre de resynchronisation : la continuité du journal n'est plus
 * garantie — recharger l'état complet, jamais croire à un trou.
 * (`event: resync`, mesuré — `{ reason: "truncated journal", resumeFrom }`.)
 */
export interface Resync {
  /**
   * La raison, telle qu'émise aujourd'hui : « truncated journal ». Une
   * chaîne, pas une union : le producteur reste libre de nommer mieux —
   * et le client l'affiche, il ne la devine pas.
   */
  reason: string;
  /**
   * L'identifiant **courant** du journal (B04 : repartir de là, sinon un
   * second resync revient à la boucle suivante).
   */
  resumeFrom: number;
}

/**
 * L'union fermée des états d'un envoi non parti (libellés du fil exacts).
 */
export type SendState = "attente" | "erreur" | "inconnu";

/**
 * La source de session d'un pane a changé (`event: session_changed`) —
 * **événement AJOUTÉ par la migration** (C26), pas mesuré sur le fil.
 *
 * ⚠️ La matière est **l'observation de la source seule** : le chemin publié
 * par Herdr (ou son absence). Aucun compteur de messages n'existe côté
 * Herdr — prétendre « nouveau message » exigerait de lire la session, ce
 * que le flux ne fait pas. Le client invalide, il ne devine pas.
 */
export interface SessionChanged {
  paneId: string;
  /**
   * La source APRÈS le changement — `null` quand elle a disparu (agent
   * parti ou chemin retiré) : un null mesuré, jamais un absent.
   */
  path: string | null;
}

/**
 * Une entrée de session **rendue au client** : la ligne brute entière, plus
 * les trois champs de position (mesuré sur `SessionEntrySchema`).
 */
export interface SessionEntry {
  id?: string;
  /**
   * Le parent, omissible ET nullable (`Schema.optional(Schema.NullOr)`) :
   * absent ≠ null — deux faits distincts.
   */
  parentId?: string | null;
  /**
   * La ligne JSONL **entière**, telle qu'écrite — aucun raw perdu.
   */
  raw: string;
  timestamp?: string;
  /**
   * Le type de la ligne, tel que la source l'a écrit — chaîne libre du
   * fil : les lecteurs tranchent, le contrat transporte.
   */
  type: string;
}

/**
 * Genre de la référence de session publiée par Herdr pour un agent.
 *
 * ⚠️ `path` est le seul cas observé en pratique (4 agents sur 4) ; `id`
 * existe au schéma et reste déclaré.
 */
export type SessionRefKind = "id" | "path";

/**
 * La réponse de session : quatre clauses nommées du fil (l'union
 * [`ReadCause`]), la page, et les curseurs **opaques** (le codec interne
 * appartient à `sessions`, TECH §5).
 */
export interface SessionResponse {
  /**
   * **Additif T025** : `caughtUp` = vrai au seul watermark COMPLET
   * observé — le client sait que rien ne reste derrière lui. Présent sur
   * le fil seulement quand vrai : les réponses du fil actuel (sans ce
   * champ) restent fidèles, et le corpus gelé passe inchangé.
   */
  caughtUp?: boolean;
  /**
   * Cause d'une réponse de session : `absente | vide | invalide | io`.
   *
   * ⚠️ Ces quatre cas se confondent de loin, et les confondre produit soit une
   * erreur rouge en boucle, soit — pire — une vue qui ment :
   *
   * | Cause       | Sens                                     | Réponse          |
   * |-------------|------------------------------------------|------------------|
   * | [`Absente`] | le fichier n'existe pas encore            | 200, vide        |
   * | [`Vide`]    | le fichier existe, zéro entrée            | 200, vide        |
   * | [`Invalide`]| contenu illisible ou ligne tronquée       | 422              |
   * | [`Io`]      | permission, disque, erreur du système     | 502              |
   *
   * `absente` n'est **pas** une panne : Herdr annonce un `agent_session` valide
   * vers un fichier que Pi n'a pas encore créé (le JSONL naît au premier
   * message — mesuré sur un vrai agent devin). Les codes d'orthographe viennent
   * du fil actuel ; ne jamais requalifier un autre code.
   */
  cause: "absente" | "vide" | "invalide" | "io";
  cursor?: string;
  /**
   * Items: Une entrée de session **rendue au client** : la ligne brute entière, plus
   * les trois champs de position (mesuré sur `SessionEntrySchema`).
   */
  entries: {
    id?: string;
    /**
     * Le parent, omissible ET nullable (`Schema.optional(Schema.NullOr)`) :
     * absent ≠ null — deux faits distincts.
     */
    parentId?: string | null;
    /**
     * La ligne JSONL **entière**, telle qu'écrite — aucun raw perdu.
     */
    raw: string;
    timestamp?: string;
    /**
     * Le type de la ligne, tel que la source l'a écrit — chaîne libre du
     * fil : les lecteurs tranchent, le contrat transporte.
     */
    type: string;
  }[];
  hasMore: boolean;
  incremental: boolean;
  previousCursor?: string;
  reset: boolean;
  sessionPath: string;
}

/**
 * État de la conversation visible sur une ligne de conversation
 * (`available | absent | error`, B10).
 */
export type SessionState = "available" | "absent" | "error";

/**
 * Une interruption demandée (`StopAgentResponse`).
 */
export interface StopAgentResponse {
  /**
   * `interrupt-sent | not-running` — reçu, pas prouvé exécuté.
   */
  status: "interrupt-sent" | "not-running";
}

/**
 * L'union fermée des résultats d'arrêt.
 */
export type StopStatus = "interrupt-sent" | "not-running";

/**
 * Le corps d'abonnement (inline mesuré) — `expirationTime` omissible ET
 * nullable (`Schema.optional(Schema.NullOr(Schema.Number))`).
 */
export interface SubscribeRequest {
  endpoint: string;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  expirationTime?: number | null;
  /**
   * Les deux clefs d'identité d'un abonnement (inline mesuré) — `auth` puis
   * `p256dh`, orthographe exacte du fil.
   */
  keys: {
    auth: string;
    p256dh: string;
  };
}

/**
 * Les deux clefs d'identité d'un abonnement (inline mesuré) — `auth` puis
 * `p256dh`, orthographe exacte du fil.
 */
export interface SubscriptionKeys {
  auth: string;
  p256dh: string;
}

/**
 * Le corps d'acceptation de confiance (`TrustBody`, mesuré — `{ accept }`).
 */
export interface TrustRequest {
  accept: boolean;
}

/**
 * La confiance exigée avant d'agir (`TrustRequiredResponse`).
 */
export interface TrustRequiredResponse {
  folder: string;
  kind: string;
  message: string;
  paneId: string;
  /**
   * Le littéral `"trust-required"` — union à un membre.
   */
  status: "trust-required";
}

/**
 * La confiance tranchée (`TrustResolvedResponse`) — les libellés français
 * du fil exacts, aucune traduction.
 */
export interface TrustResolvedResponse {
  accepted: boolean;
  /**
   * L'union fermée des états de confiance (`transmise | acceptee | refusee |
   * non-applicable`).
   */
  state: "transmise" | "acceptee" | "refusee" | "non-applicable";
  /**
   * Le littéral `"trust-resolved"` — union à un membre.
   */
  status: "trust-resolved";
}

/**
 * L'union fermée des états de confiance (`transmise | acceptee | refusee |
 * non-applicable`).
 */
export type TrustState = "transmise" | "acceptee" | "refusee" | "non-applicable";

/**
 * Le corps de désabonnement (inline mesuré — `{ unsubscribe: endpoint }`).
 */
export interface UnsubscribeRequest {
  unsubscribe: string;
}

/**
 * Une ligne de workspace de l'overview (homologue de `WorkspaceViewSchema`).
 */
export interface WorkspaceView {
  agentPanes: string[];
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  agentStatus: ("idle" | "working" | "blocked" | "done" | "unknown") | null;
  /**
   * Le chemin réel où lancer un agent — absent plutôt qu'inventé (D02).
   */
  checkoutPath: string | null;
  focused: boolean;
  /**
   * Une valeur **présente** qui peut valoir null — l'homologue exact de
   * `Schema.NullOr(Schema.X)`.
   *
   * ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
   * `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
   * champ manquant — sans `default` serde, un champ absent est une erreur).
   *
   * ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
   * `deserialize_option` : le `missing_field` de serde délègue à
   * `deserialize_option` — un champ absent deviendrait silencieusement
   * `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
   * un null explicite devient `Nulle`, une valeur délègue à `T`.
   *
   * ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
   * serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
   * représentation réelle, pas la représentation par défaut étiquetée.
   */
  label: string | null;
  paneCount: number;
  tabCount: number;
  workspaceId: string;
}

