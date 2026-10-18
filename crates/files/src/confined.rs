//! L'ouverture **confinée** (TECH §6) : racines canoniques, ouverture
//! relative via `cap-std`, descripteur **possédé**, contrôles Unix sur
//! l'objet ouvert — jamais sur un chemin revu depuis.
//!
//! ⚠️ **Ordre des défenses** (mesuré sur FileService.ts, durci par cap-std) :
//!
//! 1. résolution **lexicale** puis contrôle racines (le `..` et le frère ne
//!    passent pas — [`est_sous`] compare par **composants**, jamais par
//!    préfixe de chaîne) ;
//! 2. résolution **réelle** (symlinks suivis) puis re-contrôle — un lien
//!    sortant est refusé, un lien **interne** légitime passe ;
//! 3. ouverture **relative à la racine canonique** (cap-std : `..` et chemins
//!    absolus ne traversent pas) avec `O_NONBLOCK` (jamais bloqué par un
//!    FIFO), puis `fstat` **sur le descripteur** — les contrôles de
//!    régularité et de taille portent sur exactement l'objet qui sera lu
//!    (S04) ;
//! 4. lecture sur le **même** descripteur, bornée ; RAII ferme partout.
//!
//! ⚠️ La canonisation seule ne ferme pas la course ; l'ouverture relative +
//! le `fstat` sur descripteur ferment la fenêtre mesurée (le `stat` décrivait
//! l'ancien fichier, la lecture livrait le nouveau).

use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptionsExt};
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

/// Une racine autorisée : le chemin **brut** déclaré et sa forme
/// **canonique** — les deux portées, parce que la pré-vérification lexicale
/// compare au brut (sur macOS, `/var` est un lien vers `/private/var` :
/// comparer le chemin brut d'une demande à une racine canonique seule
/// refuserait tout fichier légitime — défaut mesuré et corrigé dans le fil).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RacineAutorisee {
    brut: PathBuf,
    canonique: PathBuf,
}

impl RacineAutorisee {
    /// Résout la racine (realpath) — une racine absente est un refus nommé,
    /// distinct d'une sortie de périmètre.
    pub fn nouveau(chemin: &Path) -> io::Result<Self> {
        Ok(Self {
            brut: chemin.to_path_buf(),
            canonique: canonique(chemin)?,
        })
    }

    /// Le chemin canonique porté.
    #[must_use]
    pub fn chemin(&self) -> &Path {
        &self.canonique
    }

    /// Une racine BRUTE : le chemin déclaré, sans résolution — le recours
    /// d'une racine disparue (T046, S05) : elle ne fera passer aucun
    /// fichier, mais ne fait pas échouer la lecture des autres.
    #[must_use]
    pub fn brute(chemin: &Path) -> Self {
        Self {
            brut: chemin.to_path_buf(),
            canonique: chemin.to_path_buf(),
        }
    }

    /// La racine couvre-t-elle ce chemin **avant résolution réelle** ? —
    /// lexicale contre l'une ou l'autre forme.
    #[must_use]
    fn couvre_lexicalement(&self, candidat: &Path) -> bool {
        est_sous(&self.brut, candidat) || est_sous(&self.canonique, candidat)
    }
}

/// Résout les liens symboliques — la couture commune (`files` la porte,
/// `sessions` ne duplique pas la résolution).
pub fn canonique(chemin: &Path) -> io::Result<PathBuf> {
    fs::canonicalize(chemin)
}

/// `true` si `candidat` est la racine elle-même ou un de ses descendants —
/// comparaison **par composants** (`Path::strip_prefix`) : `/a/b` ne couvre
/// jamais `/a/bc`.
#[must_use]
pub fn est_sous(racine: &Path, candidat: &Path) -> bool {
    if candidat == racine {
        return true;
    }
    candidat.strip_prefix(racine).is_ok()
}

/// Résolution **lexicale** : sans toucher au disque, réduit `.` et `..` —
/// la première passe du contrôle (mesurée : `resolve` du fil actuel).
#[must_use]
pub fn normalise(chemin: &Path) -> PathBuf {
    let mut pile: PathBuf = PathBuf::new();
    for composant in chemin.components() {
        match composant {
            Component::ParentDir => {
                pile.pop();
            }
            Component::CurDir => (),
            autre => pile.push(autre),
        }
    }
    pile
}

/// Le refus d'ouverture confinée — chaque cause est distincte : « ne pas
/// masquer l'erreur » (C13).
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum RefusOuverture {
    /// Aucune racine autorisée n'est configurée.
    AucuneRacine,
    /// Le chemin demandé est déjà hors des racines (`..`, dossier frère).
    HorsRacine,
    /// Le chemin (ou son parent) n'existe pas.
    Absent,
    /// Un lien symbolique mène hors des racines.
    LienSortant,
    /// L'objet ouvert n'est pas un fichier régulier (répertoire, FIFO,
    /// périphérique) — refusé **sans bloquer**.
    PasUnFichierRegulier,
    /// Trop gros — refusé, jamais tronqué en silence.
    TropGros { taille: u64, maximum: u64 },
    /// La lecture a échoué après ouverture.
    LectureIllisible(String),
}

