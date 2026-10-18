//! L'état partagé des handlers (T050) — les services injectés, assemblés par
//! herdrchat (T056). Le routeur le porte comme State axum ; chaque handler
//! prend ce qu'il lui faut.
//!
//! ⚠️ **Aucun service n'est monté ici** : les lecteurs de session et la
//! conversation sont des ports `dyn` — le graphe interdit `http-api →
//! sessions` ; la composition réelle vit au sommet (T056).

use application::conversations::ServiceConversations;
use application::overview::ResoutSessions;
use application::refresh::{ServiceSnapshots, SourceMaintenant};
use domain::ports::{ControlPort, SessionPort};
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
