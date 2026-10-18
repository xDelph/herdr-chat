//! Embarque le build de la PWA (T054, O05–O07).
//!
//! ⚠️ **Un build de release SANS PWA est refusé** : sans ce garde-fou, le
//! binaire publierait un démon qui répond « PWA not built » à chaque écran —
//! et personne ne s'en apercevrait avant l'utilisateur.
//!
//! En développement, l'absence de `apps/web/dist` est normale (on utilise le
//! serveur Vite) : le démon sert alors le 503 dit du fil.

use std::path::{Path, PathBuf};

fn main() {
    println!("cargo::rustc-check-cfg=cfg(pwa_build)");
    println!("cargo:rerun-if-changed=build.rs");
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    let index = dist.join("index.html");
    // Le profil de release ET la variable explicite exigent le build — la
    // variable existe pour pouvoir PROUVER que la porte échoue (un `cargo
    // build --release` complet est trop lent pour être une preuve courante).
    let profil = std::env::var("PROFILE").unwrap_or_default();
    let exige = profil == "release" || std::env::var("HERDRCHAT_REQUIRE_PWA").as_deref() == Ok("1");
    if index.exists() {
        println!("cargo:rustc-cfg=pwa_build");
        let fichiers = collecte(&dist);
        let source = genere(&fichiers);
        let dossier = std::env::var("OUT_DIR")
            .unwrap_or_else(|_| panic!("OUT_DIR absent : le build de cargo est incomplet"));
        let sortie = PathBuf::from(dossier).join("assets_pwa.rs");
        std::fs::write(&sortie, source)
            .unwrap_or_else(|cause| panic!("écriture du module d'assets : {cause}"));
    } else if exige {
        panic!(
            "le build de publication exige la PWA compilée ({} absent) — lancez \
             `bun run --cwd apps/web build`",
            index.display()
        );
    }
}

/// Tous les fichiers du build, chemins d'URL absolus, triés (ordre stable).
fn collecte(racine: &Path) -> Vec<(String, PathBuf)> {
    let mut trouves = Vec::new();
    let mut pile = vec![racine.to_path_buf()];
    while let Some(dossier) = pile.pop() {
        let Ok(entrees) = std::fs::read_dir(&dossier) else {
            continue;
        };
        for entree in entrees.flatten() {
            let chemin = entree.path();
            if chemin.is_dir() {
                pile.push(chemin);
            } else if let Ok(relatif) = chemin.strip_prefix(racine) {
                let url = format!("/{}", relatif.to_string_lossy().replace('\\', "/"));
                trouves.push((url, chemin));
            }
        }
    }
    trouves.sort_by(|gauche, droite| gauche.0.cmp(&droite.0));
    trouves
}

/// Le module généré : une table `chemin → octets`, sans aucune lecture
/// disque à l'exécution (le confinement est une conséquence de la table).
fn genere(fichiers: &[(String, PathBuf)]) -> String {
    let mut source = String::from(
        "// Généré par build.rs — ne pas éditer.\n\
         /// Les fichiers du build, embarqués au link.\n\
         pub static FICHIERS: &[(&str, &[u8])] = &[\n",
    );
    for (url, chemin) in fichiers {
        source.push_str(&format!(
            "    ({:?}, include_bytes!({:?})),\n",
            url,
            chemin.display().to_string()
        ));
    }
    source.push_str("];\n");
    source
}
