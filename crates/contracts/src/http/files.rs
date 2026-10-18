//! Les fichiers servis au client : images récentes et corps de fichier.

use serde::{Deserialize, Serialize};

/// Une image récente (`RecentImageSchema`) — millisecondes mesurées, jamais
/// recalées.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecentImage {
    pub modified_at: u64,
    pub path: String,
    pub size: u64,
}

/// La réponse d'images récentes (`RecentImagesResponse`).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecentImagesResponse {
    pub images: Vec<RecentImage>,
}

/// Un corps de fichier **non JSON** — typé pour ne pas fabriquer de DTO JSON
/// fictif (TECH §5) : le type MIME mesuré, le nom proposé, les octets.
/// L'homologue HTTP du `ArtifactBody` du domaine (conversion exhaustive à la
/// frontière).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FileBody {
    pub content_type: String,
    /// Nom proposé au téléchargement — omission = nom naturel du chemin.
    pub filename: Option<String>,
    pub bytes: Vec<u8>,
}

impl From<domain::ports::ArtifactBody> for FileBody {
    fn from(corps: domain::ports::ArtifactBody) -> Self {
        Self {
            content_type: corps.content_type,
            filename: corps.filename,
            bytes: corps.bytes,
        }
    }
}
