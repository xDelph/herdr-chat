//! Domaine pur de l'application : types de valeurs, politiques sans effet de
//! bord et traits de ports étroits.
//!
//! ⚠️ **Aucune entrée-sortie ici.** Pas de tokio, pas de HTTP, pas de
//! filesystem, pas de processus, pas d'horloge (le temps est un paramètre).
//! Le monde passe par les traits de `ports`, implémentés par les crates
//! adaptateurs (`herdr-client`, `sessions`, `catalog`, `files`,
//! `notifications`) qui en dépendent — jamais l'inverse.
//!
//! Modules (TECH §2) :
//!
//! - `ids` — identifiants distincts, nevertoypes incompatibles entre familles ;
//! - `status` — états à union fermée (`AgentStatus`, `SessionState`) ;
//! - `observation` — observations du monde Herdr, générations et vues normalisées ;
//! - `session` — messages/réglages/raw et modèles de lecture de session ;
//! - `catalog` — catalogues mesurés et validité du lancement ;
//! - `errors` — causes nommées et taxonomie d'erreurs de port ;
//! - `ports` — les cinq ports étroits et leurs preuves partielles ;
//! - `naming` — nommage, rangs et situation, purs et mesurés (D04) ;
//! - `notifications` — valeurs du service de notification.
//!
//! La source de vérité du contrat HTTP reste `packages/shared/src/api.ts`
//! jusqu'à T057 ; les conversions exhaustives vers les DTO filaires sont
//! l'affaire de `contracts`, pas de ces modèles internes.

pub mod catalog;
pub mod errors;
pub mod ids;
pub mod naming;
pub mod notifications;
pub mod observation;
pub mod ports;
pub mod session;
pub mod status;
