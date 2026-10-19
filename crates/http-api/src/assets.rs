//! Les assets de la PWA côté HTTP (T054, O05–O07) — la **politique** de
//! service ; la fourniture des octets est injectée (`FournisseurAssets`,
//! composé par herdrchat avec le build embarqué).
//!
//! ⚠️ **Confinement par construction.** Le fil résolvait des chemins disque
//! (`realpath`, comparaison par segments) parce que le build vivait sur le
//! disque. Ici les assets sont **embarqués** : la table ne contient que les
//! fichiers du build, donc un chemin qui n'y est pas ne peut pas être servi.
//! Il reste à refuser proprement ce qui sort (`..`, encodages invalides) —
//! et c'est fait AVANT toute recherche.
//!
//! ⚠️ **Le repli SPA est nécessaire** (un rechargement sur `#/agent/...` ne
//! doit pas donner 404) mais il ne doit **jamais** servir autre chose que
//! `index.html` : un chemin absent tombe sur l'index, pas sur un fichier
//! deviné.
//!
//! ⚠️ **Pas de build = 503 dit**, jamais une 404 opaque ni un `index.html`
//! inventé.

use crate::services::Services;
use axum::http::StatusCode;
use axum::http::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE};
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

/// Le cache des fichiers **volatils** : l'index, les workers et le manifest
/// changent à chaque déploiement — un cache les figerait sur une ancienne
/// version (O07).
const CACHE_VOLATIL: &str = "no-cache, no-store, must-revalidate";

/// Les noms volatils, exactement ceux du fil.
const VOLATILS: [&str; 4] = ["index.html", "sw.js", "push-sw.js", "manifest.webmanifest"];

/// Le cache des assets **hachés** : Vite pose une empreinte dans le nom
/// (`index-BDwQxbtC.js`), donc le contenu d'un nom donné ne change jamais —
/// il peut être gardé indéfiniment.
///
/// ⚠️ **Sans cet en-tête, le navigateur revalidait 459 Ko de JS** à chaque
/// rechargement (mesuré : `content-length: 458949`, aucun `cache-control`).
/// Le nom haché est la preuve d'immuabilité ; les noms volatils, eux, restent
/// en `no-store` (O07) — un `immutable` sur `index.html` figerait la version.
const CACHE_IMMUABLE: &str = "public, max-age=31536000, immutable";

/// `true` quand le nom porte une empreinte de build (Vite : `nom-XXXXXXXX.ext`).
///
/// La règle est **stricte** : un suffixe de 8 caractères base64/url-safe juste
/// avant l'extension. Un fichier qui ne la porte pas n'est pas déclaré
/// immuable — se tromper ici figerait un asset pour un an.
#[must_use]
pub fn est_immuable(chemin: &str) -> bool {
    let nom = chemin.rsplit('/').next().unwrap_or(chemin);
    if VOLATILS.contains(&nom) {
        return false;
    }
    let Some((base, _)) = nom.rsplit_once('.') else {
        return false;
    };
    let Some((_, empreinte)) = base.rsplit_once('-') else {
        return false;
    };
    empreinte.len() == 8
        && empreinte
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Un fichier d'asset : son contenu, tel qu'il sera servi.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FichierAsset {
    pub octets: Vec<u8>,
}

impl FichierAsset {
    #[must_use]
    pub fn nouveau(octets: impl Into<Vec<u8>>) -> Self {
        Self {
            octets: octets.into(),
        }
    }
}

/// La fourniture des assets — le build embarqué en production, un faux dans
/// les tests. Aucun chemin disque n'est exposé ici.
pub trait FournisseurAssets: Send + Sync {
    /// Le fichier **demandé** (chemin déjà décodé et normalisé), ou `None`.
    fn fichier(&self, chemin: &str) -> Option<FichierAsset>;
    /// L'index de la SPA — `None` quand la PWA n'est pas compilée.
    fn index(&self) -> Option<FichierAsset>;
}

/// Décode et normalise un chemin d'URL — `None` quand il sort du build ou
/// qu'il est mal encodé. Aucun segment `..` ne survit, aucun `%2e%2e%2f` non
/// plus (le décodage précède la normalisation, comme le fil).
#[must_use]
pub fn normalise(chemin: &str) -> Option<String> {
    let decode = decode_uri(chemin)?;
    let mut segments: Vec<&str> = Vec::new();
    for segment in decode.split('/') {
        match segment {
            "" | "." => continue,
            ".." => {
                // Remonter au-delà de la racine n'est jamais un asset : on
                // refuse, on ne « clampe » pas (clamper servirait un autre
                // fichier que celui demandé).
                if segments.is_empty() {
                    return None;
                }
                segments.pop();
            }
            autre => segments.push(autre),
        }
    }
    Some(format!("/{}", segments.join("/")))
}

/// Décode les `%XX` d'un chemin — `None` sur un encodage invalide (`/%`).
fn decode_uri(chemin: &str) -> Option<String> {
    let octets = chemin.as_bytes();
    let mut sortie = Vec::with_capacity(octets.len());
    let mut index = 0;
    while index < octets.len() {
        if octets[index] == b'%' {
            let haut = *octets.get(index + 1)?;
            let bas = *octets.get(index + 2)?;
            let valeur = hexa(haut)? * 16 + hexa(bas)?;
            sortie.push(valeur);
            index += 3;
        } else {
            sortie.push(octets[index]);
            index += 1;
        }
    }
    String::from_utf8(sortie).ok()
}

fn hexa(octet: u8) -> Option<u8> {
    match octet {
        b'0'..=b'9' => Some(octet - b'0'),
        b'a'..=b'f' => Some(octet - b'a' + 10),
        b'A'..=b'F' => Some(octet - b'A' + 10),
        _ => None,
    }
}

/// Le type MIME d'un asset, par extension — la table du build, jamais une
/// détection de contenu.
#[must_use]
pub fn content_type_asset(nom: &str) -> &'static str {
    let minuscule = nom.to_lowercase();
    let extension = minuscule
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .unwrap_or("");
    match extension {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "webmanifest" => "application/manifest+json",
        "txt" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        // Le défaut du fil pour un type inconnu : téléchargé, jamais
        // interprété.
        _ => "application/octet-stream",
    }
}

