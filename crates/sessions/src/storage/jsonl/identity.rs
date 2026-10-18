//! L'identité d'un fichier (T014) : (device, inode) — la **même** identité
//! entre deux lectures = le même fichier ; une identité différente = le
//! fichier a été remplacé (rotation) → repartir de zéro, jamais lire un
//! remplaçant comme une suite.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

/// Le curseur du fil (`SessionCursor` de api.ts) — dev/ino/offset : la
/// position ET l'identité en une valeur.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub struct CurseurFichier {
    pub dev: u64,
    pub ino: u64,
    pub offset: u64,
}

/// L'identité + la taille au moment de la mesure.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct IdentiteFichier {
    pub curseur: CurseurFichier,
    pub taille: u64,
}

/// Mesure l'identité du fichier — la base du contrôle de continuité.
pub fn identite_de(chemin: &Path) -> io::Result<IdentiteFichier> {
    let metadonnees = fs::metadata(chemin)?;
    Ok(IdentiteFichier {
        curseur: CurseurFichier {
            dev: metadonnees.dev(),
            ino: metadonnees.ino(),
            offset: 0,
        },
        taille: metadonnees.len(),
    })
}

/// La décision de continuité : même identité et offset dans les bornes ?
/// `false` = troncature ou rotation détectée → repartir de zéro, jamais
/// lire un remplaçant comme une suite (ni un offset au-delà de la taille).
#[must_use]
pub fn continuite(attendue: &CurseurFichier, mesuree: &IdentiteFichier) -> bool {
    attendue.dev == mesuree.curseur.dev
        && attendue.ino == mesuree.curseur.ino
        && attendue.offset <= mesuree.taille
}
