//! Le ping de démarrage (O03) : le démon demande sa santé à Herdr **une
//! fois, au démarrage**, et le dit dans le journal.
//!
//! ⚠️ **`PortHerdr::connecte` est paresseux.** Sans ce ping, un socket Herdr
//! absent ou un protocole incompatible ne se voyait qu'à la première requête
//! d'un client (ou dans `/api/health`) : rien dans les traces au démarrage.
//! Le ping ne bloque **jamais** le serveur HTTP : il tourne à côté, et son
//! échec n'est qu'un avertissement — la PWA lit l'état réel dans
//! `/api/health`, qui reste servi.

use application::noyau::{PortError, UpstreamPing};
use application::ports::ControlPort;
use std::sync::Arc;

/// Ce que le ping de démarrage a établi.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Joignabilite {
    /// Herdr répond : son protocole et sa version, tels quels.
    Joignable(UpstreamPing),
    /// Herdr ne répond pas, ou répond mal : la cause réelle, jamais un
    /// message générique.
    Injoignable(String),
}

/// Le ping, une fois : rend le verdict ET l'écrit dans les traces —
/// `info` quand Herdr répond, `warn` sinon.
pub fn ping_de_demarrage(port: &dyn ControlPort) -> Joignabilite {
    let mut futur = port.ping();
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    let verdict = match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(Ok(ping)) => Joignabilite::Joignable(ping),
        std::task::Poll::Ready(Err(cause)) => Joignabilite::Injoignable(cause_de(&cause)),
        // Les adaptateurs répondent au premier poll (convention du socle) :
        // un `Pending` est un branchement cassé — on le dit, sans paniquer.
        std::task::Poll::Pending => {
            Joignabilite::Injoignable(String::from("le port de contrôle n'a rendu aucun verdict"))
        }
    };
    match &verdict {
        Joignabilite::Joignable(ping) => tracing::info!(
            protocole = ping.protocol,
            version = %ping.version,
            "Herdr joignable au démarrage"
        ),
        Joignabilite::Injoignable(cause) => tracing::warn!(
            %cause,
            "Herdr injoignable au démarrage — le serveur HTTP reste disponible, /api/health dira quand il revient"
        ),
    }
    verdict
}

/// Lance le ping **à côté** du démarrage (fil bloquant dédié) : le serveur
/// HTTP n'attend pas son verdict.
pub fn lance_ping_de_demarrage(
    port: Arc<dyn ControlPort>,
) -> tokio::task::JoinHandle<Joignabilite> {
    tokio::task::spawn_blocking(move || ping_de_demarrage(port.as_ref()))
}

fn cause_de(cause: &PortError) -> String {
    cause.to_string()
}