/// Le fichier autorisé : le descripteur **possédé** et sa taille prise sur
/// ce descripteur. RAII — la fermeture accompagne la fin de vie, sur **tous**
/// les chemins (échecs compris : le descripteur meurt avec la valeur d'erreur
/// qui ne le porte plus).
#[derive(Debug)]
pub struct FichierAutorise {
    descripteur: cap_std::fs::File,
    taille: u64,
    nom: String,
}

impl FichierAutorise {
    /// La taille mesurée **sur le descripteur** au moment de l'ouverture.
    #[must_use]
    pub fn taille(&self) -> u64 {
        self.taille
    }

    /// Le nom naturel (dernier composant du chemin canonique).
    #[must_use]
    pub fn nom(&self) -> &str {
        &self.nom
    }

    /// Lit **le descripteur possédé**, borné à la taille mesurée — la
    /// longueur servie est celle des octets réellement lus (troncature
    /// concurrente gérée explicitement, jamais masquée).
    pub fn lis(&mut self) -> Result<Vec<u8>, RefusOuverture> {
        let mut contenu = Vec::with_capacity(self.taille as usize);
        let mut portion = (&self.descripteur).take(self.taille);
        portion
            .read_to_end(&mut contenu)
            .map_err(|cause| RefusOuverture::LectureIllisible(cause.to_string()))?;
        Ok(contenu)
    }
}

/// Ouvre `demande` confiné aux racines autorisées, taille maximale bornée.
///
/// Toutes les vérifications portent sur l'objet ouvert (descripteur), et
/// chaque échec laisse le descripteur mourir avec la valeur d'erreur —
/// RAII, aucun chemin de fuite.
pub fn ouvre_confine(
    racines: &[RacineAutorisee],
    demande: &Path,
    taille_max: u64,
) -> Result<FichierAutorise, RefusOuverture> {
    if racines.is_empty() {
        return Err(RefusOuverture::AucuneRacine);
    }
    // 1) Résolution lexicale, contrôle avant toute I/O — contre la forme
    // brute OU canonique de la racine (piège macOS /var).
    let resous = normalise(demande);
    if !racines
        .iter()
        .any(|racine| racine.couvre_lexicalement(&resous))
    {
        return Err(RefusOuverture::HorsRacine);
    }
    // 2) Résolution réelle (symlinks) puis re-contrôle.
    let reel = match canonique(demande) {
        Ok(reel) => reel,
        Err(cause) if cause.kind() == io::ErrorKind::NotFound => {
            return Err(RefusOuverture::Absent);
        }
        Err(cause) => return Err(RefusOuverture::LectureIllisible(cause.to_string())),
    };
    if !racines
        .iter()
        .any(|racine| est_sous(racine.chemin(), &reel))
    {
        // Le chemin déclaré était dedans ? Alors c'est un lien sortant —
        // sinon la demande visait déjà dehors (frère, `..`).
        let parent = demande.parent().map(Path::to_path_buf);
        let declare_dedans = parent
            .and_then(|parent| canonique(&parent).ok())
            .is_some_and(|parent_reel| racines.iter().any(|r| est_sous(r.chemin(), &parent_reel)));
        return Err(if declare_dedans {
            RefusOuverture::LienSortant
        } else {
            RefusOuverture::HorsRacine
        });
    }
    // 3) Ouverture **relative** depuis la racine canonique qui porte le reel.
    let racine = racines
        .iter()
        .find(|racine| est_sous(racine.chemin(), &reel))
        .unwrap_or_else(|| panic!("la racine porteuse a disparu après le contrôle"));
    let relatif = reel
        .strip_prefix(racine.chemin())
        .unwrap_or_else(|_| panic!("le chemin canonique porte sa racine"));
    let dossier = Dir::open_ambient_dir(racine.chemin(), ambient_authority())
        .map_err(|cause| RefusOuverture::LectureIllisible(cause.to_string()))?;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true);
    // Jamais bloqué par un FIFO : la lecture suivante verra le type réel.
    options.custom_flags(libc::O_NONBLOCK);
    let descripteur = dossier
        .open_with(relatif, &options)
        .map_err(|cause| RefusOuverture::LectureIllisible(cause.to_string()))?;
    // 4) fstat **sur le descripteur** : régularité et taille portent sur
    // l'objet qui sera lu (S04).
    let metadonnees = descripteur
        .metadata()
        .map_err(|cause| RefusOuverture::LectureIllisible(cause.to_string()))?;
    if !metadonnees.is_file() {
        return Err(RefusOuverture::PasUnFichierRegulier);
    }
    let taille = metadonnees.len();
    if taille > taille_max {
        return Err(RefusOuverture::TropGros {
            taille,
            maximum: taille_max,
        });
    }
    let nom = reel
        .file_name()
        .map(|nom| nom.to_string_lossy().to_string())
        .unwrap_or_else(|| String::from("fichier"));
    Ok(FichierAutorise {
        descripteur,
        taille,
        nom,
    })
}
