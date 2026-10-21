//! Le démon herdr-remote : la composition des crates (T048+).
//! Le binaire ne fait que monter la configuration et les services.

pub mod assemblage;
pub mod assets;
/// Le module généré par `build.rs` : `include!` (et non `mod`) pour que les
/// outils ne cherchent pas un fichier `src/assets_pwa.rs` qui n'existe pas.
#[cfg(pwa_build)]
mod assets_pwa {
    include!(concat!(env!("OUT_DIR"), "/assets_pwa.rs"));
}
pub mod composition;
pub mod config;
pub mod cycle;
pub mod logging;
pub mod veille;
