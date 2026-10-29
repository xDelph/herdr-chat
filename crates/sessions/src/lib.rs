//! sessions — résolution, lecteurs, codecs de famille, curseur et cache de
//! métadonnées (TECH §2) ; les modules arrivent avec leurs tâches.

pub mod agents;
pub mod cursor;
pub mod families;
pub mod hub;
pub mod index;
pub mod metadata;
pub mod normalisation;
pub mod path_policy;
pub mod pipeline;
pub mod port;
pub mod resolver;
pub mod storage;
