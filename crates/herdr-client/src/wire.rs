//! Les formes du fil Herdr (protocol.ts, mesurées) — **privées à l'adaptateur
//! amont** : elles décodent Herdr, jamais le client HTTP (TECH §5 : les DTO
//! HTTP ne servent pas de décodeurs amont).

use serde::{Deserialize, Serialize};

/// L'union fermée des états d'agent côté fil — le domaine porte la même
/// union (`domain::status::AgentStatus`) ; ici, le décodage amont.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StatutAgent {
    Idle,
    Working,
    Blocked,
    Done,
    Unknown,
}

/// La source d'une référence de session (`id | path`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GenreRefSession {
    Id,
    Path,
}

/// La référence de session publiée par Herdr pour un agent (protocol.ts).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct InfoSessionAgent {
    pub agent: String,
    pub kind: GenreRefSession,
    pub source: String,
    pub value: String,
}

/// Un agent du fil Herdr — tous les champs protocol.ts, orthographe
/// `snake_case` native, champs omissibles-nullable **tels quels**.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct InfoAgent {
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent_session: Option<Option<InfoSessionAgent>>,
    pub agent_status: StatutAgent,
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub completion_seq: Option<Option<u64>>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub cwd: Option<Option<String>>,
    pub focused: bool,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub foreground_cwd: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub name: Option<Option<String>>,
    pub pane_id: String,
    pub revision: u64,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub state_change_seq: Option<u64>,
    pub tab_id: String,
    pub terminal_id: String,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub terminal_title: Option<Option<String>>,
    pub workspace_id: String,
}

fn presence_refus_null<'de, T, D>(deserialiseur: D) -> Result<Option<T>, D::Error>
where
    T: serde::de::DeserializeOwned,
    D: serde::Deserializer<'de>,
{
    struct Visiteur<T>(std::marker::PhantomData<T>);
    impl<'de, T: serde::de::DeserializeOwned> serde::de::Visitor<'de> for Visiteur<T> {
        type Value = Option<T>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("valeur ou absence — null refusé (omissible simple)")
        }
        fn visit_some<D2: serde::Deserializer<'de>>(self, d: D2) -> Result<Option<T>, D2::Error> {
            T::deserialize(d).map(Some)
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Option<T>, E> {
            Err(E::custom("null refusé sur champ omissible du fil amont"))
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Option<T>, E> {
            Err(E::custom("null refusé sur champ omissible du fil amont"))
        }
    }
    deserialiseur.deserialize_option(Visiteur(std::marker::PhantomData))
}

fn optionnel_nullable<'de, T, D>(deserialiseur: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::de::DeserializeOwned,
    D: serde::Deserializer<'de>,
{
    struct Visiteur<T>(std::marker::PhantomData<T>);
    impl<'de, T: serde::de::DeserializeOwned> serde::de::Visitor<'de> for Visiteur<T> {
        type Value = Option<Option<T>>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("valeur, null ou absence — trois faits distincts")
        }
        fn visit_some<D2: serde::Deserializer<'de>>(
            self,
            d: D2,
        ) -> Result<Option<Option<T>>, D2::Error> {
            T::deserialize(d).map(|v| Some(Some(v)))
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Option<Option<T>>, E> {
            Ok(Some(None))
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Option<Option<T>>, E> {
            Ok(Some(None))
        }
    }
    deserialiseur.deserialize_option(Visiteur(std::marker::PhantomData))
}

/// Le worktree d'un workspace (protocol.ts).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct InfoWorktree {
    pub checkout_path: String,
    pub is_linked_worktree: bool,
    pub repo_key: String,
    pub repo_name: String,
    pub repo_root: String,
}

/// Un workspace du fil.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct InfoWorkspace {
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub active_tab_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent_status: Option<Option<StatutAgent>>,
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub focused: Option<Option<bool>>,
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub label: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub number: Option<Option<u64>>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub pane_count: Option<u64>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub tab_count: Option<u64>,
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub worktree: Option<Option<InfoWorktree>>,
    pub workspace_id: String,
}

/// Un pane (protocol.ts).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct InfoPane {
    pub pane_id: String,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub tab_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub workspace_id: Option<String>,
}

/// La photo complète du fil (`session.snapshot` — l'enveloppe porte
/// protocol + version, mesuré).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct PhotoSession {
    pub agents: Vec<InfoAgent>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub focused_pane_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub focused_tab_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub focused_workspace_id: Option<String>,
    pub protocol: u64,
    pub version: String,
    pub workspaces: Vec<InfoWorkspace>,
}

/// La réponse de `ping` (PongPayload).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Pong {
    pub protocol: u64,
    pub version: String,
}

/// La réponse de `agent.list` (AgentListPayload).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct ListeAgents {
    pub agents: Vec<InfoAgent>,
}

/// La réponse de `agent.read` (PaneReadPayload).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct LecturePane {
    #[serde(
        default,
        deserialize_with = "optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub read: Option<Option<LectureInterieure>>,
}

/// L'intérieur de la lecture — text/truncated **omissibles** : une charge
/// partielle reste exploitable (dégradé propre), jamais inventée.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct LectureInterieure {
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub text: Option<String>,
    #[serde(
        default,
        deserialize_with = "presence_refus_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub truncated: Option<bool>,
}

/// La réponse de `tab.create` — `{ tab, root_pane }` (mesuré) : le pane
/// **à l'invite shell** où `agent.start` démarrera.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct OngletCree {
    pub tab: String,
    pub root_pane: String,
}
