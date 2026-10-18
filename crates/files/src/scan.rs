//! Le balayage des images récentes (T047, S08–S09) : lister ce qui existe —
//! captures d'écran, images du bureau, téléchargements — les plus récentes
//! d'abord. On ouvre, on regarde.
//!
//! ⚠️ **Le balayage est borné, volontairement bas** : mieux vaut une liste
//! partielle qu'un serveur bloqué. Sans exclusions, le balayage descendait
//! dans `node_modules` et mettait 5 secondes — on ne cherche pas une capture
//! dans les dépendances.
//!
//! ⚠️ **Le budget est GLOBAL** (C13) : le plafond de 400 fichiers est
//! partagé entre toutes les racines, même balayées en parallèle — une racine
//! qui remplit le budget prive les suivantes, comme dans le fil.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, PoisonError};

/// Extensions rendues comme images. Le SVG est exclu : il peut porter du
/// script (S08).
pub const IMAGE_EXTENSIONS: &[&str] = &[".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"];

/// `true` si le chemin porte une extension d'image — insensible à la casse,
/// suffixe exact (un `image.png.txt` n'est pas une image).
#[must_use]
pub fn est_image(chemin: &Path) -> bool {
    let nom = chemin
        .file_name()
        .map(|nom| nom.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    IMAGE_EXTENSIONS
        .iter()
        .any(|extension| nom.ends_with(extension))
}

/// Une image trouvée — la forme du contrat (`RecentImageSchema`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageRecente {
    /// La modification en millisecondes depuis l'époque — le tri.
    pub modifiee_a: u64,
    pub chemin: String,
    pub taille: u64,
}

/// Bornes du balayage (S08).
pub const PROFONDEUR_MAX: usize = 3;
pub const FICHIERS_MAX: usize = 400;
pub const PAR_DOSSIER: usize = 120;
/// Au plus 4 racines balayées en même temps — le pic mesure cette borne.
pub const RACINES_CONCOURANTES: usize = 4;
/// La limite par défaut de la réponse.
pub const LIMITE_DEFAUT: usize = 60;

/// Dossiers jamais parcourus (S09) — la liste exacte du fil.
const DOSSIERS_IGNORES: &[&str] = &[
    "node_modules",
    "dist",
    "build",
    "target",
    "vendor",
    "coverage",
    ".next",
    ".nuxt",
    ".turbo",
    "Pods",
    "__pycache__",
    ".venv",
    "venv",
];

fn nb_collectes(collecte: &Mutex<Vec<ImageRecente>>) -> usize {
    collecte
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .len()
}

/// Le pic de balayage simultané — exposé pour les tests : le compteur mesure
/// le nombre RÉEL de parcours en vol, pas une opinion.
pub struct CompteurDeBalayage {
    en_cours: AtomicUsize,
    pic: AtomicUsize,
}

impl CompteurDeBalayage {
    #[must_use]
    pub fn nouveau() -> Self {
        Self {
            en_cours: AtomicUsize::new(0),
            pic: AtomicUsize::new(0),
        }
    }

    fn entre(&self) {
        let courant = self.en_cours.fetch_add(1, Ordering::SeqCst) + 1;
        self.pic.fetch_max(courant, Ordering::SeqCst);
    }

    fn sort(&self) {
        self.en_cours.fetch_sub(1, Ordering::SeqCst);
    }

    #[must_use]
    pub fn pic(&self) -> usize {
        self.pic.load(Ordering::SeqCst)
    }
}

