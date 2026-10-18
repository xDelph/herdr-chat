//! L'état partagé des handlers (T050) — les services injectés, assemblés par
//! herdrchat (T056). Le routeur le porte comme State axum ; chaque handler
//! prend ce qu'il lui faut.
//!
//! ⚠️ **Aucun service n'est monté ici** : les lecteurs de session et la
//! conversation sont des ports `dyn` — le graphe interdit `http-api →
//! sessions` ; la composition réelle vit au sommet (T056).

use crate::assets::FournisseurAssets;
use application::commands::focus::FocaliseurAgent;
use application::commands::launch::{ConstructeurArgs, HorlogeMoteur, LanceurAgent};
use application::commands::prompt::EnvoieurPrompt;
use application::commands::stop::ArreteurAgent;
use application::conversations::ServiceConversations;
use application::diagnostics::SinkDiagnostic;
use application::events::subscription::ServiceAbonnements;
use application::overview::ResoutSessions;
use application::refresh::{ServiceSnapshots, SourceMaintenant};
use application::types_installes::InventaireTypes;
use domain::ports::{ArtifactPort, CatalogPort, ControlPort, NotificationPort, SessionPort};
use std::sync::Arc;
use std::time::Instant;

/// La liste des services partagés, composés par les handlers : snapshots
/// (santé/overview/conversations/session), conversations et session détaillée.
#[derive(Clone)]
pub struct Services {
    pub snapshots: Arc<ServiceSnapshots>,
    /// Le port de contrôle partagé — les lectures d'écran de la liste des
    /// conversations ; la même instance que celle des snapshots (T056).
    pub port: Arc<dyn ControlPort>,
    pub conversations: Arc<ServiceConversations>,
    /// Le résolveur de sources — la matière de l'overview (D03).
    pub resout: Arc<dyn ResoutSessions>,
    pub sessions: Arc<dyn SessionPort>,
    /// Le chemin du socket Herdr — H01 le renvoie tel quel.
    pub socket: String,
    /// L'horloge partagée — l'uptime de H01 (jamais une dépendance au réel
    /// si le test injecte son horloge).
    pub maintenant: Arc<dyn SourceMaintenant>,
    /// L'instant de démarrage du démon — `uptimeMs = maintenant - debut`.
    pub debut: Instant,
    /// Le chemin du journal — H01 le publie (`log`) quand il est connu.
    pub journal_chemin: Option<String>,
    /// L'envoi de prompt (H05) — la déduplication vit ici, entre les appels.
    pub prompt: Arc<EnvoieurPrompt>,
    /// L'arrêt (H06) — sans état : chaque appel reprend une photo fraîche.
    pub arret: ArreteurAgent,
    /// Le focus (H11) — toujours une valeur, jamais une erreur.
    pub focus: FocaliseurAgent,
    /// Le moteur de lancement (H07) — la réservation de noms est commune.
    pub lancement: Arc<LanceurAgent>,
    /// La validation des args de modèle, INJECTÉE (T030 compose le vrai) :
    /// un refus tombe avant tout onglet (C07).
    pub args: Arc<ConstructeurArgs>,
    /// L'horloge du moteur de lancement — injectable pour les tests.
    pub horloge: Arc<dyn HorlogeMoteur>,
    /// Les types réellement installés (H07) — la découverte, injectée.
    pub types: Arc<dyn InventaireTypes>,
    /// Les catalogues mesurés et la validation des args (H09).
    pub catalogue: Arc<dyn CatalogPort>,
    /// Les fichiers autorisés et les images récentes (H17/H18) — les racines
    /// sont réévaluées à chaque requête depuis le snapshot.
    pub artefacts: Arc<dyn ArtifactPort>,
    /// Les racines médias de la configuration, ajoutées aux dossiers des
    /// projets (H17/H18).
    pub racines_extra: Vec<String>,
    /// Le service Web Push (H15/H16) — `None` = capacité ABSENTE : 503, et
    /// l'interface l'affiche absente (aucun substitut inventé).
    pub notifications: Option<Arc<dyn NotificationPort>>,
    /// Le direct (H14) : le journal borné ET les abonnements — les
    /// commandes publient ici, le flux SSE lit ici (même possession).
    pub journal: Arc<ServiceAbonnements>,
    /// L'attente maximale d'un flux avant de relire le journal (le
    /// heartbeat). Injectable pour que les tests n'attendent pas 15 s : le
    /// travailleur bloquant d'un flux se réveille à cette cadence.
    pub battement_flux: std::time::Duration,
    /// Les assets de la PWA (T054) — le build embarqué, composé au sommet.
    pub assets: Arc<dyn FournisseurAssets>,
    /// Le journal de diagnostics (T055) — le puits ne rend rien, donc une
    /// panne d'écriture ne change jamais l'issue d'une commande.
    pub diagnostics: Arc<dyn SinkDiagnostic>,
}

impl Services {
    /// L'uptime vu par l'horloge injectée — jamais `Instant::now()` ici.
    #[must_use]
    pub fn uptime_ms(&self) -> u64 {
        self.maintenant
            .maintenant()
            .saturating_duration_since(self.debut)
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }
}
