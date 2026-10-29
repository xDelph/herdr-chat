//! Les handlers du fil (T050–T053) — chaque route dans son module, la
//! cartographie HTTP en face du registre (`contracts::registry`).

pub mod arret;
/// Réexporté pour le repli du routeur (l'asset statique n'est pas une route
/// de l'API : il vit dans `assets`, mais le routeur a besoin d'un handler).
pub use crate::assets as assets_router;
pub mod catalogues;
pub mod confiance;
pub mod conversations;
pub mod events;
pub mod fichiers;
pub mod flux_session;
pub mod focus;
pub mod journal_client;
pub mod lancement;
pub mod lectures;
pub mod overview;
pub mod prompt;
pub mod push;
pub mod reponse;
pub mod sante;
pub mod session;
pub mod taches;

use crate::errors::ReponseErreur;
use axum::response::{IntoResponse, Response};
use contracts::registry::RouteId;
use domain::errors::ErreurDomaine;

/// La réponse d'erreur **cohérente par construction** : le statut et le
/// corps viennent tous deux de `errors::reponse_erreur` — un handler
/// n'assemble jamais les deux à la main (c'est ainsi que le fil a produit
/// des corps valides avec un statut faux).
#[must_use]
pub fn repondre_erreur(route: RouteId, erreur: &ErreurDomaine) -> Response {
    let (statut, corps) = crate::errors::reponse_erreur(route, erreur);
    let statut = axum::http::StatusCode::from_u16(statut)
        .unwrap_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR);
    match corps {
        ReponseErreur::Api(corps) => (statut, axum::Json(corps)).into_response(),
        ReponseErreur::PromptRate(corps) => (statut, axum::Json(corps)).into_response(),
        // H15 : le 503 est du TEXTE brut — jamais du JSON déguisé.
        ReponseErreur::TexteBrut(texte) => (statut, texte).into_response(),
    }
}
