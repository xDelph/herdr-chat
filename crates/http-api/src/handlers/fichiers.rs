//! H17 `GET /api/file?path=` et H18 `GET /api/images` — les fichiers.
//!
//! ⚠️ **Les racines autorisées sont résolues à CHAQUE requête** depuis le
//! snapshot Herdr : aucune racine globale, aucune variable d'environnement.
//! Un projet qui disparaît cesse immédiatement d'être lisible.
//!
//! ⚠️ **Ce qui n'est pas dans la liste blanche est TÉLÉCHARGÉ**, jamais rendu
//! (`content-disposition: attachment`) — le SVG notamment, qui peut porter du
//! script (S07).
//!
//! ⚠️ Un refus de fichier est un **403 nommé** (la raison réelle), pas un 500 :
//! le client doit pouvoir corriger son chemin.

use crate::services::Services;
use application::refresh::ErreurLecture;
use axum::http::header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE};
use axum::response::IntoResponse;
use contracts::http::files::{RecentImage, RecentImagesResponse};
use domain::naming::{checkout_path_of, panes_situes};
use domain::ports::{AuthorizedFileRequest, AuthorizedRoots};
use std::sync::Arc;

/// Les paramètres de la route — seul `path` est lu, et il est obligatoire.
#[derive(serde::Deserialize)]
pub struct Parametres {
    pub path: Option<String>,
}

/// `GET /api/file?path=…` — le fichier, tel quel, avec son type mesuré.
async fn fichier_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Query(parametres): axum::extract::Query<Parametres>,
) -> axum::response::Response {
    // 1) Le paramètre : absent ou vide = 403 nommé (le fil refuse pareil).
    let Some(demande) = parametres.path.filter(|chemin| !chemin.is_empty()) else {
        return refus_403("missing `path` parameter");
    };
    // 2) Les racines de CETTE requête : les dossiers des projets du snapshot
    //    PLUS les racines médias de la configuration.
    let racines = match racines_autorisees(&services) {
        Ok(racines) => racines,
        // Le snapshot est illisible : on ne peut pas savoir ce qui est
        // autorisé, donc rien ne l'est.
        Err(_) => return refus_403("Herdr unreadable"),
    };
    // 3) La lecture — la garde vit dans le port (résolution puis contrôle).
    match services
        .artefacts
        .open(AuthorizedFileRequest {
            roots: racines,
            requested: demande,
        })
        .await
    {
        Ok(corps) => {
            // Le nom servi : celui mesuré, jamais le chemin demandé (un lien
            // vers un .png porte le nom de sa cible).
            let nom = corps.filename.unwrap_or_else(|| String::from("fichier"));
            let disposition = if corps.inline {
                format!("inline; filename=\"{nom}\"")
            } else {
                format!("attachment; filename=\"{nom}\"")
            };
            let longueur = corps.bytes.len().to_string();
            (
                axum::http::StatusCode::OK,
                [
                    (CACHE_CONTROL, "no-store".to_string()),
                    (CONTENT_TYPE, corps.content_type),
                    (CONTENT_DISPOSITION, disposition),
                    (CONTENT_LENGTH, longueur),
                ],
                corps.bytes,
            )
                .into_response()
        }
        // Le refus porte sa raison — pas de message générique (S07).
        Err(cause) => refus_403(&cause.description()),
    }
}

/// `GET /api/images` — les images récentes des dossiers autorisés.
async fn images_sur_place(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    let racines = match racines_autorisees(&services) {
        Ok(racines) => racines,
        Err(_) => {
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({ "error": "Herdr unreadable" })),
            )
                .into_response();
        }
    };
    match services.artefacts.recent_images(racines).await {
        Ok(balayage) => (
            axum::http::StatusCode::OK,
            axum::Json(RecentImagesResponse {
                images: balayage
                    .images
                    .into_iter()
                    .map(|image| RecentImage {
                        modified_at: image.modified_at,
                        path: image.path,
                        size: image.size,
                    })
                    .collect(),
            }),
        )
            .into_response(),
        Err(_) => (
            axum::http::StatusCode::BAD_GATEWAY,
            axum::Json(serde_json::json!({ "error": "scan failed" })),
        )
            .into_response(),
    }
}

/// Les racines autorisées de la requête : les dossiers des projets **lus dans
/// le snapshot partagé**, plus les racines médias de la configuration.
fn racines_autorisees(services: &Services) -> Result<AuthorizedRoots, ErreurLecture> {
    let borne = services.snapshots.lecture()?;
    let situes = panes_situes(&borne.snapshot);
    let mut entries: Vec<String> = borne
        .snapshot
        .workspaces
        .iter()
        .filter_map(|workspace| checkout_path_of(workspace, &situes))
        .collect();
    entries.extend(services.racines_extra.iter().cloned());
    Ok(AuthorizedRoots { entries })
}

/// Le 403 du fil : `{error}` avec la raison réelle.
fn refus_403(raison: &str) -> axum::response::Response {
    (
        axum::http::StatusCode::FORBIDDEN,
        axum::Json(serde_json::json!({ "error": raison })),
    )
        .into_response()
}

/// Le handler `fichier`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn fichier(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    axum::extract::Query(parametres): axum::extract::Query<Parametres>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(fichier_sur_place(
        axum::extract::State(services),
        axum::extract::Query(parametres),
    ))
    .await
}

/// Le handler `images`, exécuté hors des workers du runtime ([`crate::bloquant`]).
pub async fn images(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
) -> axum::response::Response {
    crate::bloquant::hors_runtime(images_sur_place(axum::extract::State(services))).await
}
