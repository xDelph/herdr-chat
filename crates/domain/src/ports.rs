//! Les **cinq ports étroits** — tout le monde passe par eux.
//!
//! ⚠️ **Étroits, vraiment.** Un port expose ce que le domaine a besoin de
//! *savoir*, pas la forme du monde derrière. Les traits sont dyn-compatibles :
//! l'application les tient comme `dyn`, et chaque adaptateur en fournit une
//! implantation concrète — une seule famille à la fois, aucun repli implicite
//! vers le profil d'un autre agent.
//!
//! ⚠️ **Les preufs partielles ne sont pas un ornement.** Un envoi en deux
//! pas (texte puis entrée) qui échoue au second pas n'est ni « envoyé » ni
//! « raté » : c'est un état **incertain**, porté par ses étapes réelles
//! (`partial`). Ne jamais afficher un état qu'on ne peut pas vérifier.

use crate::catalog::{CatalogObservation, InstalledKindInstance, LaunchChoice, ValidatedArgs};
use crate::errors::PortError;
use crate::ids::{DeliveryFingerprint, PaneId, TabId};
use crate::notifications::{BrowserSubscription, PushPayload, VapidPublicKey};
use crate::observation::{AgentListObservation, ScreenObservation, Snapshot, UpstreamPing};
use crate::session::{
    ResolvedSource, SessionHint, SessionMetadata, SessionPageOutcome, SessionPageRequest,
};
use core::future::Future;
use core::pin::Pin;

/// Un résultat de port, en attente, exécutable sur n'importe quel exécuteur.
pub type PortFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, PortError>> + Send + 'a>>;

/// Le futur du port de session : l'erreur y est une [`ErreurDomaine`] typée
/// (et non un [`PortError`] de transport) — la carte H04 (400 curseurs, 403
/// chemin refusé, 404 pas de source, 409 périmé, 503 base manquante) se
/// consomme sans re-décision dans `http-api::errors`.
pub type SessionFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, crate::errors::ErreurDomaine>> + Send + 'a>>;

/// Étape concrète d'une action de transport, observée **avant** sa conclusion.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PartialStep {
    /// Le texte a été écrit dans le pane.
    LiteralTextWritten,
    /// La séquence « entrée » a été envoyée.
    EnterSequenceSent,
    /// Une séquence de touches a été envoyée.
    KeysSent,
}

/// Un envoi de prompt : texte, shell et cible — avec son empreinte de dedup.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TargetedPrompt {
    pub pane: PaneId,
    pub literal_text: String,
    pub fingerprint: DeliveryFingerprint,
}

/// Un texte littéral à écrire dans un pane (`pane.send_text`).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TargetedText {
    pub pane: PaneId,
    pub text: String,
}

/// Une séquence de touches pour un agent (`agent.send_keys`).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TargetedKeys {
    pub pane: PaneId,
    /// Touches telles que le transport les attend — opaques ici.
    pub keys: Vec<String>,
}

/// Province d'un envoi de transport brisé en trois, pas un booléen.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportOutcome {
    /// L'amont a accusé la réception.
    Delivered,
    /// Seul le transport a répondu, sans preuve d'acceptation.
    Unknown,
    /// L'amont a refusé : rien n'a été envoyé.
    Refused,
}

/// Ce qu'un envoi de transport (texte ou touches) a laissé comme trace.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TransportEvidence {
    pub outcome: TransportOutcome,
    /// Les étapes réellement accomplies — la preuve partielle.
    pub partial: Vec<PartialStep>,
    /// Ce que le monde a dit, tel quel — jamais reformulé en verdict.
    pub detail: String,
}

/// Ce qu'un prompt a produit — quatre conséquences, **toutes nommées**.
///
/// ⚠️ Aucune variante « sent » générique : un envnon confirmé n'est **jamais**
/// affiché comme envoyé. `Unknown` porte ses étapes partielles (B05 ;
/// C06/C07), y compris le cas mesuré « texte écrit, entrée refusée ».
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PromptEvidence {
    /// L'amont a confirmé le prompt : preuve du serveur, pas du client.
    Confirmed { fingerprint: DeliveryFingerprint },
    /// Non tranché dans le délai ou sans preuve d'acceptation :
    /// les étapes accomplies restent visibles.
    Unknown {
        partial: Vec<PartialStep>,
        detail: String,
    },
    /// Double envoi supprimé — **un état normal, pas une erreur**.
    Suppressed { reason: String },
    /// L'envoi n'a pas eu lieu ; le détail dit pourquoi, réellement.
    Failed { detail: String },
}

/// Le focus demandé a été appliqué, ou refusé avec sa raison.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum FocusEvidence {
    Focused,
    Refused { detail: String },
}

