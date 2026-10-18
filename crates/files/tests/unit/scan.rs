//! Le balayage des images récentes (T047, S08–S09) : extensions, profondeur,
//! plafonds global et par dossier, tri par récence, exclusions, liens,
//! dégradation — le tout contre de vrais fichiers temporaires, aucun service.

use files::scan::{
    CompteurDeBalayage, FICHIERS_MAX, IMAGE_EXTENSIONS, ImageRecente, LIMITE_DEFAUT, PAR_DOSSIER,
    PROFONDEUR_MAX, RACINES_CONCOURANTES, est_image, liste_images_recentes,
    liste_images_recentes_comptee,
};
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, SystemTime};

static NONCE: AtomicU32 = AtomicU32::new(0);

fn temporaire(prefixe: &str) -> PathBuf {
    let base = std::env::temp_dir();
    let pid = std::process::id();
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let chemin = base.join(format!("{prefixe}-{pid}-{nonce}"));
    match fs::create_dir(&chemin) {
        Ok(()) => chemin,
        Err(cause) => panic!("racine temporaire refusée : {cause}"),
    }
}

/// Crée un fichier avec une modification datée (relative à maintenant) —
/// l'ordre du tri est déterministe.
fn image(chemin: &Path, age: u64) {
    if let Some(dossier) = chemin.parent() {
        fs::create_dir_all(dossier).unwrap_or_else(|cause| panic!("dossier {dossier:?} : {cause}"));
    }
    let mut fichier = fs::File::create(chemin).unwrap_or_else(|cause| panic!("écriture : {cause}"));
    fichier
        .write_all(b"png")
        .unwrap_or_else(|cause| panic!("écriture : {cause}"));
    let instant = SystemTime::now() - Duration::from_secs(age);
    fichier
        .set_modified(instant)
        .unwrap_or_else(|cause| panic!("datation : {cause}"));
}

