//! application — l'état partagé, la rafraîchissement, les cas d'usage, les
//! résumés, le watcher et le journal d'événements (TECH §4).

pub mod commands;
pub mod conversations;
pub mod diagnostics;
pub mod events;
pub mod git;
pub mod lectures;
pub mod observation;
pub mod overview;
/// Les ports du domaine, réexportés pour l'assembleur : `herdrchat` compose
/// les adaptateurs mais le graphe (TECH §2) ne lui donne pas `domain`.
pub mod ports {
    pub use domain::ports::*;
}

/// Le noyau du domaine (identités, observations, erreurs) réexporté pour
/// l'assembleur : `herdrchat` compose mais le graphe ne lui donne pas
/// `domain` directement.
pub mod noyau {
    pub use domain::errors::{ErreurDomaine, PortError};
    pub use domain::ids::*;
    pub use domain::observation::*;
    pub use domain::status::*;
}

/// Les valeurs de session du domaine, réexportées pour l'assembleur : le
/// démon compose des adaptateurs de session mais le graphe ne lui donne pas
/// `domain` directement.
pub mod sessions_types {
    pub use domain::session::*;
}
pub mod permis;
pub mod refresh;
pub mod state;
pub mod types_installes;
pub mod visibilite;
