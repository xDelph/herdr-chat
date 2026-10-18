//! Le corps borné (T049, C09) : la taille RÉELLE est tranchée à la lecture —
//! même quand `Content-Length` est absent (chunked) ou mensonger. Un corps
//! trop grand est refusé 413, jamais lu en entier pour être refusé ensuite.

use axum::body::Body;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use contracts::limits::{MAX_BODY_BYTES, MAX_PROMPT_BYTES};
use futures_util::StreamExt;

/// Lit un corps, borné à `max` octets — la taille réelle, pas la déclarée.
/// Au-delà : 413, et le reste du corps est abandonné (la connexion peut
/// continuer ; le corps n'est pas stocké).
pub async fn lire_corps_borne(corps: Body, max: usize) -> Result<Vec<u8>, Response> {
    let mut collecte = Vec::with_capacity(max.min(64 * 1024));
    let mut flux = corps.into_data_stream();
    while let Some(portion) = flux.next().await {
        let portion = portion.map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({ "error": "corps illisible" })),
            )
                .into_response()
        })?;
        if collecte.len() + portion.len() > max {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                axum::Json(serde_json::json!({
                    "error": format!("corps trop grand (maximum {max} octets)")
                })),
            )
                .into_response());
        }
        collecte.extend_from_slice(&portion);
    }
    Ok(collecte)
}

/// Le corps JSON typé, borné à la taille réelle — l'extracteur des handlers
/// (T050+). Le décodage JSON arrive après la borne.
#[derive(Debug)]
pub struct CorpsBorne {
    pub octets: Vec<u8>,
}

impl<S> axum::extract::FromRequest<S> for CorpsBorne
where
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request(demande: Request, _etat: &S) -> Result<Self, Self::Rejection> {
        let octets = lire_corps_borne(demande.into_body(), MAX_BODY_BYTES).await?;
        Ok(CorpsBorne { octets })
    }
}

/// La limite du prompt (H05) : 32 KiB UTF-8 — comptée en OCTETS UTF-8, pas
/// en caractères (CURRENT.md §2).
pub const MAX_PROMPT_OCTETS: usize = MAX_PROMPT_BYTES;

/// Vérifie qu'un texte JSON tient dans la limite du prompt — la taille
/// RÉELLE du texte décodé, pas celle du corps.
pub fn verifie_prompt(texte: &str) -> Result<(), Box<Response>> {
    if texte.len() > MAX_PROMPT_OCTETS {
        return Err(Box::new(
            (
                StatusCode::PAYLOAD_TOO_LARGE,
                axum::Json(serde_json::json!({
                    "error": format!("texte trop grand (maximum {MAX_PROMPT_OCTETS} octets UTF-8)")
                })),
            )
                .into_response(),
        ));
    }
    Ok(())
}
