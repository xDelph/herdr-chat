//! H13 `POST /api/log` — la remontée d'erreur depuis le navigateur.
//!
//! ⚠️ **La cause réelle d'un problème est souvent côté client** : un appel
//! qui échoue, un décodage impossible. Sans ce canal, ces erreurs
//! n'existaient que dans une barre rouge, puis disparaissaient.
//!
//! ⚠️ Les deux réponses sont `{ok:boolean}` au **200/400** — pas de 500 :
//! un journal en panne ne doit pas casser l'écran qui signale une panne.

use crate::corps::CorpsBorne;
use crate::services::Services;
use application::diagnostics::{EntreeDiagnostic, Niveau};
use axum::response::IntoResponse;
use std::sync::Arc;

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
pub async fn journal_client(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    corps: CorpsBorne,
) -> axum::response::Response {
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
    let niveau = Niveau::depuis_libelle(&entree.level).unwrap_or(Niveau::Error);
    let mut diagnostic = EntreeDiagnostic::nouvelle(niveau, "client", &entree.message);
    if let Some(detail) = &entree.detail {
        diagnostic = diagnostic.avec_detail(detail.to_string());
        tracing::error!(source = "client", message = %entree.message, detail = %detail);
    } else {
        tracing::error!(source = "client", message = %entree.message);
    }
    // Le puits ne rend rien : une panne de journal ne peut pas transformer
    // cet acquittement en échec (T055).
    services.diagnostics.ecrit(&diagnostic);
    (
        axum::http::StatusCode::OK,
        axum::Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}
