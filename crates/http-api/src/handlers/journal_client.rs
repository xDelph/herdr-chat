//! H13 `POST /api/log` — la remontée d'erreur depuis le navigateur.
//!
//! ⚠️ **La cause réelle d'un problème est souvent côté client** : un appel
//! qui échoue, un décodage impossible. Sans ce canal, ces erreurs
//! n'existaient que dans une barre rouge, puis disparaissaient.
//!
//! ⚠️ Les deux réponses sont `{ok:boolean}` au **200/400** — pas de 500 :
//! un journal en panne ne doit pas casser l'écran qui signale une panne.

use crate::corps::CorpsBorne;
use axum::response::IntoResponse;

/// Le corps exact du fil — `level` est le littéral `"error"` (une autre
/// valeur est un corps invalide, jamais un niveau inventé).
#[derive(serde::Deserialize)]
struct Corps {
    level: String,
    message: String,
    #[serde(default)]
    detail: Option<serde_json::Value>,
}

/// La remontée — tracée dans le journal du démon, acquittée `{ok:true}`.
pub async fn journal_client(corps: CorpsBorne) -> axum::response::Response {
    let entree = serde_json::from_slice::<Corps>(&corps.octets)
        .ok()
        .filter(|entree| entree.level == "error");
    let Some(entree) = entree else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({ "ok": false })),
        )
            .into_response();
    };
    // La trace console ET le journal, comme pour les réponses du serveur.
    if let Some(detail) = &entree.detail {
        tracing::error!(source = "client", message = %entree.message, detail = %detail);
    } else {
        tracing::error!(source = "client", message = %entree.message);
    }
    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}
