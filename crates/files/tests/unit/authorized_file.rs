//! Le service de fichiers autorisés (T046, S05–S07) : racines réévaluées,
//! plafond 12 MiB, MIME exact, longueur réellement servie, lien échappant,
//! projet révoqué, erreur détaillée — rien d'inventé.

use files::authorized_file::{
    ErreurFichier, FichierServi, MAX_FILE_BYTES, describe_erreur_fichier, lit_fichier_autorise,
};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
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

fn ecrit(chemin: &Path, contenu: &[u8]) {
    let mut fichier = fs::File::create(chemin).unwrap_or_else(|cause| panic!("écriture : {cause}"));
    fichier
        .write_all(contenu)
        .unwrap_or_else(|cause| panic!("écriture : {cause}"));
}

fn refuse(contexte: &str, resultat: Result<FichierServi, ErreurFichier>, attendue: &str) {
    match resultat {
        Err(ErreurFichier::Refuse { raison }) => assert_eq!(
            raison, attendue,
            "{contexte} : raison attendue « {attendue} », trouvée « {raison} »"
        ),
        Err(ErreurFichier::Indisponible { raison }) => {
            panic!("{contexte} : refus attendu, indisponible « {raison} »")
        }
        Ok(fichier) => panic!("{contexte} : lecture inattendue de « {} »", fichier.nom),
    }
}

#[test]
fn lit_un_fichier_legitime_sous_la_racine() {
    let racine = temporaire("herdr-autorise");
    let fichier = racine.join("capture.png");
    ecrit(&fichier, b"\x89PNG\r\n\x1a\ncontenu");
    let servi = lit_fichier_autorise(std::slice::from_ref(&racine), &fichier)
        .unwrap_or_else(|cause| panic!("lecture refusée : {cause:?}"));
    assert_eq!(servi.octets, b"\x89PNG\r\n\x1a\ncontenu");
    assert_eq!(
        servi.taille, 15,
        "la longueur servie est celle du descripteur"
    );
    assert_eq!(servi.nom, "capture.png");
    assert_eq!(servi.content_type, "image/png");
}

#[test]
fn le_projet_revoque_est_refuse() {
    // S05 : les racines viennent du snapshot à CHAQUE demande — un projet
    // retiré du snapshot n'est plus servi, même si son dossier existe.
    let racine = temporaire("herdr-revoque");
    let fichier = racine.join("contenu.txt");
    ecrit(&fichier, b"contenu");
    let autre_racine = temporaire("herdr-autre");
    refuse(
        "projet révoqué",
        lit_fichier_autorise(&[autre_racine], &fichier),
        "outside the project folders",
    );
}

#[test]
fn sans_racine_aucun_fichier() {
    let racine = temporaire("herdr-sans-racine");
    let fichier = racine.join("contenu.txt");
    ecrit(&fichier, b"contenu");
    refuse(
        "aucune racine",
        lit_fichier_autorise(&[], &fichier),
        "no authorized project",
    );
}

#[test]
fn un_chemin_qui_remonte_est_refuse() {
    // `..` ne sort pas : la résolution précède la comparaison.
    let racine = temporaire("herdr-montee");
    let fichier = racine.join("contenu.txt");
    ecrit(&fichier, b"contenu");
    let parent = racine
        .parent()
        .unwrap_or_else(|| panic!("la racine temporaire n'a pas de parent"));
    let demande = parent.join("..").join("herdr-montee").join("contenu.txt");
    refuse(
        "remontée",
        lit_fichier_autorise(&[racine], &demande),
        "outside the project folders",
    );
}

#[test]
fn un_lien_echappant_est_refuse() {
    // Un lien dans la racine qui pointe DEHORS : son chemin d'appel paraît
    // légitime, sa cible réelle ne l'est pas.
    let racine = temporaire("herdr-lien");
    let dehors = temporaire("herdr-dehors");
    let secret = dehors.join("secret.txt");
    ecrit(&secret, b"hors du perimetre");
    let lien = racine.join("innocent.txt");
    std::os::unix::fs::symlink(&secret, &lien)
        .unwrap_or_else(|cause| panic!("lien symbolique : {cause}"));
    refuse(
        "lien échappant",
        lit_fichier_autorise(&[racine], &lien),
        "symlink escaping the project folders",
    );
}

