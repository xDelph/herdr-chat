//! L'ouverture confinée (T011/C13) : sortie, sibling, encodage, swap de
//! lien, FIFO, périphérique — et le lien interne légitime, la RAII, l'absence
//! de fuite de descripteurs.

use files::confined::{
    FichierAutorise, RacineAutorisee, RefusOuverture, est_sous, normalise, ouvre_confine,
};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

/// Un répertoire temporaire unique — construit ici en `std` : la porte
/// graphe interdit d'ajouter une dépendance dev sur `test-support` hors de
/// son arête prévue, et c'est très bien ainsi (15 lignes).
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

/// Une racine de travail par essai, avec un fichier régulier dedans.
struct Atelier {
    racine: PathBuf,
    fichier: PathBuf,
}

fn atelier(prefixe: &str) -> Atelier {
    let racine = temporaire(prefixe);
    let fichier = racine.join("contenu.txt");
    match fs::write(&fichier, "le contenu autorisé") {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    Atelier { racine, fichier }
}

/// Un FIFO au chemin donné — via le binaire `mkfifo` (l'appel direct serait
/// `unsafe` ; le workspace l'interdit).
fn fifo(chemin: &Path) {
    let resultat = std::process::Command::new("mkfifo").arg(chemin).output();
    match resultat {
        Ok(sortie) if sortie.status.success() => (),
        autre => panic!("mkfifo a échoué : {autre:?}"),
    }
}

fn refuse(
    ouvert: Result<FichierAutorise, RefusOuverture>,
    attendu: &RefusOuverture,
    contexte: &str,
) {
    match ouvert {
        Err(refus) => assert!(
            refus == *attendu,
            "{contexte} : {refus:?} au lieu de {attendu:?}"
        ),
        Ok(_) => panic!("{contexte} : devait être refusé ({attendu:?})"),
    }
}

#[test]
fn un_fichier_legitime_dans_sa_racine_ouvre_et_lit() {
    let atelier = atelier("soutien-confine-legitime");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let mut ouvert = match ouvre_confine(std::slice::from_ref(&racine), &atelier.fichier, 1_048_576)
    {
        Ok(ouvert) => ouvert,
        Err(cause) => panic!("ouverture légitime refusée : {cause:?}"),
    };
    assert!(
        ouvert.nom() == "contenu.txt",
        "le nom naturel est le dernier composant"
    );
    match ouvert.lis() {
        Ok(octets) => assert!(
            octets == "le contenu autorisé".as_bytes(),
            "les octets passent tels quels"
        ),
        Err(cause) => panic!("lecture refusée : {cause:?}"),
    }
}

#[test]
fn la_sortie_le_frere_et_le_deux_points_sont_refuses() {
    let atelier = atelier("soutien-confine-sortie");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    // Sortie par `..` : refusé avant même la résolution réelle.
    refuse(
        ouvre_confine(
            &racines,
            &atelier.racine.join("..").join("ailleurs.txt"),
            1_048_576,
        ),
        &RefusOuverture::HorsRacine,
        "sortie par ..",
    );
    // Dossier frère : la comparaison par composants refuse /racine-frère.
    let frere = atelier
        .racine
        .parent()
        .map(|parent| parent.join("frere-malveillant.txt"));
    if let Some(frere) = frere {
        refuse(
            ouvre_confine(&racines, &frere, 1_048_576),
            &RefusOuverture::HorsRacine,
            "frère",
        );
    }
    // Un chemin absolu extérieur : refusé.
    refuse(
        ouvre_confine(&racines, Path::new("/etc/passwd"), 1_048_576),
        &RefusOuverture::HorsRacine,
        "absolu",
    );
}

#[test]
fn le_lien_sortant_est_refuse_et_le_lien_interne_passe() {
    let atelier = atelier("soutien-confine-liens");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    // Lien INTERNE : légitime, accepté — le contenu visé est servi.
    let interne = atelier.racine.join("lien-interne.txt");
    match std::os::unix::fs::symlink(&atelier.fichier, &interne) {
        Ok(()) => (),
        Err(cause) => panic!("symlink interne refusé : {cause}"),
    }
    let mut ouvert = match ouvre_confine(&racines, &interne, 1_048_576) {
        Ok(ouvert) => ouvert,
        Err(cause) => panic!("lien interne légitime refusé : {cause:?}"),
    };
    match ouvert.lis() {
        Ok(octets) => assert!(
            octets == "le contenu autorisé".as_bytes(),
            "le lien interne lit la cible"
        ),
        Err(cause) => panic!("lecture du lien interne refusée : {cause:?}"),
    }
    // Lien SORTANT : la cible est dehors — refusé même si l'appel paraît
    // légitime.
    let sortant = atelier.racine.join("lien-sortant.txt");
    match std::os::unix::fs::symlink("/etc/passwd", &sortant) {
        Ok(()) => (),
        Err(cause) => panic!("symlink sortant refusé : {cause}"),
    }
    refuse(
        ouvre_confine(&racines, &sortant, 1_048_576),
        &RefusOuverture::LienSortant,
        "lien sortant",
    );
}

#[test]
fn le_swap_de_lien_est_refuse_a_la_reouverture() {
    let atelier = atelier("soutien-confine-swap");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    let lien = atelier.racine.join("swap.txt");
    match std::os::unix::fs::symlink(&atelier.fichier, &lien) {
        Ok(()) => (),
        Err(cause) => panic!("symlink refusé : {cause}"),
    }
    match ouvre_confine(&racines, &lien, 1_048_576) {
        Ok(_) => (),
        Err(cause) => panic!("première ouverture légitime refusée : {cause:?}"),
    }
    // Le « swap » : le même chemin d'appel pointe maintenant dehors. La
    // réouverture doit REFUSER — ce qui est ouvert est ce qui a été validé.
    match fs::remove_file(&lien) {
        Ok(()) => (),
        Err(cause) => panic!("retrait refusé : {cause}"),
    }
    match std::os::unix::fs::symlink("/etc/passwd", &lien) {
        Ok(()) => (),
        Err(cause) => panic!("re-symlink refusé : {cause}"),
    }
    refuse(
        ouvre_confine(&racines, &lien, 1_048_576),
        &RefusOuverture::LienSortant,
        "lien swappé vers l'extérieur",
    );
}

#[test]
fn un_fifo_est_refuse_sans_bloquer() {
    let atelier = atelier("soutien-confine-fifo");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    let tube = atelier.racine.join("tube");
    fifo(&tube);
    // O_NONBLOCK est posé à l'ouverture : un FIFO sans lecteur ne bloque pas.
    refuse(
        ouvre_confine(&racines, &tube, 1_048_576),
        &RefusOuverture::PasUnFichierRegulier,
        "FIFO",
    );
}

#[test]
fn un_repertoire_est_refuse_comme_non_regulier() {
    let atelier = atelier("soutien-confine-repertoire");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    let dossier = atelier.racine.join("dossier");
    match fs::create_dir(&dossier) {
        Ok(()) => (),
        Err(cause) => panic!("mkdir refusé : {cause}"),
    }
    refuse(
        ouvre_confine(&racines, &dossier, 1_048_576),
        &RefusOuverture::PasUnFichierRegulier,
        "répertoire",
    );
}

#[test]
fn un_peripherique_est_refuse() {
    let atelier = atelier("soutien-confine-device");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    // Un lien vers /dev/null (périphérique à caractères) : la cible réelle
    // est hors racine ET non régulière — le garde la refuse.
    let device = atelier.racine.join("vers-dev-null");
    match std::os::unix::fs::symlink("/dev/null", &device) {
        Ok(()) => (),
        Err(cause) => panic!("symlink device refusé : {cause}"),
    }
    let ouvert = ouvre_confine(&racines, &device, 1_048_576);
    match &ouvert {
        Err(RefusOuverture::LienSortant) | Err(RefusOuverture::PasUnFichierRegulier) => (),
        autre => panic!("un périphérique doit être refusé, pas {autre:?}"),
    }
}

#[test]
fn un_fichier_trop_gros_est_refuse_pas_tronque() {
    let atelier = atelier("soutien-confine-taille");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    let gros = atelier.racine.join("gros.bin");
    let mut fichier = match fs::File::create(&gros) {
        Ok(fichier) => fichier,
        Err(cause) => panic!("création refusée : {cause}"),
    };
    match fichier.write_all(&vec![0_u8; 2_048]) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    drop(fichier);
    match ouvre_confine(&racines, &gros, 1_024) {
        Err(RefusOuverture::TropGros { taille, maximum }) => {
            assert!(
                taille == 2_048 && maximum == 1_024,
                "les tailles parlent : {taille}/{maximum}"
            );
        }
        autre => panic!("trop gros doit être refusé avec ses tailles, pas {autre:?}"),
    }
}

#[test]
fn les_echecs_repetes_ne_fuient_pas_les_descripteurs() {
    let atelier = atelier("soutien-confine-raii");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    // 5 000 échecs (FIFO refusé) : chaque descripteur meurt avec la valeur
    // d'erreur (RAII) — la 5 001re ouverture légitime doit encore réussir.
    let tube = atelier.racine.join("tube");
    fifo(&tube);
    for rang in 0..5_000 {
        match ouvre_confine(&racines, &tube, 1_048_576) {
            Err(RefusOuverture::PasUnFichierRegulier) => (),
            autre => panic!("le FIFO doit être refusé au passage {rang} : {autre:?}"),
        }
    }
    let mut dernier = match ouvre_confine(&racines, &atelier.fichier, 1_048_576) {
        Ok(ouvert) => ouvert,
        Err(cause) => panic!("après 5 000 échecs, une ouverture légitime doit marcher : {cause:?}"),
    };
    match dernier.lis() {
        Ok(octets) => assert!(!octets.is_empty(), "la lecture reste bonne"),
        Err(cause) => panic!("la lecture finale doit marcher : {cause:?}"),
    }
}

#[test]
fn la_troncature_concurrente_est_explicite() {
    let atelier = atelier("soutien-confine-troncature");
    let racine = match RacineAutorisee::nouveau(&atelier.racine) {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racines = vec![racine];
    let mut ouvert = match ouvre_confine(&racines, &atelier.fichier, 1_048_576) {
        Ok(ouvert) => ouvert,
        Err(cause) => panic!("ouverture refusée : {cause:?}"),
    };
    // Le fichier est TRONQUÉ après l'ouverture (concurrent) : la lecture
    // rend les octets **réellement lus**, sans panne ni padding.
    match fs::write(&atelier.fichier, "court") {
        Ok(()) => (),
        Err(cause) => panic!("réécriture refusée : {cause}"),
    }
    match ouvert.lis() {
        Ok(octets) => assert!(octets == b"court", "les octets réellement lus : {octets:?}"),
        Err(cause) => panic!("la troncature concurrente ne doit pas paner : {cause:?}"),
    }
}

#[test]
fn la_normalisation_lexicale_reduit_points_et_parents() {
    assert!(
        normalise(Path::new("/a/b/../c")) == Path::new("/a/c"),
        "les .. se réduisent"
    );
    assert!(
        normalise(Path::new("/a/./b")) == Path::new("/a/b"),
        "les . tombent"
    );
    assert!(
        normalise(Path::new("a/b")) == Path::new("a/b"),
        "un relatif reste relatif"
    );
}

#[test]
fn la_comparaison_par_composants_refuse_le_frere() {
    let racine = Path::new("/projets/atelier");
    assert!(
        est_sous(racine, Path::new("/projets/atelier")),
        "la racine est sous elle-même"
    );
    assert!(
        est_sous(racine, Path::new("/projets/atelier/sous/fichier")),
        "descendant ok"
    );
    assert!(
        !est_sous(racine, Path::new("/projets/atelier-malveillant")),
        "frère refusé"
    );
    assert!(!est_sous(racine, Path::new("/projets")), "parent refusé");
}
