//! notifications — le store push compatible, le cycle de vie VAPID, les
//! profils de payload et la livraison avec élagage des abonnements expirés
//! (TECH §4) ; les modules arrivent avec leurs tâches.

pub mod delivery;
pub mod payload;
pub mod store;
pub mod vapid;
pub mod webpush;