/// Une demande d'interruption.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum StopEvidence {
    /// Envoyée au terminal de l'agent courant — reçu, pas prouvé exécuté.
    InterruptSent,
    /// L'agent n'est pas en cours : il n'y avait rien à interrompre.
    NotRunning,
}

/// Création d'un tab non focalisé, avec son premier pane.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CreateTab {
    pub workspace: crate::ids::WorkspaceId,
    /// Dossier **connu** du workspace — jamais deviné (C07 : validé avant).
    pub cwd: String,
    pub label: Option<String>,
}

/// Ce qu'une création de tab a produit.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CreatedTab {
    pub tab: crate::ids::TabId,
    pub pane: PaneId,
}

/// Demande de lancement d'un agent dans **le** pane déjà créé.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct StartAgent {
    pub pane: PaneId,
    pub kind: crate::ids::AgentKind,
    pub name: Option<crate::ids::AgentName>,
    pub args: Vec<String>,
}

/// Ce qu'un lancement a produit. La confiance (`trust`) est une parmi
/// **séparée** : elle se lit sur l'écran après coup — jamais déduite du start.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum StartEvidence {
    /// L'amont a accepté : l'agent occupe son pane.
    Started { pane: PaneId },
    /// Le shell n'était pas prêt dans le délai (120 s vs 15 s socket, C07) :
    /// rejouable par la machine de lancement — pas une panne.
    ShellNotReady { detail: String },
    /// L'amont a refusé, avec sa cause réelle, phase structurelle à part.
    Failed { detail: String },
}

/// Une lecture de terminal bornée.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ScreenRead {
    pub pane: PaneId,
    pub max_lines: u32,
}

/// Une demande de fichier **par racine autorisée**.
///
/// ⚠️ Le contrôle d'accès appartient au port `files` (S03/S05) : c'est lui
/// qui vérifie la racine et le chemin. Ce type n'exprime que la demande.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AuthorizedFileRequest {
    /// Les racines AUTORISÉES de cette requête (dossiers des projets du
    /// snapshot + racines médias de la configuration), réévaluées à chaque
    /// requête.
    pub roots: AuthorizedRoots,
    /// Le chemin demandé, tel que le client l'a donné (jamais pré-nettoyé).
    /// La résolution puis le contrôle d'appartenance vivent dans le port
    /// (S03/S04) — un handler qui découperait le chemin réécrirait la garde
    /// ailleurs.
    pub requested: String,
}

/// Racines autorisées à l'exploration d'images récentes.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AuthorizedRoots {
    pub entries: Vec<String>,
}

/// Une image récente trouvée, telle qu'elle est.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RecentImageObservation {
    /// Millisecondes depuis l'époque — mesurées, pas recalées.
    pub modified_at: u64,
    pub path: String,
    pub size: u64,
}

/// Ce qu'un balayage d'images récentes a trouvé.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ImageScan {
    pub images: Vec<RecentImageObservation>,
}

/// Ce qu'un fichier ouvert a rendu.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ArtifactBody {
    /// Type MIME mesuré, tel qu'il est servi au navigateur.
    pub content_type: String,
    /// Nom proposé au téléchargement — omission = nom naturel du chemin.
    pub filename: Option<String>,
    /// `true` : rendu dans le navigateur ; `false` : téléchargé (S07 — ce
    /// qui n'est pas dans la liste blanche n'est jamais interprété).
    pub inline: bool,
    pub bytes: Vec<u8>,
}

/// État d'une remise de notification — **deux, pas trois**, parce qu'un envoi
/// push accepté mais non ventured est un état inconnu (A02 : jamais « envoyé »
/// sans preuve).
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum DeliveryOutcome {
    /// L'amont push a accusé la réception de la remise.
    Delivered { fingerprint: DeliveryFingerprint },
    /// Réponse sans preuve d'acceptation — déclaré tel quel.
    Unknown { detail: String },
}

