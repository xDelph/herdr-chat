//! Limites partagées — **les valeurs du fil actuel**, une source unique.
//!
//! Chaque constante reprend la valeur mesurée de `packages/shared/src/limits.ts`
//! (CONTRACTS.md § limits). Une limite qui change passe par ici et par le
//! contrôle TS — jamais par une valeur locale réécrite.

/// Flux SSE ouverts, tous clients confondus (S06) — au-delà, le refus est 503.
pub const MAX_SSE_STREAMS: u32 = 8;

/// Lectures de sessions simultanées.
pub const MAX_SESSION_READS: u32 = 4;

/// Délai du catalogage des modèles d'un agent.
pub const MODEL_CATALOG_TIMEOUT_MS: u64 = 20_000;

/// Durée de vie du cache de catalogue.
pub const MODEL_CATALOG_CACHE_MS: u64 = 60_000;

/// Fenêtre de déduplication des prompts identiques (D007.2).
pub const DUPLICATE_WINDOW_MS: u64 = 60_000;

/// Taille de cible tactile minimale (accessibilité, mesure CSS).
pub const MIN_TAP_TARGET_PX: f64 = 44.0;

/// Contraste de texte minimal (accessibilité, ratio WCAG).
pub const MIN_TEXT_CONTRAST: f64 = 4.5;
