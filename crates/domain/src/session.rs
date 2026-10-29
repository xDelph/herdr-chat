//! Modèles de lecture de session : messages, réglages, raw, pages.
//!
//! ⚠️ **Le contenu et le rattrapage ne viennent jamais d'Herdr** — la session
//! se lit ici côté contenu, ailleurs côté état. Les formes ci-dessous sont le
//! **contrat d'entrée** de tout le produit : `LignePi` (message) et `ChangePi`
//! (changement de réglage) sont la forme commune que chaque adaptateur de
//! famille produit — jamais un format qui dépend de ses producteurs.
//!
//! ⚠️ **Le raw reste public.** Une ligne qu'on ne sait pas encore interpréter
//! est conservée telle quelle (`RetainedUnknown`) : une capacité absente
//! s'affiche comme absente, elle n'est jamais remplacée par un substitut
//! inventé.

use crate::ids::{AgentKind, PaneId, SessionId, SourceKey};
use crate::observation::AgentSessionRef;

/// Une entrée de session, telle que le fil la rend — publique, y compris son
/// `raw`. ⚠️ Les clefs restent celles du fil (`type`, `parentId`) pour que le
/// public ne voie aucune réécriture.
#[derive(Clone, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
pub struct SessionEntry {
    /// Le `type` du fil (`message`, `bash`…), libre par façon de famille.
    #[serde(rename = "type")]
    pub kind: String,
    pub id: Option<String>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
    /// Le contenu **brut**, conservé tel quel — la compatibilité est le
    /// contrat, pas une commodité.
    pub raw: String,
    pub timestamp: Option<String>,
}

/// Le contenu d'un message pi, typé assez pour être **lu sans assertion**.
#[derive(Clone, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiMessage {
    /// Resté libre : le message au-delà des conversions nommées est du raw.
    pub content: serde_json::Value,
    pub role: Option<String>,
    #[serde(rename = "toolName")]
    pub tool_name: Option<String>,
    pub phase: Option<String>,
    pub command: Option<String>,
    pub output: Option<String>,
    pub exit_code: Option<i64>,
    pub cancelled: Option<bool>,
    pub truncated: Option<bool>,
    /// Un résultat d'outil en échec (`is_error` de l'API claude).
    #[serde(rename = "isError")]
    pub is_error: Option<bool>,
    /// Modèle, fournisseur et niveau de raisonnement **du message**.
    ///
    /// ⚠️ Ces trois champs comptent plus qu'un `model_change` : le modèle est
    /// écrit sur chaque message, un changement seulement au moment où il
    /// change. Mesuré sur les cinq sources.
    pub model: Option<String>,
    pub provider: Option<String>,
    #[serde(rename = "thinkingLevel")]
    pub thinking_level: Option<String>,
}

/// Une ligne **message**, dans la forme commune pi.
#[derive(Clone, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
pub struct LignePi {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: Option<String>,
    pub timestamp: Option<String>,
    pub message: PiMessage,
}

/// Message normalisé — le nom porté par la politique du normalisateur.
pub type NormalizedMessage = LignePi;

/// Nature d'un changement de réglage — union fermée au fil.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, serde::Serialize, serde::Deserialize)]
pub enum ReglageKind {
    #[serde(rename = "model_change")]
    ModelChange,
    #[serde(rename = "thinking_level_change")]
    ThinkingLevelChange,
}

/// Une ligne de **changement de réglage**, telle que pi l'écrit.
#[derive(Clone, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePi {
    #[serde(rename = "type")]
    pub kind: ReglageKind,
    pub model_id: Option<String>,
    pub provider: Option<String>,
    #[serde(rename = "thinkingLevel")]
    pub thinking_level: Option<String>,
    pub timestamp: Option<String>,
}

/// Réglage normalisé — le nom porté par la politique du normalisateur.
pub type NormalizedSettings = ChangePi;

