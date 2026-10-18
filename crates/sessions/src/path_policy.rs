//! La politique de source (S03) — résoudre **puis** vérifier, jamais
//! l'inverse ; et comparer **par segments**, jamais par préfixe de chaîne.
//!
//! ⚠️ **Pourquoi ce module existe.** Les sessions sont lues depuis le chemin
//! que Herdr annonce — un service externe. Sans contrôle, une annonce
//! pointant `/etc/passwd` serait servie comme une session. Deux erreurs
//! classiques évitées par construction :
//!
//! 1. comparer des chaînes : `"/root/secrets".startsWith("/root")` est vrai
//!    alors que `/root/secrets` est **hors** de `/root` — la comparaison est
//!    par composants ([`files::confined::est_sous`]) ;
//! 2. valider avant de résoudre : un lien symbolique se lit avant d'être
//!    résolu — la résolution réelle vient **d'abord** ([`files::confined::canonique`]),
//!    le contrôle **ensuite**, l'ouverture **sur le chemin résolu**.
//!
//! ⚠️ **Pourquoi plusieurs racines** : chaque agent a son dossier de sessions
//! (`~/.pi/agent/sessions`, `~/.codex/sessions`…) — un garde à racine unique
//! refusait les sessions des autres agents comme « hors racine », un refus de
//! sûreté pris à tort pour un défaut de format.
//!
//! ⚠️ **La résolution de `sessions` réutilise le moteur de `files`** — elle
//! ne duplique aucune résolution de chemin (TECH §6).

use files::confined::{canonique, est_sous};
use std::path::{Path, PathBuf};

/// La raison du refus — chaque cause distincte : « ne pas masquer l'erreur ».
/// Les libellés destinés à l'écran sont ceux du fil (mesurés).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum RefusChemin {
    RacineAbsente,
    CheminAbsent,
    HorsRacine,
    LienSortant,
}

impl RefusChemin {
    /// Le message destiné à l'utilisateur : une cause par refus, jamais
    /// générique (mesuré sur `describeRejection`).
    #[must_use]
    pub fn message(self) -> &'static str {
        match self {
            RefusChemin::RacineAbsente => "sessions root not found",
            RefusChemin::CheminAbsent => "missing session",
            RefusChemin::HorsRacine => "session path outside the allowed root",
            RefusChemin::LienSortant => "symlink escaping the allowed root",
        }
    }
}

/// Le verdict du garde : autorisé **sur le chemin canonique réellement
/// ouvert**, ou refusé avec sa raison — pas de `ok` + raison inconsistants.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum VerdictChemin {
    Autorise { resolu: PathBuf },
    Refuse { raison: RefusChemin },
}

/// Résout `candidat` et vérifie qu'il reste sous **l'une** des racines.
///
/// ⚠️ Les racines sont résolues **aussi** : sur macOS `/tmp` est un lien vers
/// `/private/tmp` — comparer un chemin réel à une racine non résolue
/// refuserait tout fichier légitime (défaut mesuré et corrigé dans le fil).
///
/// ⚠️ Un refus **précis l'emporte sur « racine-absente »** : une racine mal
/// configurée ne doit pas masquer une vraie sortie de périmètre.
pub fn resolu_sous(racines: &[PathBuf], candidat: &Path) -> VerdictChemin {
    if racines.is_empty() {
        return VerdictChemin::Refuse {
            raison: RefusChemin::RacineAbsente,
        };
    }
    // Les racines sont résolues **aussi** : sur macOS `/tmp` est un lien —
    // comparer un chemin réel à une racine brute refuserait tout légitime.
    let racines_reelles: Vec<PathBuf> = racines
        .iter()
        .filter_map(|racine| canonique(racine).ok())
        .collect();
    if racines_reelles.is_empty() {
        return VerdictChemin::Refuse {
            raison: RefusChemin::RacineAbsente,
        };
    }
    let reel = match canonique(candidat) {
        Ok(reel) => reel,
        Err(_) => {
            // Le fichier peut légitimement ne pas exister encore : Pi crée
            // le JSONL au premier message. On compare alors le **parent**,
            // résolu lui aussi, pour décider si la racine est respectée.
            return VerdictChemin::Refuse {
                raison: parent_hors_racine(&racines_reelles, candidat),
            };
        }
    };
    if !racines_reelles.iter().any(|racine| est_sous(racine, &reel)) {
        // Deux situations distinctes, et la différence est utile au
        // diagnostic : le chemin **déclaré** était dedans mais **pointe**
        // ailleurs — lien sortant ; ou il visait déjà dehors (frère, `..`)
        // — hors racine. Le parent résolu tranche : `CheminAbsent` = le
        // parent est dedans (le fichier réel dehors ne porte pas de parent
        // absent) ; `HorsRacine` = le parent lui-même est dehors.
        let declare_dedans = matches!(
            parent_hors_racine(&racines_reelles, candidat),
            RefusChemin::CheminAbsent
        );
        return VerdictChemin::Refuse {
            raison: if declare_dedans {
                RefusChemin::LienSortant
            } else {
                RefusChemin::HorsRacine
            },
        };
    }
    VerdictChemin::Autorise { resolu: reel }
}

/// Le parent déclaré est-il (résolu) sous les racines ? — `HorsRacine` quand
/// non, `CheminAbsent` quand le parent est dedans mais absent (fichier pas
/// encore créé) ou que le parent est lui-même illisible.
fn parent_hors_racine(racines_reelles: &[PathBuf], candidat: &Path) -> RefusChemin {
    let parent = candidat.parent().map(Path::to_path_buf);
    let parent_reel = parent.and_then(|parent| canonique(&parent).ok());
    match parent_reel {
        Some(parent_reel) => {
            if racines_reelles
                .iter()
                .any(|racine| est_sous(racine, &parent_reel))
            {
                RefusChemin::CheminAbsent
            } else {
                RefusChemin::HorsRacine
            }
        }
        None => RefusChemin::CheminAbsent,
    }
}
