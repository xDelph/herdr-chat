//! La composition du démon (T056, O01–O04) : les ports entrent, les
//! `Services` du routeur sortent.
//!
//! ⚠️ **Rien n'est inventé côté I/O.** Les cinq ports (contrôle Herdr,
//! sessions, catalogue, artefacts, notifications) sont **fournis** : ce
//! module les assemble et ne fabrique aucun substitut. Un démon sans port est
//! refusé avec la liste de ce qui manque (`ManquePort`), plutôt que de
//! démarrer à moitié et de répondre des valeurs fausses.
//!
//! ⚠️ **Ce que la composition NE fait pas** : tuer ou fermer des agents. Le
//! démon ne possède pas les agents de l'utilisateur (O04).

use crate::config::Config;
use application::commands::focus::FocaliseurAgent;
use application::commands::launch::{ConstructeurArgs, HorlogeReelle, LanceurAgent};
use application::commands::prompt::EnvoieurPrompt;
use application::commands::stop::ArreteurAgent;
use application::conversations::{BrancheDeProjet, LitSessions, ServiceConversations};
use application::diagnostics::SinkDiagnostic;
use application::events::journal::Journal;
use application::events::subscription::{HEARTBEAT, ServiceAbonnements};
use application::overview::ResoutSessions;
use application::refresh::{MaintenantReelle, ServiceSnapshots, SourceMaintenant};
use application::types_installes::InventaireTypes;
// Les ports du domaine sont nommés par `application` (réexport) : le graphe
// n'autorise pas `herdrchat → domain`.
use application::ports::{ArtifactPort, CatalogPort, ControlPort, NotificationPort, SessionPort};
use http_api::assets::FournisseurAssets;
use http_api::services::Services;
use std::sync::Arc;
use std::time::Instant;

/// Les ports du démon — tous fournis par l'appelant, jamais construits ici.
pub struct Ports {
    pub controle: Arc<dyn ControlPort>,
    pub sessions: Arc<dyn SessionPort>,
    /// L'observation des sources de session (H19, STREAMING.md).
    pub observateur: Arc<dyn application::observation::ObservateurDeSessions>,
    pub catalogue: Arc<dyn CatalogPort>,
    pub artefacts: Arc<dyn ArtifactPort>,
    /// `None` = capacité absente (Web Push non configuré) : les routes
    /// répondent 503, jamais un substitut.
    pub notifications: Option<Arc<dyn NotificationPort>>,
    /// Le résolveur et le lecteur de la liste des conversations.
    pub resout: Arc<dyn ResoutSessions>,
    pub lit_sessions: Arc<dyn LitSessions>,
    /// Les types réellement lançables (H07) — la découverte d'intégrations.
    pub types: Arc<dyn InventaireTypes>,
    /// La branche git d'un dossier (D21) — le cache de T040.
    pub branche: Arc<dyn BrancheDeProjet>,
    /// La validation des args de lancement (T030).
    pub args: Arc<ConstructeurArgs>,
}

/// Ce qui manque pour composer — nommé, jamais un demi-démon.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ManquePort {
    pub ports: Vec<&'static str>,
}

impl std::fmt::Display for ManquePort {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ports non composés : {} — le démon refuse de démarrer à moitié",
            self.ports.join(", ")
        )
    }
}

impl std::error::Error for ManquePort {}

/// Compose les services du routeur à partir de la configuration, des ports et
/// du journal.
///
/// ⚠️ Le `socket` publié par H01 est celui de la configuration : c'est ce que
/// l'utilisateur doit vérifier, pas un chemin reconstruit.
pub fn services(
    config: &Config,
    ports: Ports,
    journal: Arc<ServiceAbonnements>,
    diagnostics: Arc<dyn SinkDiagnostic>,
    assets: Arc<dyn FournisseurAssets>,
) -> Services {
    let maintenant: Arc<dyn SourceMaintenant> = Arc::new(MaintenantReelle);
    let snapshots = Arc::new(ServiceSnapshots::nouveau(
        Arc::clone(&ports.controle),
        Arc::clone(&maintenant),
    ));
    let conversations =
        ServiceConversations::nouveau(Arc::clone(&ports.lit_sessions), Arc::clone(&ports.branche));
    Services {
        snapshots,
        port: Arc::clone(&ports.controle),
        conversations: Arc::new(conversations),
        resout: Arc::clone(&ports.resout),
        sessions: Arc::clone(&ports.sessions),
        observateur: Arc::clone(&ports.observateur),
        permis_flux_session: Arc::new(tokio::sync::Semaphore::new(
            http_api::handlers::flux_session::FLUX_SESSION_MAX,
        )),
        socket: config.herdr_socket_path.display().to_string(),
        maintenant,
        debut: Instant::now(),
        journal_chemin: Some(config.log_path.display().to_string()),
        prompt: Arc::new(EnvoieurPrompt::nouveau()),
        arret: ArreteurAgent::nouveau(),
        focus: FocaliseurAgent::nouveau(),
        lancement: Arc::new(LanceurAgent::nouveau()),
        args: Arc::clone(&ports.args),
        // L'horloge réelle : l'attente du moteur de lancement est bloquante,
        // la composition (T056) la place hors des workers d'E/S.
        horloge: Arc::new(HorlogeReelle::default()),
        types: Arc::clone(&ports.types),
        catalogue: Arc::clone(&ports.catalogue),
        artefacts: Arc::clone(&ports.artefacts),
        racines_extra: config
            .racines_fichiers_extra
            .iter()
            .map(|racine| racine.display().to_string())
            .collect(),
        notifications: ports.notifications.clone(),
        journal,
        // 15 s en production : un flux muet relit le journal à cette cadence.
        battement_flux: HEARTBEAT,
        assets,
        diagnostics,
    }
}

/// Le journal du direct (H14) — un journal borné et ses abonnements.
pub fn direct() -> Arc<ServiceAbonnements> {
    Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())))
}
