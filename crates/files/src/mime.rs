//! La politique MIME (T046, S07) : une liste blanche volontaire — tout ce
//! qui n'y figure pas est servi en `application/octet-stream`, donc
//! **téléchargé, jamais interprété**.
//!
//! ⚠️ **Un SVG est exclu** : il peut porter du script — jamais rendu inline.

use std::path::Path;

/// Les types servis **avec** rendu navigateur — la table exacte du fil
/// (FileService.ts, S07).
const TYPES_INLINE: &[(&str, &str)] = &[
    (".avif", "image/avif"),
    (".gif", "image/gif"),
    (".jpeg", "image/jpeg"),
    (".jpg", "image/jpeg"),
    (".png", "image/png"),
    (".webp", "image/webp"),
    (".pdf", "application/pdf"),
    (".txt", "text/plain; charset=utf-8"),
    (".log", "text/plain; charset=utf-8"),
    (".json", "text/plain; charset=utf-8"),
    (".jsonl", "text/plain; charset=utf-8"),
    (".md", "text/plain; charset=utf-8"),
    (".diff", "text/plain; charset=utf-8"),
    (".patch", "text/plain; charset=utf-8"),
];

/// Le type de contenu d'un chemin — la table exacte, sinon octet-stream.
#[must_use]
pub fn content_type_de(chemin: &Path) -> String {
    let extension = chemin
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let avec_point = format!(".{extension}");
    TYPES_INLINE
        .iter()
        .find(|(suffixe, _)| *suffixe == avec_point)
        .map(|(_, type_)| String::from(*type_))
        .unwrap_or_else(|| String::from("application/octet-stream"))
}

/// `true` si le type est rendu par le navigateur plutôt que téléchargé.
#[must_use]
pub fn est_inline(chemin: &Path) -> bool {
    let extension = chemin
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let avec_point = format!(".{extension}");
    TYPES_INLINE
        .iter()
        .any(|(suffixe, _)| *suffixe == avec_point)
}