/// Une ligne **inconnue**, conservée en raw du JSON — ni tableau, ni `null`.
///
/// La forme exacte est vérifiée par les conservateurs de lignes (sessions,
/// T023) ; ici, un objet JSON est la valeur du contrat « retenu, pas perdu ».
#[derive(Clone, PartialEq, Debug, serde::Serialize, serde::Deserialize)]
pub struct RetainedUnknown {
    pub raw: serde_json::Value,
}

/// Contexte volontairement filtré — la ligne existe, on choisit de ne pas la
/// montrer. Ce n'est ni une absence ni une panne ; la raison détaillée
/// arrive avec le pipeline de lecture (T023), qui en porte la preuve.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, serde::Serialize, serde::Deserialize)]
pub struct FilteredContext;

/// Ce que le normalisateur peut rendre : **exactement quatre conséquences**,
/// toutes nommées.
///
/// ⚠️ Le message porte le plus de matière (`serde_json::Value` du contenu) :
/// il vit en boîte, pour que l'énum reste raisonnable à porter en masse.
#[derive(Clone, PartialEq, Debug)]
pub enum NormalizedEntry {
    Message(Box<LignePi>),
    Settings(ChangePi),
    Unknown(RetainedUnknown),
    Filtered(FilteredContext),
}

/// Une session telle que le résolveur la connaît : **deux kinds, pas deux
/// fichiers**, et la famille explicite — aucun repli implicite d'un agent
/// vers le profil d'un autre.
#[derive(Clone, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    File,
    Sqlite,
}

/// Une référence résolue : où lire la session, et pour quelle famille.
///
/// ⚠️ Pour opencode/devin, `base` est le fichier SQLite **du magasin** —
/// c'est ce qui rend l'agent visible. Le chemin du magasin est le bon,
/// jamais un chemin de session deviné.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ResolvedSource {
    pub kind: SourceKind,
    /// Chemin du fichier JSONL — ou de la base SQLite.
    pub base: String,
    /// Identifiant de session chez le magasin ; requis côté lecture sqlite.
    pub session_id: Option<SessionId>,
    /// La famille d'agent qui a résolu cette référence (`pi`, `devin`…).
    /// Les codecs de famille sont choisis **en appelant**, pas par repli.
    pub family: Option<AgentKind>,
}

/// Tout ce que le résolveur sait du monde avant de chercher.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SessionHint {
    pub agent: Option<AgentKind>,
    /// Le chemin que Herdr a exposé, tel quel — le meilleur départ.
    pub published: Option<AgentSessionRef>,
    /// Titre du terminal, brut — glyphes compris ; les deux lectures sont
    /// proposées et l'index amont tranche.
    pub title: Option<String>,
    pub cwd: Option<String>,
}

/// La demande d'une page de session.
///
/// ⚠️ Les curseurs sont **opaques** : le domaine ne les construit pas, ne les
/// interprète pas. Le secret interne (dév/ino/offset) appartient à la
/// sessions crate — un `offset` nu désignerait un autre endroit après une
/// réécriture, sans erreur visible.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SessionPageRequest {
    pub source: ResolvedSource,
    pub cursor: Option<String>,
    /// Curseur opaque pour la page précédente de l'historique.
    pub previous_cursor: Option<String>,
    pub limit: u32,
}

/// Une page de session prête : entrées, suite, rattrapage.
#[derive(Clone, PartialEq, Debug)]
pub struct SessionPage {
    /// Le chemin exposé à l'appelant (chemin réel du fichier ou du magasin).
    pub session_path: String,
    pub entries: Vec<SessionEntry>,
    /// `true` quand seule la suite a été renvoyée (mode incrémental).
    pub incremental: bool,
    /// Curseur à renvoyer au prochain appel ; absent quand la session est neuve.
    pub cursor: Option<String>,
    pub previous_cursor: Option<String>,
    /// `true` quand des entrées précédentes existent mais n'ont pas été renvoyées.
    pub has_more: bool,
    /// `true` quand le curseur fourni ne vaut plus (dév/ino changés) : le
    /// client **remplace** sa vue, il n'y ajoute pas.
    pub reset: bool,
    /// **C18** : vrai au seul watermark COMPLET observé — le client sait que
    /// rien ne reste derrière lui. Présent sur le fil seulement quand vrai.
    pub rattrape: bool,
}