/// `true` quand le fichier ne doit jamais être mis en cache.
#[must_use]
pub fn est_volatil(chemin: &str) -> bool {
    let nom = chemin.rsplit('/').next().unwrap_or(chemin);
    VOLATILS.contains(&nom)
}

/// Sert un asset : le fichier demandé, sinon l'index (SPA), sinon 503 dit.
#[must_use]
pub fn reponse_asset(fournisseur: &dyn FournisseurAssets, chemin: &str) -> Response {
    // Un chemin qui se termine par `/` est une route SPA : l'index, jamais un
    // fichier.
    let demande = if chemin.ends_with('/') {
        None
    } else {
        normalise(chemin)
    };
    if let Some(demande) = &demande
        && let Some(fichier) = fournisseur.fichier(demande)
    {
        return fichier_servi(demande, fichier);
    }
    // Le repli SPA — ou le 503 quand la PWA n'est pas compilée.
    match fournisseur.index() {
        Some(index) => fichier_index(index),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "error": "PWA not built",
                "hint": "lancez `bun run --cwd apps/web build`, ou utilisez le serveur de développement Vite",
            })),
        )
            .into_response(),
    }
}

/// Un asset trouvé — type par extension, cache seulement s'il n'est pas
/// volatil.
fn fichier_servi(chemin: &str, fichier: FichierAsset) -> Response {
    let type_mime = content_type_asset(chemin);
    let longueur = fichier.octets.len().to_string();
    let mut reponse = (
        StatusCode::OK,
        [
            (CONTENT_TYPE, type_mime.to_string()),
            (CONTENT_LENGTH, longueur),
        ],
        fichier.octets,
    )
        .into_response();
    if est_volatil(chemin) {
        reponse.headers_mut().insert(
            CACHE_CONTROL,
            axum::http::HeaderValue::from_static(CACHE_VOLATIL),
        );
    } else if est_immuable(chemin) {
        reponse.headers_mut().insert(
            CACHE_CONTROL,
            axum::http::HeaderValue::from_static(CACHE_IMMUABLE),
        );
    }
    reponse
}

/// L'index de la SPA — `text/html` et **jamais** mis en cache.
fn fichier_index(index: FichierAsset) -> Response {
    let longueur = index.octets.len().to_string();
    (
        StatusCode::OK,
        [
            (CONTENT_TYPE, "text/html; charset=utf-8".to_string()),
            (CONTENT_LENGTH, longueur),
            (CACHE_CONTROL, CACHE_VOLATIL.to_string()),
        ],
        index.octets,
    )
        .into_response()
}

/// Le repli du routeur : `/api/*` inconnu reste un **JSON 404** (C08), tout
/// le reste va aux assets (ou au 503 « PWA not built »).
pub async fn statique(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    demande: axum::extract::Request,
) -> Response {
    let chemin = demande.uri().path().to_string();
    if chemin.starts_with("/api/") || chemin == "/api" {
        return crate::router::fallback_json_404(demande);
    }
    reponse_asset(services.assets.as_ref(), &chemin)
}

/// Le fournisseur vide — aucun build, aucun index : le 503 du fil. C'est ce
/// que compose un binaire de développement sans PWA compilée.
pub struct SansAssets;

impl FournisseurAssets for SansAssets {
    fn fichier(&self, _chemin: &str) -> Option<FichierAsset> {
        None
    }

    fn index(&self) -> Option<FichierAsset> {
        None
    }
}
