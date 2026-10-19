//! L'adaptateur `ArtifactPort` (T056 suite) : la garde reste dans `files`.
//!
//! ⚠️ Ce qui compte ici : un refus est un `PathRejected` (403 nommé), jamais
//! une panne ; et le type servi suit le chemin RÉEL, pas le nom d'appel.

use domain::errors::PortError;
use domain::ports::{ArtifactPort, AuthorizedFileRequest, AuthorizedRoots, PortFuture};
use files::port::{PortArtefacts, erreur_de_port};
use std::path::PathBuf;

/// Attend un port : les adaptateurs répondent au premier poll (convention du
/// socle) — pas besoin de runtime async pour les tester.
fn attends<T: Send>(mut futur: PortFuture<'_, T>) -> Result<T, PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => panic!("un port bloquant répond au premier poll"),
    }
}

/// Un dossier temporaire isolé — jamais un dossier de l'utilisateur.
fn dossier() -> PathBuf {
    let unique = format!(
        "files-port-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duree| duree.as_nanos())
            .unwrap_or(0)
    );
    let chemin = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&chemin).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    chemin
}

fn racines(chemin: &std::path::Path) -> AuthorizedRoots {
    AuthorizedRoots {
        entries: vec![chemin.display().to_string()],
    }
}

#[test]
fn un_fichier_autorise_est_servi_avec_son_type() {
    let racine = dossier();
    let fichier = racine.join("notes.txt");
    std::fs::write(&fichier, b"bonjour").unwrap_or_else(|cause| panic!("écriture : {cause}"));
    let port = PortArtefacts::nouveau();
    let corps = attends(port.open(AuthorizedFileRequest {
        requested: fichier.display().to_string(),
        roots: racines(&racine),
    }))
    .unwrap_or_else(|cause| panic!("lecture : {cause:?}"));
    assert_eq!(corps.bytes, b"bonjour");
    assert_eq!(corps.content_type, "text/plain; charset=utf-8");
    assert!(corps.inline);
    assert_eq!(corps.filename.as_deref(), Some("notes.txt"));
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_svg_n_est_jamais_rendu_inline() {
    let racine = dossier();
    let fichier = racine.join("logo.svg");
    std::fs::write(&fichier, b"<svg/>").unwrap_or_else(|cause| panic!("écriture : {cause}"));
    let port = PortArtefacts::nouveau();
    let corps = attends(port.open(AuthorizedFileRequest {
        requested: fichier.display().to_string(),
        roots: racines(&racine),
    }))
    .unwrap_or_else(|cause| panic!("lecture : {cause:?}"));
    // S07 : le SVG peut porter du script — il n'est pas dans la liste
    // blanche, donc il est **téléchargé** et servi comme un binaire opaque
    // (`application/octet-stream`), jamais interprété.
    assert!(!corps.inline);
    assert_eq!(corps.content_type, "application/octet-stream");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_chemin_hors_racine_est_un_refus_nomme() {
    let racine = dossier();
    let port = PortArtefacts::nouveau();
    let erreur = attends(port.open(AuthorizedFileRequest {
        requested: String::from("/etc/passwd"),
        roots: racines(&racine),
    }))
    .err()
    .unwrap_or_else(|| panic!("hors racine = refus"));
    match erreur {
        domain::errors::PortError::PathRejected { detail } => {
            assert!(!detail.is_empty(), "la raison est nommée : {detail}");
        }
        autre => panic!("un refus de chemin n'est pas une panne : {autre:?}"),
    }
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn sans_racine_rien_n_est_autorise() {
    let port = PortArtefacts::nouveau();
    let erreur = attends(port.open(AuthorizedFileRequest {
        requested: String::from("/tmp/x"),
        roots: AuthorizedRoots { entries: vec![] },
    }))
    .err()
    .unwrap_or_else(|| panic!("sans racine = refus"));
    let PortError::PathRejected { detail } = erreur else {
        panic!("attendu : refus de chemin");
    };
    assert!(detail.contains("authorized"), "{detail}");
}

#[test]
fn les_images_recentes_suivent_les_racines_donnees() {
    let racine = dossier();
    std::fs::write(racine.join("capture.png"), b"png")
        .unwrap_or_else(|cause| panic!("écriture : {cause}"));
    std::fs::write(racine.join("notes.txt"), b"txt")
        .unwrap_or_else(|cause| panic!("écriture : {cause}"));
    let port = PortArtefacts::nouveau();
    let balayage = attends(port.recent_images(racines(&racine)))
        .unwrap_or_else(|cause| panic!("balayage : {cause:?}"));
    assert_eq!(balayage.images.len(), 1, "seules les images");
    assert!(balayage.images[0].path.ends_with("capture.png"));
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn une_erreur_de_fichier_devient_un_refus_de_port() {
    use files::authorized_file::ErreurFichier;
    let refus = erreur_de_port(&ErreurFichier::Refuse {
        raison: String::from("outside the project folders"),
    });
    match refus {
        domain::errors::PortError::PathRejected { detail } => {
            assert_eq!(detail, "outside the project folders");
        }
        autre => panic!("un refus garde sa nature : {autre:?}"),
    }
}