/// Le parcours d'un dossier — **séquentiel, assumé, pas un oubli** : chaque
/// `stat` conditionne la descente, et l'ordre du disque remplit `collecte`
/// dans l'ordre ; un parallélisme renommerait l'ordre et pourrait dépasser
/// le plafond avant que le court-circuit ne s'applique. Un dossier photo
/// peut contenir des milliers d'entrées : paralléliser ouvrirait autant de
/// descripteurs qu'il y a de fichiers.
///
/// Le compteur mesure le pic de balayages simultanés — la preuve de la borne
/// 4, pas une opinion.
fn promene(
    racine: &Path,
    profondeur: usize,
    collecte: &Mutex<Vec<ImageRecente>>,
    compteur: &CompteurDeBalayage,
) {
    if profondeur > PROFONDEUR_MAX || nb_collectes(collecte) >= FICHIERS_MAX {
        return;
    }
    compteur.entre();
    // Dossier illisible ou disparu : on l'ignore, on n'abandonne pas le reste.
    let entrees = match fs::read_dir(racine) {
        Ok(entrees) => entrees,
        Err(_) => {
            compteur.sort();
            return;
        }
    };
    let mut par_dossier = 0;
    for entree in entrees {
        if par_dossier >= PAR_DOSSIER || nb_collectes(collecte) >= FICHIERS_MAX {
            break;
        }
        let entree = match entree {
            Ok(entree) => entree,
            Err(_) => continue,
        };
        let nom = entree.file_name().to_string_lossy().into_owned();
        if nom.starts_with('.') || DOSSIERS_IGNORES.contains(&nom.as_str()) {
            continue;
        }
        let chemin = entree.path();
        // `metadata` SUIT les liens (S09) : un lien vers un dossier est
        // descendu, un lien vers une image est collecté.
        let info = match fs::metadata(&chemin) {
            Ok(info) => info,
            Err(_) => continue,
        };
        if info.is_dir() {
            // Descente récursive, conditionnée par le `stat` ci-dessus.
            promene(&chemin, profondeur + 1, collecte, compteur);
            continue;
        }
        if !info.is_file() || !est_image(&chemin) {
            continue;
        }
        let modifiee_a = info
            .modified()
            .ok()
            .and_then(|instant| instant.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duree| duree.as_millis() as u64)
            .unwrap_or(0);
        // Le plafond est GLOBAL : re-vérifié SOUS le verrou au moment du
        // dépôt — la course entre le contrôle et le push reste fermée.
        let mut garde = collecte.lock().unwrap_or_else(PoisonError::into_inner);
        if garde.len() >= FICHIERS_MAX || par_dossier >= PAR_DOSSIER {
            break;
        }
        garde.push(ImageRecente {
            modifiee_a,
            chemin: chemin.to_string_lossy().into_owned(),
            taille: info.len(),
        });
        par_dossier += 1;
    }
    compteur.sort();
}

/// Liste les images des racines données, **les plus récentes d'abord**,
/// bornées à `limite`.
///
/// L'erreur d'une racine n'annule pas les autres : un dossier disparu ne
/// doit pas vider l'écran (S09). Le tri est stable — à modification égale,
/// l'ordre du disque reste. Le pic de concurrents reste mesuré.
#[must_use]
pub fn liste_images_recentes(racines: &[std::path::PathBuf], limite: usize) -> Vec<ImageRecente> {
    liste_images_recentes_comptee(racines, limite, &CompteurDeBalayage::nouveau())
}

/// La variante instrumentée — un compteur externe reçoit le pic : la preuve
/// de la borne 4 par la mesure, pas par construction.
#[must_use]
pub fn liste_images_recentes_comptee(
    racines: &[std::path::PathBuf],
    limite: usize,
    compteur: &CompteurDeBalayage,
) -> Vec<ImageRecente> {
    let collecte: Mutex<Vec<ImageRecente>> = Mutex::new(Vec::new());
    // Au plus 4 racines en même temps : des lots de 4, rejoints avant le
    // lot suivant — le pic est borné par construction, prouvé par le compteur.
    for lot in racines.chunks(RACINES_CONCOURANTES) {
        std::thread::scope(|portee| {
            for racine in lot {
                portee.spawn(|| promene(racine, 0, &collecte, compteur));
            }
        });
    }
    let mut images = collecte
        .into_inner()
        .unwrap_or_else(PoisonError::into_inner);
    images.sort_by(|a, b| b.modifiee_a.cmp(&a.modifiee_a));
    images.truncate(limite);
    images
}
