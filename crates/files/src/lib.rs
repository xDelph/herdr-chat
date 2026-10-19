//! files — le confinement, les descripteurs autorisés, l'écriture atomique
//! et la politique MIME (TECH §6) ; les modules arrivent avec leurs tâches.

pub mod atomic;
pub mod authorized_file;
pub mod confined;
pub mod mime;
pub mod port;
pub mod scan;
