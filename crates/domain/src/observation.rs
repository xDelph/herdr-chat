//! Observations du monde Herdr et vues normalisées.
//!
//! ⚠️ **Une observation, c'est une valeur dans une enveloppe datée.** Le
//! rafraîchissement applique la génération ; le domaine n'a ni horloge ni
//! compteur — il ne fournit que l'ordre (`Generation`), pour qu'un
//! rafraîchissement plus lent ne remplace **jamais** une observation plus
//! récente (TECH §4).
//!
//! Les champs `Option` distinguent l'**absence** de Herdr d'une valeur vide ;
//! là où la distinction n'a plus de conséquence, un vecteur vide suffit. Les
//! tableaux `Option<Vec<_>>` (`tabs`, `layouts`) existent parce que la mesure
//! a vu des snapshots sans dispositions (24 livrées d'un coup quand elles
//! existent) — la distinction reste utile au diagnostic.

use crate::ids::{AgentKind, AgentName, PaneId, SessionId, TabId, WorkspaceId};

/// Compteur monotone d'observation (snapshot ou magasin de session).
///
/// Un rafraîchissement de génération inférieure ne remplace pas une valeur de
/// génération supérieure : l'application l'impose, l'ordre est ici sa base.
#[derive(
    Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct Generation(pub u64);

impl Generation {
    /// La valeur brute — pour traces et comparaisons logées.
    #[must_use]
    pub fn valeur(self) -> u64 {
        self.0
    }
}

/// Estampille d'observation en **millisecondes**, injectée par l'application
/// depuis son port d'horloge. Le domaine n'a pas d'horloge.
#[derive(
    Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct Millis(pub u64);

/// Une valeur observée : **quoi**, à **quelle génération**, vu **quand**.
///
/// ⚠️ Un snapshot **vide est une observation valide** (absence mesurée) —
/// l'enveloppe ne porte aucun drapeau « cache vide » : la valeur vide parle.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Observation<T> {
    pub value: T,
    pub generation: Generation,
    pub observed_at: Millis,
}

/// Ce que le monde amont déclare de lui-même (version du daemon, protocole du
/// fil). Détaché du snapshot : un `ping` suppose aussi son échange de santé.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SnapshotProvenance {
    /// Version exposée par Herdr (mesurée telle quelle, jamais déduite).
    pub version: String,
    /// Numéro de protocole — conditionne tout le reste (payload strict).
    pub protocol: u64,
}

/// Réponse de santé amont, telle que produite par `ping`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct UpstreamPing {
    pub protocol: u64,
    pub version: String,
}

/// Genre de la référence de session publiée par Herdr pour un agent.
///
/// ⚠️ `path` est le seul cas observé en pratique (4 agents sur 4) ; `id`
/// existe au schéma et reste déclaré.
#[derive(
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Debug,
    serde::Serialize,
    serde::Deserialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum SessionRefKind {
    Id,
    Path,
}

/// Le lien Herdr → fichier de session d'un agent.
///
/// ⚠️ C'est **la** donnée qui évite toute détection de fichier — D008 : le
/// chemin vient de Herdr, jamais un chemin n'est deviné.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AgentSessionRef {
    pub kind: SessionRefKind,
    pub value: String,
}

/// Un agent, tel que Herdr le décrit dans son snapshot.
///
/// Les identités de bases (`pane_id`, `tab_id`, `workspace_id`, `revision`,
/// `agent_status`, `focused`) sont requises par le schéma Herdr ; tout le
/// reste est absent ou nul selon l'instance. `state_labels`/`tokens` sont
/// volontairement absents d'ici : aucune vue ne les a jamais consommés.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AgentObservation {
    pub pane_id: PaneId,
    pub tab_id: TabId,
    pub workspace_id: WorkspaceId,
    /// Identifiant du terminal porteur — opaque, routé par Herdr-client.
    pub terminal_id: String,
    pub revision: u64,
    pub status: crate::status::AgentStatus,
    pub focused: bool,
    /// Type d'agent ; `None` = Herdr ne le dit pas — un signe **neutre**,
    /// jamais la marque d'un voisin.
    pub agent: Option<AgentKind>,
    /// Nom **choisi** ; absent pour un agent lancé à la main (mesuré).
    pub name: Option<AgentName>,
    /// Titre du terminal — brut, glyphes d'état compris : les deux lectures
    /// sont renvoyées et c'est l'index amont qui tranche (SessionLocator).
    pub terminal_title: Option<String>,
    pub cwd: Option<String>,
    pub foreground_cwd: Option<String>,
    pub completion_seq: Option<u64>,
    pub state_change_seq: Option<u64>,
    /// Le chemin que Herdr expose pour la session, tel quel.
    pub session: Option<AgentSessionRef>,
}