fn noms(images: &[ImageRecente]) -> Vec<String> {
    images
        .iter()
        .map(|image| {
            Path::new(&image.chemin)
                .file_name()
                .unwrap_or_else(|| panic!("nom manquant"))
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

#[test]
fn ne_collecte_que_les_extensions_d_images() {
    // S08 : png/jpg/jpeg/gif/webp/avif — jamais le SVG (script possible),
    // jamais le texte, jamais les fichiers sans extension.
    let racine = temporaire("herdr-extensions");
    for (nom, age) in [
        ("a.png", 1),
        ("b.jpg", 2),
        ("c.jpeg", 3),
        ("d.gif", 4),
        ("e.webp", 5),
        ("f.avif", 6),
        ("g.svg", 7),
        ("h.txt", 8),
        ("rapport", 9),
    ] {
        image(&racine.join(nom), age);
    }
    let images = liste_images_recentes(std::slice::from_ref(&racine), 60);
    let trouves = noms(&images);
    for attendu in ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp", "f.avif"] {
        assert!(
            trouves.contains(&String::from(attendu)),
            "{attendu} manquant"
        );
    }
    assert!(!trouves.contains(&String::from("g.svg")), "SVG exclu");
    assert!(!trouves.contains(&String::from("h.txt")), "texte exclu");
    assert!(
        !trouves.contains(&String::from("rapport")),
        "sans extension exclu"
    );
    assert_eq!(IMAGE_EXTENSIONS.len(), 6);
}

#[test]
fn l_extension_est_insensible_a_la_casse_et_le_suffixe_exact() {
    let racine = temporaire("herdr-casse");
    image(&racine.join("PHOTO.PNG"), 1);
    image(&racine.join("trompeur.png.txt"), 2);
    let images = liste_images_recentes(std::slice::from_ref(&racine), 60);
    let trouves = noms(&images);
    assert!(trouves.contains(&String::from("PHOTO.PNG")));
    assert!(
        !trouves.contains(&String::from("trompeur.png.txt")),
        "le suffixe doit être exact"
    );
    assert!(est_image(Path::new("x.JPEG")));
    assert!(!est_image(Path::new("x.png.txt")));
}

#[test]
fn les_plus_recentes_d_abord_et_la_limite_appliquee() {
    let racine = temporaire("herdr-tri");
    for index in 0..5 {
        image(&racine.join(format!("capture-{index}.png")), 10 - index);
    }
    // La plus récente : age 6 (index 4) → première.
    let images = liste_images_recentes(std::slice::from_ref(&racine), 2);
    assert_eq!(noms(&images), ["capture-4.png", "capture-3.png"]);
    // Par défaut la limite est 60, jamais dépassée.
    assert_eq!(LIMITE_DEFAUT, 60);
}

#[test]
fn la_profondeur_est_bornee_a_trois() {
    let racine = temporaire("herdr-profondeur");
    image(&racine.join("a.png"), 1);
    image(&racine.join("d1/b.png"), 2);
    image(&racine.join("d1/d2/c.png"), 3);
    image(&racine.join("d1/d2/d3/d.png"), 4);
    image(&racine.join("d1/d2/d3/d4/e.png"), 5);
    let images = liste_images_recentes(std::slice::from_ref(&racine), 60);
    let trouves = noms(&images);
    for attendu in ["a.png", "b.png", "c.png", "d.png"] {
        assert!(
            trouves.contains(&String::from(attendu)),
            "{attendu} manquant"
        );
    }
    assert!(
        !trouves.contains(&String::from("e.png")),
        "profondeur 4 hors du périmètre"
    );
    assert_eq!(PROFONDEUR_MAX, 3);
}

#[test]
fn le_dossier_borne_a_120_images() {
    let racine = temporaire("herdr-par-dossier");
    let dossier = racine.join("photo");
    fs::create_dir(&dossier).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    for index in 0..150 {
        image(&dossier.join(format!("img-{index}.jpg")), 1);
    }
    let images = liste_images_recentes(std::slice::from_ref(&racine), 100_000);
    assert!(
        images.len() <= PAR_DOSSIER,
        "le plafond par dossier : {} trouvées",
        images.len()
    );
    assert_eq!(
        images.len(),
        PAR_DOSSIER,
        "le plafond par dossier est atteint"
    );
}

#[test]
fn le_budget_est_global_entre_les_racines() {
    // C13 : 5 racines × 120 par dossier = 600 potentiels, le plafond GLOBAL
    // de 400 tient — une racine remplit le budget, les suivantes sont servies.
    let mut racines = Vec::new();
    for _ in 0..5 {
        let racine = temporaire("herdr-budget-global");
        for index in 0..150 {
            image(&racine.join(format!("img-{index}.png")), 1);
        }
        racines.push(racine);
    }
    let images = liste_images_recentes(&racines, 100_000);
    assert!(
        images.len() <= FICHIERS_MAX,
        "le budget global : {} collectées",
        images.len()
    );
    assert_eq!(
        images.len(),
        FICHIERS_MAX,
        "le budget global est atteint (3×120 + 40)"
    );
}

#[test]
fn le_pic_de_balayage_ne_depasse_jamais_quatre() {
    // S08 : au plus 4 racines en même temps — mesuré au pic, pas une opinion.
    let mut racines = Vec::new();
    for _ in 0..4 {
        let racine = temporaire("herdr-pic");
        for fichier in 0..120 {
            image(&racine.join(format!("img-{fichier}.png")), 1);
        }
        racines.push(racine);
    }
    let compteur = CompteurDeBalayage::nouveau();
    let _ = liste_images_recentes_comptee(&racines, 60, &compteur);
    let pic = compteur.pic();
    assert!(
        pic >= 2,
        "la concurrence est réelle (pic observé plusieurs fois) : pic = {pic}"
    );
    assert!(
        pic <= RACINES_CONCOURANTES,
        "le pic ne dépasse jamais 4 : pic = {pic}"
    );
}

#[test]
fn les_dossiers_pointes_et_les_dependances_sont_ignores() {
    let racine = temporaire("herdr-ignores");
    image(&racine.join("visible.png"), 1);
    for dossier in [
        "node_modules",
        "dist",
        "build",
        "target",
        "vendor",
        "coverage",
    ] {
        image(&racine.join(dossier).join("dependance.png"), 2);
    }
    for dossier_pointe in [".next", ".nuxt", ".turbo"] {
        image(&racine.join(dossier_pointe).join("cache.png"), 3);
    }
    for dossier in ["Pods", "__pycache__", ".venv", "venv"] {
        image(&racine.join(dossier).join("autre.png"), 4);
    }
    let images = liste_images_recentes(std::slice::from_ref(&racine), 60);
    assert_eq!(
        noms(&images),
        ["visible.png"],
        "tout le reste était des dépendances ou des dossiers pointés"
    );
}

#[test]
fn les_entrees_pointees_sont_ignorees() {
    let racine = temporaire("herdr-pointees");
    image(&racine.join("visible.png"), 1);
    image(&racine.join(".cache.png"), 2);
    image(&racine.join(".config/secret.png"), 3);
    let images = liste_images_recentes(std::slice::from_ref(&racine), 60);
    assert_eq!(noms(&images), ["visible.png"]);
}

#[test]
fn les_liens_sont_suivis() {
    // S09 : `stat` suit les liens — un lien vers un dossier est descendu,
    // un lien vers une image est collecté.
    let racine = temporaire("herdr-liens-scan");
    let dehors = temporaire("herdr-cible-scan");
    image(&dehors.join("capture.png"), 1);
    std::os::unix::fs::symlink(&dehors, racine.join("lien-dossier"))
        .unwrap_or_else(|cause| panic!("lien : {cause}"));
    std::os::unix::fs::symlink(dehors.join("capture.png"), racine.join("lien-image.png"))
        .unwrap_or_else(|cause| panic!("lien : {cause}"));
    let images = liste_images_recentes(std::slice::from_ref(&racine), 60);
    let trouves = noms(&images);
    assert_eq!(
        trouves.len(),
        2,
        "le lien-dossier descend, le lien-image collecte"
    );
    assert!(trouves.contains(&String::from("capture.png")));
    assert!(trouves.contains(&String::from("lien-image.png")));
}

#[test]
fn une_racine_illisible_ne_vide_pas_l_ecran() {
    // S09 : dégradation — un dossier illisible est ignoré, les autres
    // restent servis ; aucune notion de complétude n'apparaît.
    let mauvaise = temporaire("herdr-illisible");
    let secret = mauvaise.join("bloqué");
    fs::create_dir(&secret).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    image(&secret.join("interdite.png"), 1);
    let mut permissions = fs::metadata(&secret)
        .unwrap_or_else(|cause| panic!("métadonnées : {cause}"))
        .permissions();
    permissions.set_mode(0o000);
    fs::set_permissions(&secret, permissions).unwrap_or_else(|cause| panic!("chmod : {cause}"));
    // La racine disparue : plus présente sur le disque.
    let disparue = temporaire("herdr-disparue-scan");
    fs::remove_dir(&disparue).unwrap_or_else(|cause| panic!("suppression : {cause}"));
    let bonne = temporaire("herdr-bonne");
    image(&bonne.join("visible.png"), 1);
    let images = liste_images_recentes(&[mauvaise.clone(), disparue, bonne.clone()], 60);
    // L'image interdite est peut-être servie (le stat passe avant le chmod
    // de la concurrence ? non : le chmod précède le balayage). Elle doit
    // être ABSENTE — le dossier est illisible.
    for image in &images {
        assert!(
            !image.chemin.contains("interdite"),
            "le dossier illisible ne doit rien livrer"
        );
    }
    assert_eq!(noms(&images), ["visible.png"]);
    // Réversible, pour la politesse du système de fichiers.
    let mut permissions = fs::metadata(&secret)
        .unwrap_or_else(|cause| panic!("métadonnées : {cause}"))
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&secret, permissions).unwrap_or_else(|cause| panic!("chmod : {cause}"));
    let _ = mauvaise;
}
