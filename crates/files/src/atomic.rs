//! L'écriture **atomique** (T044, C14) : temp + flush + rename.
//!
//! ⚠️ **Une panne à chaque étape laisse l'ancien ou le nouveau fichier
//! valide** — jamais un fichier à moitié écrit, jamais un store corrompu.
//! Le temporaire vit dans le MÊME répertoire que la cible (un `rename` ne
//! traverse pas les systèmes de fichiers) ; il est supprimé en cas de panne.
//!
//! ⚠️ **Permissions 0700/0600** : le répertoire parent est créé 0700
//! (recursif), le fichier final porte 0600 — le temporaire est créé 0600 et
//! le `rename` conserve l'inode, donc les permissions du fichier final sont
//! exactement celles du temporaire.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Le compteur des temporaires — un nom unique par processus et par appel.
static COMPTEUR_TEMPORAIRE: AtomicU64 = AtomicU64::new(0);

/// Écrit `contenu` dans `chemin` de façon atomique : répertoire parent créé
/// 0700, fichier temporaire 0600 écrit puis flushé (sync), `rename` par-
/// dessus la cible. En cas de panne, le temporaire est supprimé et l'ancien
/// fichier reste intact.
pub fn ecrit_atomique(chemin: &Path, contenu: &[u8]) -> io::Result<()> {
    let parent = chemin
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    creer_repertoire(parent)?;
    let temporaire = temporaire_dans(parent);
    let resultat = (|| -> io::Result<()> {
        let mut fichier = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporaire)?;
        fichier.write_all(contenu)?;
        fichier.flush()?;
        // La durabilité réelle du « flush » : les octets sont sur le disque
        // avant le rename — un crash entre les deux garde l'ancien fichier.
        fichier.sync_all()?;
        drop(fichier);
        fs::rename(&temporaire, chemin)?;
        Ok(())
    })();
    if resultat.is_err() {
        // Le temporaire ne doit jamais rester : un résidu n'est pas un
        // fichier valide, c'est un déchet.
        let _ = fs::remove_file(&temporaire);
    }
    resultat
}

/// Crée le répertoire parent (recursif) avec les permissions 0700 — les
/// répertoires déjà présents ne voient pas leurs permissions changées.
fn creer_repertoire(parent: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    builder.mode(0o700);
    builder.create(parent)
}

/// Un nom de temporaire unique dans le répertoire donné — le `rename` exige
/// le même système de fichiers que la cible.
fn temporaire_dans(parent: &Path) -> PathBuf {
    let pid = std::process::id();
    let nonce = COMPTEUR_TEMPORAIRE.fetch_add(1, Ordering::SeqCst);
    parent.join(format!(".herdr-push-{pid}-{nonce}.tmp"))
}

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