/// Dossier de travail d'un projet, tel que le workspace le porte.
///
/// ⚠️ `checkout_path` est le chemin où lancer un agent ; il est souvent
/// `null` — le `cwd` du premier pane du projet prend alors le relais
/// (`naming::checkout_path_of`), jamais l'inverse.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct WorkspaceWorktree {
    pub checkout_path: String,
    pub is_linked_worktree: bool,
    pub repo_key: String,
    pub repo_name: String,
    pub repo_root: String,
}

/// Un workspace du snapshot : la source de l'écran d'accueil.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct WorkspaceObservation {
    pub workspace_id: WorkspaceId,
    pub label: Option<String>,
    pub agent_status: Option<crate::status::AgentStatus>,
    /// `None` = absence, distinct d'un `false` mesuré.
    pub focused: Option<bool>,
    pub number: Option<u64>,
    pub pane_count: Option<u64>,
    pub tab_count: Option<u64>,
    pub active_tab_id: Option<TabId>,
    pub worktree: Option<WorkspaceWorktree>,
}

/// Un onglet Herdr. `label` et `number` sont toujours présents côté Herdr ;
/// `agent_status` est une chaîne libre côté amont, convertie vers
/// [`crate::status::AgentStatus`] seulement quand elle appartient à l'union
/// fermée — jamais supposée.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TabObservation {
    pub tab_id: TabId,
    pub workspace_id: WorkspaceId,
    pub label: Option<String>,
    pub number: u64,
    pub agent_status: Option<String>,
    pub pane_count: Option<u64>,
}

/// Rectangle d'un pane dans sa disposition, en **cellules de terminal**
/// (mesuré : `190×82` pour une fenêtre pleine). Il situe et ordonne ; il ne
/// mesure aucun écran.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RectCell {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

/// Un pane dans la disposition de son tab.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LayoutPane {
    pub pane_id: PaneId,
    pub focused: bool,
    pub rect: RectCell,
}

/// Disposition d'un tab — **déjà présente dans le snapshot** (`layouts`),
/// ce qui rend le rang d'un pane gratuit. `splits` existe aussi côté Herdr et
/// n'est pas décrit ici : on ne déclare que ce qu'on lit.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PaneLayoutObservation {
    pub tab_id: TabId,
    pub workspace_id: WorkspaceId,
    pub focused_pane_id: PaneId,
    pub panes: Vec<LayoutPane>,
}

/// Photo complète de l'état, telle que produite par `session.snapshot`.
///
/// `tabs` et `layouts` tiennent dans `Option` parce que la mesure a vu des
/// snapshots sans : absent ≠ vide — le premier plante le diagnostic, le
/// second tient à la géométrie du moment.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Snapshot {
    pub agents: Vec<AgentObservation>,
    pub workspaces: Vec<WorkspaceObservation>,
    pub tabs: Option<Vec<TabObservation>>,
    pub layouts: Option<Vec<PaneLayoutObservation>>,
    pub focused_pane: Option<PaneId>,
    pub focused_tab: Option<TabId>,
    pub focused_workspace: Option<WorkspaceId>,
    pub provenance: Option<SnapshotProvenance>,
    /// Tous les panes du snapshot (`panes[]`), agents ou non, dans l'ordre
    /// du fil — vide quand le fil ne les porte pas. ⚠️ Seule source du
    /// dossier d'un projet dont aucun pane n'est un agent (D02).
    pub panes: Vec<SituatedPane>,
}

impl Snapshot {
    /// Le protocole amont, quand l'observation le porte.
    #[must_use]
    pub fn protocol(&self) -> Option<u64> {
        self.provenance.as_ref().map(|p| p.protocol)
    }

    /// La version amont, quand l'observation la porte.
    #[must_use]
    pub fn version(&self) -> Option<&str> {
        self.provenance.as_ref().map(|p| p.version.as_str())
    }
}

/// Un pane tel que le snapshot le situe : sa place de travail, rien de plus.
///
/// ⚠️ `cwd` est la source du dossier de travail d'un projet : `worktree` est
/// souvent absent, chaque pane en porte un.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SituatedPane {
    pub pane_id: PaneId,
    pub workspace_id: Option<WorkspaceId>,
    pub cwd: Option<String>,
}

