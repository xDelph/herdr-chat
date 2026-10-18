//! Les assets embarqués de la PWA (T054, O05–O07) — le fournisseur réel du
//! routeur.
//!
//! ⚠️ **Un binaire, pas un chemin.** Le fil cherchait le build à côté de sa
//! source (`O05` : indépendant du répertoire de lancement) ; ici les fichiers
//! sont **linkés dans le binaire** (`build.rs`), donc l'indépendance au cwd
//! est totale et il n'y a **aucun** chemin disque exposé.
//!
//! ⚠️ Sans build (développement), `index()` rend `None` : le démon répond le
//! 503 « PWA not built » du fil, jamais un index inventé.

use http_api::assets::{FichierAsset, FournisseurAssets};

/// Le fournisseur des assets du build.
pub struct AssetsEmbarques;

impl FournisseurAssets for AssetsEmbarques {
    fn fichier(&self, chemin: &str) -> Option<FichierAsset> {
        octets(chemin).map(FichierAsset::nouveau)
    }

    fn index(&self) -> Option<FichierAsset> {
        octets("/index.html").map(FichierAsset::nouveau)
    }
}

#[cfg(pwa_build)]
fn octets(chemin: &str) -> Option<Vec<u8>> {
    // La table est triée et petite : une recherche linéaire suffit, et elle
    // évite une structure construite à l'exécution. Le confinement vient de
    // la table elle-même — un chemin absent n'a pas d'octets.
    crate::assets_pwa::FICHIERS
        .iter()
        .find(|(url, _)| *url == chemin)
        .map(|(_, octets)| octets.to_vec())
}

#[cfg(not(pwa_build))]
fn octets(_chemin: &str) -> Option<Vec<u8>> {
    None
}
