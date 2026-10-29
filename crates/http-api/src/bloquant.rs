//! Le travail bloquant des handlers, **hors des workers du runtime**.
//!
//! ⚠️ **Pourquoi.** Les ports (socket Herdr, fichiers de session, SQLite,
//! attentes d'une commande) sont synchrones derrière une façade `async` : leur
//! future fait tout le travail au premier `poll`. Exécutés dans un handler,
//! ils occupaient un worker tokio pendant toute la lecture — avec N cœurs, N
//! requêtes lentes (un écran d'agent bloqué, un délai Herdr) gelaient toutes
//! les autres, flux SSE compris. Le corps du handler tourne donc sur le pool
//! bloquant ; le runtime reste libre.

use axum::response::{IntoResponse, Response};
use std::future::Future;

/// Exécute le corps d'un handler sur le pool bloquant. Une tâche qui panique
/// rend un 500 nommé, jamais une connexion coupée sans cause.
pub async fn hors_runtime<F>(corps: F) -> Response
where
    F: Future<Output = Response> + Send + 'static,
{
    match tokio::task::spawn_blocking(move || tokio::runtime::Handle::current().block_on(corps))
        .await
    {
        Ok(reponse) => reponse,
        Err(cause) => (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({ "error": format!("requête interrompue : {cause}") })),
        )
            .into_response(),
    }
}