/// Réponse d'un `agent.list`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AgentListObservation {
    pub agents: Vec<AgentObservation>,
}

/// Source d'une lecture de terminal — libellés exacts du fil.
#[derive(
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Debug,
    serde::Serialize,
    serde::Deserialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ReadSource {
    Visible,
    Recent,
    RecentUnwrapped,
    Detection,
}

/// Le texte vu sur le terminal d'un pane, et seulement ce qui a été mesuré.
///
/// ⚠️ Champs optionnels volontaires : une charge partielle reste exploitable
/// plutôt que de faire échouer la lecture (« dégradé propre »).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ScreenObservation {
    pub pane_id: PaneId,
    pub text: Option<String>,
    pub truncated: Option<bool>,
    pub source: Option<ReadSource>,
}

/// Corrélation dossier pane ↔ dossier session : **trois états, pas deux**.
///
/// ⚠️ `Unverifiable` n'est **pas** `Mismatched` : l'un dit « les deux
/// existent et diffèrent », l'autre « je ne peux pas vérifier ». Les
/// confondre a fait disparaître des agents bien portants de la liste.
#[derive(
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Debug,
    serde::Serialize,
    serde::Deserialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum CwdMatch {
    Matched,
    Mismatched,
    Unverifiable,
}

impl CwdMatch {
    /// Mesurée sur des chaînes exactes : le comparaison TS est `===`, aucun
    /// plafond de barre oblique ne la normalise — reproduit tel quel.
    #[must_use]
    pub fn from_parts(cwd: Option<&str>, session_cwd: Option<&str>) -> Self {
        match (cwd, session_cwd) {
            (Some(pane), Some(session)) if pane == session => Self::Matched,
            (Some(_), Some(_)) => Self::Mismatched,
            _ => Self::Unverifiable,
        }
    }

    /// La traduction vers `boolean | null` du fil, quand une seule décision
    /// suffit (`true | false | null` = non vérifiable).
    #[must_use]
    pub fn as_bool(self) -> Option<bool> {
        match self {
            Self::Matched => Some(true),
            Self::Mismatched => Some(false),
            Self::Unverifiable => None,
        }
    }
}

/// Ligne de la liste d'agents **telle que l'application sait l'exposer**.
///
/// Homologue exact de `AgentViewSchema` (`api.ts`) : les conversions vers les
/// DTO filaires appartiennent à `contracts` et sont exhaustives. Les règles
/// de remplissage (nom defaulted, rang, corrélation cwd) sont le périmètre de
/// l'enrichissement applicatif (T039) — aucune n'est réimplémentée ici.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AgentView {
    pub pane_id: PaneId,
    pub tab_id: TabId,
    pub workspace_id: WorkspaceId,
    pub agent: Option<AgentKind>,
    pub status: crate::status::AgentStatus,
    pub focused: bool,
    pub name: Option<AgentName>,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub tab_label: Option<String>,
    pub tab_number: Option<u64>,
    pub workspace_label: Option<String>,
    /// Rang du pane dans son tab, en ordre de lecture ; `None` quand la
    /// disposition n'a pas été lue.
    pub pane_rank: Option<u64>,
    /// Combien de panes compte le tab ; `1` = l'agent est seul.
    pub tab_pane_count: u64,
    pub session_kind: Option<SessionRefKind>,
    /// Le chemin Herdr a exposé (ou la base résolue) — jamais deviné.
    pub session_path: Option<String>,
    pub session_id: Option<SessionId>,
    /// Dossier de travail déclaré par le fichier de session.
    pub session_cwd: Option<String>,
    pub parent_session: Option<SessionId>,
    /// `Unverifiable` = volontairement distinct de « faux ».
    pub session_cwd_matches: CwdMatch,
}

/// Ligne d'un workspace de l'overview.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct WorkspaceView {
    pub workspace_id: WorkspaceId,
    pub label: Option<String>,
    pub agent_status: Option<crate::status::AgentStatus>,
    pub pane_count: u64,
    pub tab_count: u64,
    pub focused: bool,
    /// Chemin réel où lancer un agent — D02 : le worktree lié gagne, sinon le
    /// premier `cwd` de pane du projet ; absent plutôt qu'inventé.
    pub checkout_path: Option<String>,
    /// Panes d'agents de ce projet, pour savoir s'il y en a déjà un.
    pub agent_panes: Vec<PaneId>,
}
