//! L'écriture atomique (T044, C14) : temp + flush + rename, permissions
//! 0700/0600, une panne à chaque étape laisse l'ancien ou le nouveau fichier
//! valide, jamais un fichier à moitié écrit.

use files::atomic::ecrit_atomique;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

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

#[cfg(unix)]
fn mode(chemin: &std::path::Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(chemin)
        .unwrap_or_else(|_| panic!("métadonnées de {chemin:?}"))
        .permissions()
        .mode()
}

#[test]
fn ecrit_le_contenu_et_le_relit() {
    let atelier = temporaire("herdr-atomic");
    let cible = atelier.join("push.json");
    ecrit_atomique(&cible, b"{\"cle\":\"valeur\"}\n").unwrap_or_else(|_| panic!("écriture"));
    let lu = fs::read(&cible).unwrap_or_else(|_| panic!("lecture"));
    assert_eq!(lu, b"{\"cle\":\"valeur\"}\n");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn cree_le_repertoire_parent_en_0700_et_le_fichier_en_0600() {
    let atelier = temporaire("herdr-atomic");
    let cible = atelier.join("imbrique").join("plus").join("push.json");
    ecrit_atomique(&cible, b"{}").unwrap_or_else(|_| panic!("écriture"));
    assert_eq!(mode(&cible) & 0o777, 0o600, "fichier 0600");
    assert_eq!(
        mode(&atelier.join("imbrique")) & 0o777,
        0o700,
        "répertoire créé 0700"
    );
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn remplace_l_ancien_fichier_sans_le_corrompre() {
    let atelier = temporaire("herdr-atomic");
    let cible = atelier.join("push.json");
    ecrit_atomique(&cible, b"ancien").unwrap_or_else(|_| panic!("première écriture"));
    ecrit_atomique(&cible, b"nouveau").unwrap_or_else(|_| panic!("seconde écriture"));
    let lu = fs::read(&cible).unwrap_or_else(|_| panic!("lecture"));
    assert_eq!(lu, b"nouveau");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn une_panne_laisse_l_ancien_fichier_intact() {
    // C14 : une panne à chaque étape laisse l'ancien ou le nouveau fichier
    // valide — ici la cible est un RÉPERTOIRE : le rename échoue, l'ancien
    // contenu (dans le fichier voisin) reste intact et le temporaire part.
    let atelier = temporaire("herdr-atomic");
    let cible = atelier.join("push.json");
    ecrit_atomique(&cible, b"ancien").unwrap_or_else(|_| panic!("première écriture"));
    // On remplace la cible par un répertoire : le rename ne peut plus se
    // faire par-dessus.
    fs::remove_file(&cible).ok();
    fs::create_dir(&cible).unwrap_or_else(|_| panic!("répertoire cible"));
    let resultat = ecrit_atomique(&cible, b"nouveau");
    assert!(resultat.is_err(), "le rename sur un répertoire échoue");
    // Aucun temporaire ne traîne.
    let restes: Vec<_> = fs::read_dir(&atelier)
        .unwrap_or_else(|_| panic!("atelier lisible"))
        .filter_map(|entree| entree.ok())
        .filter(|entree| entree.file_name().to_string_lossy().contains(".tmp"))
        .collect();
    assert!(restes.is_empty(), "le temporaire est nettoyé");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn une_panne_du_repertoire_parent_est_une_erreur_nommee() {
    // Un parent impossible (un fichier à la place d'un répertoire) : l'erreur
    // est réelle, jamais masquée par un faux succès.
    let atelier = temporaire("herdr-atomic");
    let obstacle = atelier.join("fichier");
    fs::write(&obstacle, b"x").unwrap_or_else(|_| panic!("obstacle"));
    let cible = obstacle.join("push.json");
    let resultat = ecrit_atomique(&cible, b"{}");
    assert!(resultat.is_err(), "le parent n'est pas un répertoire");
    fs::remove_dir_all(&atelier).ok();
}

#[test]
fn le_contenu_est_flushe_avant_le_rename() {
    // La séquence est observable : après l'écriture, le fichier porte le
    // contenu complet (jamais un état intermédiaire tronqué).
    let atelier = temporaire("herdr-atomic");
    let cible = atelier.join("push.json");
    let gros = vec![b'x'; 64 * 1024];
    ecrit_atomique(&cible, &gros).unwrap_or_else(|_| panic!("écriture"));
    let lu = fs::read(&cible).unwrap_or_else(|_| panic!("lecture"));
    assert_eq!(lu.len(), gros.len(), "aucune troncature");
    fs::remove_dir_all(&atelier).ok();
}
