//! Le port d'observation des sources de session (STREAMING.md §3) — le flux
//! de chat attend une **révision**, puis lit son delta depuis son curseur.
//!
//! ⚠️ Le port rend une garde : tant que l'observation est tenue, la source
//! est surveillée ; la lâcher (fin du flux, client parti) arrête la
//! surveillance quand c'était la dernière.

use domain::session::ResolvedSource;
use tokio::sync::watch;

/// Une observation tenue : la révision de la source et sa garde.
pub struct ObservationDeSession {
    /// Change à chaque modification constatée de la source.
    pub revisions: watch::Receiver<u64>,
    /// Pourquoi l'observation est dégradée, quand elle l'est — à journaliser,
    /// jamais à taire.
    pub degradation: Option<String>,
    _garde: Box<dyn Send + Sync>,
}

impl ObservationDeSession {
    /// Une observation et ce qui la maintient en vie.
    pub fn nouvelle(
        revisions: watch::Receiver<u64>,
        degradation: Option<String>,
        garde: impl Send + Sync + 'static,
    ) -> Self {
        Self {
            revisions,
            degradation,
            _garde: Box::new(garde),
        }
    }
}

/// Observer une source de session.
pub trait ObservateurDeSessions: Send + Sync {
    fn observe(&self, source: &ResolvedSource) -> ObservationDeSession;
}