#[test]
fn un_repertoire_est_refuse_et_une_absence_est_indisponible() {
    let racine = temporaire("herdr-dossier");
    refuse(
        "répertoire",
        lit_fichier_autorise(std::slice::from_ref(&racine), &racine),
        "not a file",
    );
    let manquant = racine.join("absent.txt");
    match lit_fichier_autorise(&[racine], &manquant) {
        Err(ErreurFichier::Indisponible { raison }) => {
            assert_eq!(raison, "fichier introuvable");
        }
        Err(ErreurFichier::Refuse { raison }) => {
            panic!("indisponible attendu, refus « {raison} »")
        }
        Ok(_) => panic!("lecture inattendue d'un fichier absent"),
    }
}

#[test]
fn un_fichier_trop_gros_est_refuse_pas_tronque() {
    // S06 : au-delà du plafond, refus explicite — jamais une troncature
    // muette. Le message porte la taille réelle.
    let racine = temporaire("herdr-gros");
    let fichier = racine.join("gros.bin");
    let contenu = vec![0u8; (MAX_FILE_BYTES + 1) as usize];
    ecrit(&fichier, &contenu);
    match lit_fichier_autorise(&[racine], &fichier) {
        Err(ErreurFichier::Refuse { raison }) => {
            assert!(raison.contains("trop gros"), "raison : {raison}");
            assert!(
                raison.contains("12 Mo"),
                "taille réelle dans la raison : {raison}"
            );
        }
        Err(ErreurFichier::Indisponible { raison }) => {
            panic!("refus attendu, indisponible « {raison} »")
        }
        Ok(fichier) => panic!("lecture inattendue de {} octets", fichier.taille),
    }
}

#[test]
fn la_longueur_servie_est_celle_des_octets_lus() {
    // S06 : la taille annoncée est celle mesurée sur le descripteur, et les
    // octets servis sont exactement ceux lus — un fichier plus court que
    // son `stat` ne produit pas de trou.
    let racine = temporaire("herdr-court");
    let fichier = racine.join("court.bin");
    ecrit(&fichier, b"0123456789");
    let servi = lit_fichier_autorise(&[racine], &fichier)
        .unwrap_or_else(|cause| panic!("lecture refusée : {cause:?}"));
    assert_eq!(servi.taille, 10);
    assert_eq!(servi.octets.len(), 10);
    assert_eq!(servi.octets, b"0123456789");
}

#[test]
fn le_nom_et_le_type_viennent_du_chemin_reel() {
    // Un lien INTERNE légitime : le nom et le type suivent la cible réelle,
    // pas l'extension du chemin d'appel.
    let racine = temporaire("herdr-interne");
    let cible = racine.join("capture.png");
    ecrit(&cible, b"png");
    let lien = racine.join("apercu.txt");
    std::os::unix::fs::symlink(&cible, &lien)
        .unwrap_or_else(|cause| panic!("lien symbolique : {cause}"));
    let servi = lit_fichier_autorise(&[racine], &lien)
        .unwrap_or_else(|cause| panic!("lecture refusée : {cause:?}"));
    assert_eq!(servi.nom, "capture.png");
    assert_eq!(servi.content_type, "image/png");
}

#[test]
fn une_racine_disparue_ne_fait_pas_echouer_les_autres() {
    // S05 : une racine du snapshot qui a disparu reste dans sa forme brute —
    // elle ne sert rien, mais la lecture des autres continue.
    let disparue = temporaire("herdr-disparue");
    fs::remove_dir(&disparue).unwrap_or_else(|cause| panic!("suppression : {cause}"));
    let vivante = temporaire("herdr-vivante");
    let fichier = vivante.join("contenu.txt");
    ecrit(&fichier, b"contenu");
    let servi = lit_fichier_autorise(&[disparue, vivante], &fichier)
        .unwrap_or_else(|cause| panic!("lecture refusée : {cause:?}"));
    assert_eq!(servi.octets, b"contenu");
}

#[test]
fn decrit_une_erreur_sans_divulguer_la_structure() {
    let racine = temporaire("herdr-description");
    let fichier = racine.join("contenu.txt");
    ecrit(&fichier, b"contenu");
    let autre = temporaire("herdr-autre");
    let erreur = lit_fichier_autorise(&[autre], &fichier)
        .err()
        .unwrap_or_else(|| panic!("refus attendu"));
    assert_eq!(
        describe_erreur_fichier(&erreur),
        "outside the project folders"
    );
}
