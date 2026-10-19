//! herdr-client — transport Unix, décodage du fil amont, port de contrôle
//! (TECH §2) ; les modules arrivent avec leurs tâches (T012, T013, T021).

pub mod capabilities;
pub mod client;
pub mod port;
pub mod transport;
pub mod wire;