/// Le port de contrôle Herdr : ce que le daemon amont sait faire **pour nous**.
///
/// Une seule responsabilité par méthode ; les détails de fil (`agent.prompt`
/// vs `pane.send_text` + touches) appartiennent à l'adaptateur.
pub trait ControlPort: Send + Sync {
    /// Interroge version + protocole amont — conditionne tout le reste.
    fn ping(&self) -> PortFuture<'_, UpstreamPing>;
    /// Une photo complète, une à la fois : le rafraîchissement applicatif
    /// coalescente, le port ne sait faire qu'une.
    fn snapshot(&self) -> PortFuture<'_, Snapshot>;
    /// La liste des agents portés par le snapshot ou `agent.list`.
    fn list_agents(&self) -> PortFuture<'_, AgentListObservation>;
    /// Lit le terminal d'un pane, borné.
    fn read_screen(&self, request: ScreenRead) -> PortFuture<'_, ScreenObservation>;
    /// Envoie un prompt — texte littéral puis entrée, preuves partielles incluses.
    fn prompt(&self, request: TargetedPrompt) -> PortFuture<'_, PromptEvidence>;
    /// Écrit du texte littéral dans un pane.
    fn send_text(&self, request: TargetedText) -> PortFuture<'_, TransportEvidence>;
    /// Envoie une séquence de touches.
    fn send_keys(&self, request: TargetedKeys) -> PortFuture<'_, TransportEvidence>;
    /// Focalise le pane d'un agent.
    fn focus(&self, pane: PaneId) -> PortFuture<'_, FocusEvidence>;
    /// Crée un tab non focalisé avec son premier pane, dossiers connus.
    fn create_tab(&self, request: CreateTab) -> PortFuture<'_, CreatedTab>;
    /// Lance un agent dans LE pane issu de `create_tab` (C07 : l'ordre est
    /// validé d'abord remplaçable, mais la séquence reste la séquence).
    fn start_agent(&self, request: StartAgent) -> PortFuture<'_, StartEvidence>;
    /// Ferme l'onglet **créé par cette opération** — le nettoyage possédé
    /// seulement (T037/C07) : jamais un onglet d'une autre opération, jamais
    /// un onglet qui pourrait porter un agent amorcé ou incertain. Les
    /// erreurs sont ignorées par l'appelant (nettoyage au mieux).
    fn fermer_onglet(&self, tab: TabId) -> PortFuture<'_, ()>;
    /// Demande l'interruption d'un agent courant.
    fn stop(&self, pane: PaneId) -> PortFuture<'_, StopEvidence>;
}

/// Le port de sessions : résoudre, paginer, décrire des réglages.
pub trait SessionPort: Send + Sync {
    /// Résout une source depuis tout ce que le résolveur sait. `None` quand
    /// **rien ne prouve** une session : c'est une valeur, pas une panne.
    fn resolve(&self, hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>>;
    /// Une page de session, avec ses clauses B03 toutes nommées. Les
    /// erreurs de demande (curseur illisible/exclusif/étranger), de lecture
    /// ou de source manquante sont des `ErreurDomaine`.
    fn page(&self, request: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome>;
    /// Ce que le fichier dit des réglages en vigueur — jamais un modèle supposé.
    fn metadata(&self, source: ResolvedSource) -> SessionFuture<'_, SessionMetadata>;
}

/// Le port des catalogues : mesurer et valider, jamais deviner.
pub trait CatalogPort: Send + Sync {
    /// Le catalogue mesuré d'un kind — liste vide + erreur explicite si nada.
    fn catalog(&self, kind: &crate::ids::AgentKind) -> PortFuture<'_, CatalogObservation>;
    /// Les types réellement installés sur cette machine.
    fn installed(&self) -> PortFuture<'_, Vec<InstalledKindInstance>>;
    /// Valide une demande de lancement contre le catalogue mesuré (C07 :
    /// avant toute création de tab) ; rend les arguments prêts.
    fn validate_launch(&self, choice: LaunchChoice) -> PortFuture<'_, ValidatedArgs>;
}

/// Le port des artefacts : fichiers autorisés et images récentes.
pub trait ArtifactPort: Send + Sync {
    /// Ouvre un fichier sous une racine autorisée (type mesuré inclus).
    fn open(&self, request: AuthorizedFileRequest) -> PortFuture<'_, ArtifactBody>;
    /// Balaye les images récentes, racines autorisées seulement.
    fn recent_images(&self, roots: AuthorizedRoots) -> PortFuture<'_, ImageScan>;
}

/// Le port des notifications push : clés, abonnements, remise.
pub trait NotificationPort: Send + Sync {
    /// La clef publique VAPID, que le frontend doit voir pour s'abonner.
    /// `None` = non configurée — la capacité s'affiche absente, tout court.
    /// L'échec de résolution est nommé (une panne de magasin n'est pas
    /// « pas de clef » : le fil répond 500, pas 503).
    fn vapid_public_key(&self) -> PortFuture<'_, Option<VapidPublicKey>>;
    /// Enregistre un abonnement navigateur (upsert par endpoint, E08).
    fn subscribe(&self, subscription: BrowserSubscription) -> PortFuture<'_, ()>;
    /// Retire un abonnement par endpoint — sans effet s'il est inconnu.
    fn unsubscribe(&self, endpoint: String) -> PortFuture<'_, ()>;
    /// Remet un payload à un abonnement navigateur. `Ok` = accepté par le
    /// service push ; toute incertitude passe par [`DeliveryOutcome::Unknown`]
    /// — jamais « envoyé » sans preuve (A02).
    fn deliver(
        &self,
        subscription: BrowserSubscription,
        payload: PushPayload,
    ) -> PortFuture<'_, DeliveryOutcome>;
}
