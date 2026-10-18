//! application — l'état partagé, la rafraîchissement, les cas d'usage, les
//! résumés, le watcher et le journal d'événements (TECH §4).

pub mod commands;
pub mod conversations;
pub mod diagnostics;
pub mod events;
pub mod git;
pub mod overview;
/// Les ports du domaine, réexportés pour l'assembleur : `herdrchat` compose
/// les adaptateurs mais le graphe (TECH §2) ne lui donne pas `domain`.
pub mod ports {
    pub use domain::ports::*;
}
pub mod permis;
pub mod refresh;
pub mod state;
pub mod types_installes;
pub mod visibilite;
