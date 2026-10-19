//! Les six charges d'événements **SSE nommées** — plus de `data: unknown`.
//!
//! ⚠️ Formes mesurées sur le producteur actuel (routes-events.ts,
//! EventHub.ts, AgentWatcher.ts), pas déduites : `ready` et `resync` sont
//! écrits à la main dans la boucle de flux ; les autres viennent de
//! `hub.publish(kind, data)`.
//!
//! Chaque charge est un DTO typé : le client ne devine plus rien.

use crate::presence::Nullable;
use serde::{Deserialize, Serialize};

/// L'enveloppe SSE entière — `{"event": nom, "data": charge}` telle que la
/// boucle de flux l'écrit (mesuré sur routes-events.ts) : le nom d'événement
/// et sa charge sont **inséparables** au décodage. `agent_status` porte un
/// soulignement (mesuré), les autres des traits d'union.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "event", content = "data", rename_all = "kebab-case")]
pub enum EvenementSse {
    Ready(Ready),
    #[serde(rename = "agent_status")]
    AgentStatus(AgentStatusChanged),
    Prompt(PromptDelivered),
    PromptSuppressed(PromptSuppressed),
    AgentLaunched(AgentLaunched),
    /// Événement AJOUTÉ par la migration (C26), jamais mesuré sur le fil :
    /// la source de session d'un pane a changé, le client relit la page.
    /// Le nom garde le soulignement de `agent_status`, pas un trait d'union.
    #[serde(rename = "session_changed")]
    SessionChanged(SessionChanged),
    Resync(Resync),
}

/// Le signal de vie : le flux est établi, voici le curseur de départ
/// (`event: ready`, mesuré — `{ cursor }`).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Ready {
    pub cursor: u64,
}

/// L'ordre de resynchronisation : la continuité du journal n'est plus
/// garantie — recharger l'état complet, jamais croire à un trou.
/// (`event: resync`, mesuré — `{ reason: "truncated journal", resumeFrom }`.)
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Resync {
    /// La raison, telle qu'émise aujourd'hui : « truncated journal ». Une
    /// chaîne, pas une union : le producteur reste libre de nommer mieux —
    /// et le client l'affiche, il ne la devine pas.
    pub reason: String,
    /// L'identifiant **courant** du journal (B04 : repartir de là, sinon un
    /// second resync revient à la boucle suivante).
    pub resume_from: u64,
}

/// L'état d'un prompt, tel qu'annoncé sur le flux — l'union fermée du fil
/// (`"sent"`), jamais un état inventé.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PromptStatus {
    Sent,
}

/// La confirmation d'un prompt livré (`event: prompt`, mesuré —
/// `{ paneId, confirmation, fingerprint, status }`, la charge étant la
/// réponse `PromptSentResponse` complétée du pane).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptDelivered {
    pub pane_id: String,
    /// `confirmed` | `unknown` — l'union du fil : une réponse sans preuve
    /// d'acceptation reste inconnue (A02).
    pub confirmation: Confirmation,
    pub fingerprint: String,
    pub status: PromptStatus,
}

/// L'union fermée de confirmation du fil (`"confirmed" | "unknown"`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Confirmation {
    Confirmed,
    Unknown,
}

/// Un double envoi assumé (`event: prompt-suppressed`, mesuré —
/// `{ paneId, reason }`), D007.2 : pas une erreur, un no-op nommé.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PromptSuppressed {
    pub pane_id: String,
    pub reason: String,
}

/// Un agent lancé (`event: agent-launched`, mesuré —
/// `{ kind, paneId, workspaceId }`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunched {
    pub kind: String,
    pub pane_id: String,
    pub workspace_id: String,
}

/// La source de session d'un pane a changé (`event: session_changed`) —
/// **événement AJOUTÉ par la migration** (C26), pas mesuré sur le fil.
///
/// ⚠️ **Aucun chemin, aucun texte** (TECH §7) : la charge ne porte qu'un
/// `paneId` et une **révision opaque** de la source observée. Le client n'a
/// qu'une question à trancher — « la source a-t-elle changé ? » — et il
/// invalide sa vue ; il ne devine pas de contenu, et le chemin de session ne
/// traverse pas le flux.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionChanged {
    pub pane_id: String,
    /// L'empreinte stable de l'identité de source APRÈS le changement —
    /// **opaque** (16 hexadécimaux), jamais réversible vers un chemin.
    /// Deux observations de la même source donnent la même révision : le
    /// veilleur ne publie donc rien (T053 : « repeated observations … are
    /// coalesced »).
    pub source_revision: String,
}

/// Le genre de changement d'état, union fermée mesurée d'AgentWatcher
/// (`"status" | "appeared" | "disappeared"`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Status,
    Appeared,
    Disappeared,
}

/// Un état d'agent a changé (`event: agent_status`, mesuré —
/// `{ from, kind, paneId, to }`).
///
/// ⚠️ `from` est `null` quand l'agent **apparaît** (aucun état antérieur) —
/// un null mesuré, jamais un absent. `to` est le fil tel quel : `"gone"`
/// (agent disparu — **pas** un `AgentStatus`) ou un libellé d'état ; la
/// chaîne passe sans réécriture, l'affichage tranche.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusChanged {
    pub from: Nullable<String>,
    pub kind: ChangeKind,
    pub pane_id: String,
    pub to: String,
}
