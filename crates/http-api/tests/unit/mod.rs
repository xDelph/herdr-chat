//! Cahier d'essais de http-api : la garde (origin, corps), le routeur, les
//! lectures H01–H04 (T050), les commandes H05–H07/H10–H12 (T051) et les
//! catalogues/fichiers/push/journal H08–H09/H13/H15–H18 (T052).

pub(crate) mod arret;
pub(crate) mod assets;
pub(crate) mod catalogues;
pub(crate) mod confiance;
pub(crate) mod conversations;
pub(crate) mod corps;
pub(crate) mod errors;
pub(crate) mod events;
pub(crate) mod fichiers;
pub(crate) mod focus;
pub(crate) mod journal_client;
pub(crate) mod lancement;
pub(crate) mod origin;
pub(crate) mod overview;
pub(crate) mod prompt;
pub(crate) mod push;
pub(crate) mod reponse;
pub(crate) mod router;
pub(crate) mod sante;
pub(crate) mod session;
pub(crate) mod support;
