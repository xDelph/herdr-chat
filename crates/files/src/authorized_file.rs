//! Le service de fichiers autorisés (T046, S05–S07) : lire les artefacts
//! produits par les agents — racines réévaluées à la demande, plafond
//! 12 MiB, MIME exact, longueur réellement servie.
//!
//! ⚠️ **Quatre garde-fous, dans l'ordre** (FileService.ts) :
//!
//! 1. **racines autorisées** — les dossiers de travail des projets connus,
//!    réévalués à chaud depuis le snapshot Herdr (S05) ; pas de racine
//!    globale, pas de Desktop/Downloads/Pictures implicites ;
//! 2. **résolution puis vérification** — le chemin est résolu *avant* d'être
//!    comparé (le `..` et le frère ne passent pas) ; les racines sont
//!    résolues AUSSI (sur macOS, `/var` est un lien vers `/private/var`) ;
//! 3. **fichiers réguliers uniquement** — jamais de répertoire, jamais de
//!    périphérique, jamais de FIFO ;
//! 4. **taille bornée** — un fichier trop gros est refusé, pas tronqué en
//!    silence ; la longueur servie est celle des octets réellement lus.
//!
//! ⚠️ **Un lien symbolique sortant est refusé** : `realpath` résout, puis la
//! vérification porte sur le chemin réel — un lien dont le chemin d'appel
//! paraît légitime ne sort pas du périmètre.

use crate::confined::{RacineAutorisee, RefusOuverture, ouvre_confine};
use crate::mime::{content_type_de, est_inline};
use std::path::{Path, PathBuf};

/// Taille maximale servie — la valeur du contrat partagé
/// (`packages/shared/src/limits.ts`, S06) : 12 MiB. Une seule valeur,
/// deux côtés : le contrôle TS la garde, le contrôle Rust la sert.
pub const MAX_FILE_BYTES: u64 = 12 * 1024 * 1024;

/// Un fichier prêt à être servi.
#[derive(Clone, Debug)]
pub struct FichierServi {
    pub octets: Vec<u8>,
    pub content_type: String,
    pub nom: String,
    /// La taille mesurée sur le descripteur — la vérité de ce qui est servi.
    pub taille: u64,
}

/// Les raisons d'un refus — une cause réelle, jamais générique.
#[derive(Clone, Debug)]
pub enum ErreurFichier {
    Refuse { raison: String },
    Indisponible { raison: String },
}

/// Rend une erreur de fichier lisible, sans divulguer la structure du
/// disque (S07 : « erreur détaillée »).
#[must_use]
pub fn describe_erreur_fichier(erreur: &ErreurFichier) -> String {
    match erreur {
        ErreurFichier::Refuse { raison } | ErreurFichier::Indisponible { raison } => raison.clone(),
    }
}

/// Construit les racines autorisées depuis les chemins bruts du snapshot —
/// une racine disparue reste dans sa forme brute (elle ne fera passer aucun
/// fichier, mais ne fait pas échouer les autres).
fn racines_depuis(racines: &[PathBuf]) -> Vec<RacineAutorisee> {
    racines
        .iter()
        .map(|racine| {
            RacineAutorisee::nouveau(racine).unwrap_or_else(|_| RacineAutorisee::brute(racine))
        })
        .collect()
}

/// Lit un fichier sous les racines autorisées — les contrôles portent sur
/// l'objet ouvert (descripteur), jamais sur un chemin revu depuis.
pub fn lit_fichier_autorise(
    racines: &[PathBuf],
    demande: &Path,
) -> Result<FichierServi, ErreurFichier> {
    if racines.is_empty() {
        return Err(ErreurFichier::Refuse {
            raison: String::from("no authorized project"),
        });
    }
    let autorisees = racines_depuis(racines);
    // Un répertoire demandé directement : le fil l'ouvre puis le refuse via
    // `isFile()` ; ici l'ouverture relative d'un chemin vide échoue avant le
    // fstat. La vérification porte sur le chemin résolu, et le descripteur
    // re-valide la régularité — la course reste fermée (S04).
    if let Ok(reel) = crate::confined::canonique(demande)
        && reel.is_dir()
    {
        return Err(ErreurFichier::Refuse {
            raison: String::from("not a file"),
        });
    }
    let mut fichier = ouvre_confine(&autorisees, demande, MAX_FILE_BYTES).map_err(traduit)?;
    let taille = fichier.taille();
    let nom = String::from(fichier.nom());
    let octets = fichier.lis().map_err(|refus| match refus {
        RefusOuverture::LectureIllisible(cause) => ErreurFichier::Indisponible { raison: cause },
        autre => traduit(autre),
    })?;
    // Le type vient du chemin RÉEL (canonique) — un lien vers un .png sert
    // un png, jamais le type de l'extension d'appel.
    let reel = crate::confined::canonique(demande).unwrap_or_else(|_| demande.to_path_buf());
    let content_type = content_type_de(&reel);
    Ok(FichierServi {
        octets,
        content_type,
        nom,
        taille,
    })
}

/// `true` si le fichier serait rendu par le navigateur — la politique du
/// fil (S07), pour les décisions de disposition côté HTTP.
#[must_use]
pub fn serait_inline(chemin: &Path) -> bool {
    est_inline(chemin)
}

/// Traduit un refus d'ouverture en erreur de service — les raisons exactes
/// du fil (FileService.ts).
fn traduit(refus: RefusOuverture) -> ErreurFichier {
    match refus {
        RefusOuverture::AucuneRacine => ErreurFichier::Refuse {
            raison: String::from("no authorized project"),
        },
        RefusOuverture::HorsRacine => ErreurFichier::Refuse {
            raison: String::from("outside the project folders"),
        },
        RefusOuverture::LienSortant => ErreurFichier::Refuse {
            raison: String::from("symlink escaping the project folders"),
        },
        RefusOuverture::Absent => ErreurFichier::Indisponible {
            raison: String::from("fichier introuvable"),
        },
        RefusOuverture::PasUnFichierRegulier => ErreurFichier::Refuse {
            raison: String::from("not a file"),
        },
        RefusOuverture::TropGros { taille, maximum } => ErreurFichier::Refuse {
            raison: format!(
                "fichier trop gros ({} Mo, maximum {} Mo)",
                taille / 1024 / 1024,
                maximum / 1024 / 1024
            ),
        },
        RefusOuverture::LectureIllisible(cause) => ErreurFichier::Indisponible {
            raison: format!("fichier illisible : {cause}"),
        },
    }
}