/// Le résultat d'une lecture de page : des clauses **toutes nommées**.
///
/// ⚠️ `absente` n'est **pas** une panne : Herdr annonce un chemin valide vers
/// un fichier que Pi n'a pas encore créé (le JSONL naît au premier message).
/// `vide` distingue « décidé à ouvrir, rien dedans » — B03 : quatre causes,
/// pas trois, pas un 502 indifférencié. L'erreur (première page, curseur
/// périmé, base manquante…) est une `ErreurDomaine` **typée** — la
/// cartographie HTTP de H04 est dans `http-api::errors` (400/403/404/409/
/// 422/502/503), aucune exception n'en sort.
#[derive(Clone, PartialEq, Debug)]
pub enum SessionPageOutcome {
    /// Une page lue — `cause` du fil : `vide` (mesuré : même non vide, le
    /// fil répond `cause:"vide"`).
    Page(SessionPage),
    /// Le fichier n'existe pas encore (ou la ligne de session n'existe pas
    /// chez le magasin) — bénin, ne réessaie pas en boucle. La page porte
    /// le contexte de réponse (curseur, reset, incremental).
    Absente(SessionPage),
    /// Le fichier existe, zéro entrée — bénin. La page porte le contexte.
    Vide(SessionPage),
    /// Contenu illisible ou tronqué — distinct de `io` (panne d'accès).
    Invalide { detail: String },
    /// Permission, disque, erreur du système.
    Io { detail: String },
}

/// Ce que la lecture du **fichier** de session a pu dire des réglages.
///
/// ⚠️ **Rien n'est complété avec un modèle supposé.** Le modèle en vigueur
/// (« deux sources, la plus récente gagne » : changement déclaré ou dernier
/// message) est le périmètre du réducteur de métadonnées (T022/T023) ;
/// ici, absent = absent.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct SessionMetadata {
    /// Dernier modèle **déclaré**, jamais un modèle par défaut.
    pub model: Option<String>,
    /// Fournisseur explicite (`model_change`, ou le message lui-même).
    pub provider: Option<String>,
    /// Niveau de raisonnement en vigueur, ramené à un seul nom.
    pub thinking: Option<String>,
    /// Dernière **demande de l'utilisateur** — distincte de l'aperçu (réponse).
    pub last_prompt: Option<String>,
    /// Aperçu : dernier message texte de l'agent. Absent s'il n'y en a pas.
    pub preview: Option<String>,
    /// Horodatage de la dernière activité connue. **Absent plutôt qu'à 0.**
    pub timestamp: Option<u64>,
    /// L'identifiant que l'**en-tête** de la session déclare (Pi :
    /// `{"type":"session","id":…}`) — absent quand la source n'en a pas.
    pub session_id: Option<String>,
    /// Le dossier de travail que l'en-tête déclare — la moitié « session »
    /// du tri-état `sessionCwdMatches` (D03).
    pub cwd: Option<String>,
    /// La session parente que l'en-tête déclare (`parentSession`).
    pub parent_session: Option<String>,
}

/// La relation pane ⇄ source, **les deux clés ensemble**.
///
/// ⚠️ **Le sujet est exprimé par le type lui-même** : une liaison porte le
/// pane d'origine **et** la clef de la source. Deux liaisons sont égales
/// seulement si les deux membres le sont :
///
/// - même clef de source, autre pane → pas la même liaison (le réseau des
///   panes bouge, la source non) ;
/// - même pane, autre clef → le pane a changé de session.
///
/// Conserver une source pour un pane **ne démontre rien** pour un autre
/// pane, même si la chaîne interne se ressemble — c'est la classe d'incidents
/// C12/C20 (une réponse tardive qui écrase le pane d'à côté).
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct SourceBinding {
    pub pane: PaneId,
    pub source: SourceKey,
}
