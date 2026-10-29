//! Le dossier jetable commun aux essais de `files`.
//!
//! ⚠️ **Le défaut qui rendait ces essais intermittents sous charge.** Chaque
//! fichier d'essais nommait ses dossiers `{préfixe}-{pid}-{nonce}` sous le
//! tmpdir, ne les effaçait jamais, et paniquait si le dossier existait déjà.
//! Des milliers de dossiers s'accumulaient ; sous une charge de ~20, les pid
//! se recyclent vite, et le nonce dépend de l'ordre (parallèle) des essais :
//! un essai tombait sur le dossier d'une exécution antérieure (« File
//! exists ») — vert en isolation, rouge en porte complète.
//!
//! Désormais : un nom qui porte aussi l'instant (nanosecondes), une création
//! **exclusive** qui réessaie sur collision au lieu de paniquer, et un
//! nettoyage à la sortie de portée (`Drop`).

use std::fs;
use std::io;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NONCE: AtomicU64 = AtomicU64::new(0);

/// Un dossier temporaire propre à UN essai, effacé quand l'essai le lâche.
#[derive(Debug)]
pub(crate) struct Jetable {
    chemin: PathBuf,
}

impl Deref for Jetable {
    type Target = PathBuf;

    fn deref(&self) -> &PathBuf {
        &self.chemin
    }
}

impl AsRef<Path> for Jetable {
    fn as_ref(&self) -> &Path {
        &self.chemin
    }
}

impl Drop for Jetable {
    fn drop(&mut self) {
        // Au mieux : un essai qui a déjà effacé son dossier ne gêne rien.
        let _ = fs::remove_dir_all(&self.chemin);
    }
}

/// Crée `tmpdir/{préfixe}-{pid}-{nanos}-{nonce}` par création exclusive.
pub(crate) fn temporaire(prefixe: &str) -> Jetable {
    let base = std::env::temp_dir();
    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duree| duree.as_nanos())
        .unwrap_or(0);
    for _ in 0..1_024 {
        let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
        let chemin = base.join(format!("{prefixe}-{pid}-{nanos}-{nonce}"));
        match fs::create_dir(&chemin) {
            Ok(()) => return Jetable { chemin },
            Err(cause) if cause.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(cause) => panic!("racine temporaire refusée : {cause}"),
        }
    }
    panic!("aucun emplacement temporaire libre pour {prefixe}")
}
