//! Le lecteur JSONL (T014/C02/D09/D10) : sans perte ni duplication sur toutes
//! les coupures, offset ≤ octets consommés, troncature/rotation détectées ;
//! en-tête **borné à 64 KiB** avec ses champs déclarés et la version par
//! défaut (D09), lectures avant/queue/fenêtre et jamais d'écriture source
//! (D10).

use sessions::storage::jsonl::identity::CurseurFichier;
use sessions::storage::jsonl::reader::{page_arriere, page_avant};
use sessions::storage::jsonl::{history, identity};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static NONCE: AtomicU32 = AtomicU32::new(0);

/// Un atelier JSONL : la racine, le fichier, un curseur initial (identité
/// à offset 0).
struct Atelier {
    fichier: PathBuf,
    curseur: CurseurFichier,
}

fn ouvre_atelier(prefixe: &str, premiere_ligne: &str) -> Atelier {
    let racine = temporaire(prefixe);
    let fichier = racine.join("session.jsonl");
    match fs::write(&fichier, format!("{premiere_ligne}\n")) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let identite = match identity::identite_de(&fichier) {
        Ok(identite) => identite,
        Err(cause) => panic!("identité refusée : {cause}"),
    };
    Atelier {
        fichier,
        curseur: CurseurFichier {
            dev: identite.curseur.dev,
            ino: identite.curseur.ino,
            offset: identite.curseur.offset,
        },
    }
}

fn temporaire(prefixe: &str) -> PathBuf {
    let base = std::env::temp_dir();
    let pid = std::process::id();
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let chemin = base.join(format!("{prefixe}-{pid}-{nonce}"));
    match fs::create_dir(&chemin) {
        Ok(()) => chemin,
        Err(cause) => panic!("racine refusée : {cause}"),
    }
}

fn ajoute(fichier: &Path, contenu: &str) {
    let mut flux = match fs::OpenOptions::new().append(true).open(fichier) {
        Ok(flux) => flux,
        Err(cause) => panic!("append refusé : {cause}"),
    };
    match flux.write_all(contenu.as_bytes()) {
        Ok(()) => (),
        Err(cause) => panic!("append refusé : {cause}"),
    }
    match flux.flush() {
        Ok(()) => (),
        Err(cause) => panic!("flush refusé : {cause}"),
    }
}

#[test]
fn la_page_vide_ne_duplique_rien() {
    let atelier = ouvre_atelier("soutien-jsonl-vide", r#"{"type":"session"}"#);
    // La première page (offset 0) lit la ligne de semence — puis la page
    // suivante est la vraie page vide.
    let premiere = match page_avant(&atelier.fichier, &atelier.curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(
        premiere.cadres.len() == 1,
        "la semence se lit : {:?}",
        premiere.cadres.len()
    );
    let curseur = premiere.curseur;
    let page = match page_avant(&atelier.fichier, &curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(page.cadres.is_empty(), "rien de nouveau → aucune ligne");
    assert!(page.a_rattrape, "tout est consommé");
    assert!(!page.reinitialisee);
    assert!(
        page.curseur.offset == curseur.offset,
        "l'offset ne bouge pas à vide"
    );
}

#[test]
fn les_coupures_utf8_et_newline_ne_perdent_rien_ni_dupliquent() {
    let atelier = ouvre_atelier("soutien-jsonl-coupure", r#"{"n":0}"#);
    // Une page de rattrapage d'abord : la position de départ = la fin de
    // la semence.
    let rattrapee = match page_avant(&atelier.fichier, &atelier.curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    let mut curseur = rattrapee.curseur;
    // Un append coupé EN PLEIN MILIEU d'un « é » (0xC3, puis 0xA9), sans
    // saut de ligne : EN ATTENTE.
    {
        let mut flux = match fs::OpenOptions::new().append(true).open(&atelier.fichier) {
            Ok(flux) => flux,
            Err(cause) => panic!("append refusé : {cause}"),
        };
        match flux.write_all(b"{\"n\":1,\"texte\":\"accentu\xc3") {
            Ok(()) => (),
            Err(cause) => panic!("append refusé : {cause}"),
        }
        match flux.flush() {
            Ok(()) => (),
            Err(cause) => panic!("flush refusé : {cause}"),
        }
    }
    let page = match page_avant(&atelier.fichier, &curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(
        page.cadres.is_empty(),
        "la queue incomplète n'est pas rendue : {:?}",
        page.cadres
    );
    assert!(page.curseur.offset == curseur.offset, "rien n'est consommé");
    // L'append se complète : la ligne entière arrive, UNE fois, l'UTF-8
    // recollé au milieu.
    {
        let mut flux = match fs::OpenOptions::new().append(true).open(&atelier.fichier) {
            Ok(flux) => flux,
            Err(cause) => panic!("append refusé : {cause}"),
        };
        match flux.write_all(b"\xa9\"}\n") {
            Ok(()) => (),
            Err(cause) => panic!("append refusé : {cause}"),
        }
        match flux.flush() {
            Ok(()) => (),
            Err(cause) => panic!("flush refusé : {cause}"),
        }
    }
    let page = match page_avant(&atelier.fichier, &curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(
        page.cadres.len() == 1,
        "UNE ligne complète : {:?}",
        page.cadres.len()
    );
    assert!(
        page.cadres[0].brut.contains("accentué"),
        "l'UTF-8 recollé : {}",
        page.cadres[0].brut
    );
    curseur = page.curseur;
    // Une page de plus : rien de nouveau, rien de dupliqué.
    let page = match page_avant(&atelier.fichier, &curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(page.cadres.is_empty() && page.curseur.offset == curseur.offset);
}

#[test]
fn les_plusieurs_appends_se_suivent_sans_perte_ni_duplication() {
    let atelier = ouvre_atelier("soutien-jsonl-appends", r#"{"n":0}"#);
    let rattrapee = match page_avant(&atelier.fichier, &atelier.curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    let mut curseur = rattrapee.curseur;
    let mut vues: Vec<String> = Vec::new();
    for n in 1..=5 {
        ajoute(&atelier.fichier, &format!("{{\"n\":{n}}}\n"));
        let page = match page_avant(&atelier.fichier, &curseur, 4096) {
            Ok(page) => page,
            Err(cause) => panic!("page refusée : {cause}"),
        };
        for cadre in &page.cadres {
            vues.push(cadre.brut.clone());
        }
        assert!(
            page.curseur.offset > curseur.offset || page.cadres.is_empty(),
            "l'offset avance quand des lignes arrivent"
        );
        curseur = page.curseur;
        // Invariant C02 : l'offset ≤ la taille réelle du fichier.
        let taille = match fs::metadata(&atelier.fichier) {
            Ok(meta) => meta.len(),
            Err(cause) => panic!("metadata refusée : {cause}"),
        };
        assert!(
            curseur.offset <= taille,
            "offset ≤ octets consommés : {} > {taille}",
            curseur.offset
        );
    }
    assert!(vues.len() == 5, "cinq lignes vues, pas {}", vues.len());
    for (rang, ligne) in vues.iter().enumerate() {
        let attendu = format!("\"n\":{}", rang + 1);
        assert!(
            ligne.contains(&attendu),
            "la ligne {rang} porte {attendu} : {ligne}"
        );
    }
}

#[test]
fn une_troncature_ou_une_rotation_est_reinitialisee_explicitement() {
    let atelier = ouvre_atelier("soutien-jsonl-troncature", r#"{"n":0}"#);
    // Rattrapage d'abord : la position de départ = la fin de la semence.
    let rattrapee = match page_avant(&atelier.fichier, &atelier.curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    let mut curseur = rattrapee.curseur;
    for n in 1..=3 {
        ajoute(&atelier.fichier, &format!("{{\"n\":{n}}}\n"));
    }
    let page = match page_avant(&atelier.fichier, &curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(
        page.cadres.len() == 3,
        "les trois appends : {}",
        page.cadres.len()
    );
    assert!(!page.reinitialisee, "la continuité tient");
    curseur = page.curseur;
    // TRONCATURE : le même inode, plus court que l'offset.
    match fs::write(&atelier.fichier, "{\"nouveau\":true}\n") {
        Ok(()) => (),
        Err(cause) => panic!("troncature refusée : {cause}"),
    }
    let page = match page_avant(&atelier.fichier, &curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(
        page.reinitialisee,
        "l'offset au-delà de la taille → réinitialisation NAMÉE"
    );
    assert!(
        page.curseur.offset
            >= page
                .cadres
                .last()
                .map(|c| c.depart + c.consomme)
                .unwrap_or(0)
    );
    assert!(page.cadres.len() == 1 && page.cadres[0].brut.contains("nouveau"));
    // ROTATION : un NOUVEAU fichier (dev/ino différent) → réinitialisation.
    let ancien = atelier.fichier.clone();
    let remplacement = atelier.fichier.with_extension("nouveau.jsonl");
    match fs::write(&remplacement, "{\"tourne\":1}\n") {
        Ok(()) => (),
        Err(cause) => panic!("rotation refusée : {cause}"),
    }
    match fs::rename(&remplacement, &ancien) {
        Ok(()) => (),
        Err(cause) => panic!("rename refusé : {cause}"),
    }
    let page = match page_avant(&atelier.fichier, &curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(
        page.reinitialisee,
        "l'identité a changé → réinitialisation nommée"
    );
    assert!(page.cadres.len() == 1 && page.cadres[0].brut.contains("tourne"));
}

#[test]
fn un_record_geant_est_rendu_seul_et_fait_avancer() {
    let atelier = ouvre_atelier("soutien-jsonl-geant", r#"{"n":0}"#);
    // Rattrapage : la position de départ = la fin de la semence.
    let rattrapee = match page_avant(&atelier.fichier, &atelier.curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    let curseur = rattrapee.curseur;
    // Un enregistrement de 5 MiB : au-delà d'une cible d'1 MiB — il est
    // rendu SEUL (un lecteur bloqué sur un géant ne rattraperait jamais).
    let geant = format!("{{\"n\":1,\"gros\":\"{}\"}}\n", "g".repeat(5 * 1024 * 1024));
    ajoute(&atelier.fichier, &geant);
    ajoute(&atelier.fichier, "{\"n\":2}\n");
    let page = match page_avant(&atelier.fichier, &curseur, 1024 * 1024) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(
        page.cadres.len() == 1,
        "le géant seul : {}",
        page.cadres.len()
    );
    assert!(
        page.cadres[0].brut.contains("gros"),
        "c'est le géant qui avance"
    );
    assert!(
        page.curseur.offset > curseur.offset,
        "le curseur a AVANCÉ au-delà du géant"
    );
}

#[test]
fn la_page_arriere_rend_le_passé_et_ou_le_reprendre() {
    let atelier = ouvre_atelier("soutien-jsonl-arriere", r#"{"n":1}"#);
    for n in 2..=6 {
        ajoute(&atelier.fichier, &format!("{{\"n\":{n}}}\n"));
    }
    // Une page arrière depuis la fin : les DEUX dernières lignes.
    let identite = match identity::identite_de(&atelier.fichier) {
        Ok(identite) => identite,
        Err(cause) => panic!("identité refusée : {cause}"),
    };
    let fin = CurseurFichier {
        dev: identite.curseur.dev,
        ino: identite.curseur.ino,
        offset: identite.taille,
    };
    let page = match page_arriere(&atelier.fichier, &fin, 16) {
        Ok(page) => page,
        Err(cause) => panic!("page arrière refusée : {cause}"),
    };
    assert!(
        page.cadres.len() == 2,
        "deux lignes dans la cible de 16 octets : {}",
        page.cadres.len()
    );
    assert!(
        page.cadres[0].brut.contains("\"n\":5"),
        "l'ordre de lecture est conservé : {}",
        page.cadres[0].brut
    );
    assert!(page.cadres[1].brut.contains("\"n\":6"));
    // Le curseur rendu = le DÉBUT de la première ligne rendue : une page
    // arrière depuis là rend le passé juste avant — sans saut ni doublon.
    let page_avant2 = match page_arriere(&atelier.fichier, &page.curseur, 16) {
        Ok(page) => page,
        Err(cause) => panic!("page arrière refusée : {cause}"),
    };
    assert!(
        page_avant2.cadres[0].brut.contains("\"n\":3"),
        "le passé continue : {}",
        page_avant2.cadres[0].brut
    );
    assert!(
        page_avant2.curseur.offset < page.curseur.offset,
        "on recule vraiment"
    );
}

#[test]
fn len_tete_de_session_se_lit_une_fois() {
    let atelier = ouvre_atelier("soutien-jsonl-entete", r#"{"type":"session","cwd":"/p"}"#);
    match history::en_tete(&atelier.fichier) {
        Ok(Some(entete)) => assert!(
            entete.brut.contains("\"type\":\"session\"")
                || entete.brut.contains("\"type\": \"session\""),
            "l'en-tête se déclare : {}",
            entete.brut
        ),
        Ok(None) => panic!("l'en-tête du corpus se déclare"),
        Err(cause) => panic!("lecture refusée : {cause}"),
    }
    // La queue porte un autre nom au fil — même moteur.
    let page = match history::queue(&atelier.fichier, &atelier.curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("queue refusée : {cause}"),
    };
    assert!(page.a_rattrape, "la queue rattrape");
    assert!(
        page.cadres.len() == 1,
        "l'en-tête est une ligne comme les autres : {:?}",
        page.cadres.len()
    );
}

#[test]
fn l_entete_est_borne_et_porte_ses_champs() {
    let atelier = ouvre_atelier(
        "soutien-jsonl-entete-champs",
        r#"{"type":"session","id":"sess-1","cwd":"/p","parentSession":"sess-0","version":3}"#,
    );
    match history::en_tete(&atelier.fichier) {
        Ok(Some(entete)) => {
            assert_eq!(entete.id.as_deref(), Some("sess-1"));
            assert_eq!(entete.cwd.as_deref(), Some("/p"));
            assert_eq!(entete.parent_session.as_deref(), Some("sess-0"));
            assert_eq!(entete.version, 3);
        }
        autre => panic!("en-tête attendu : {autre:?}"),
    }
}

#[test]
fn une_version_absente_vaut_un_et_rien_d_autre() {
    let atelier = ouvre_atelier(
        "soutien-jsonl-entete-version",
        r#"{"type":"session","id":"sess-2"}"#,
    );
    match history::en_tete(&atelier.fichier) {
        Ok(Some(entete)) => {
            assert_eq!(
                entete.version,
                history::VERSION_DEFAUT,
                "la version par défaut est déclarée, pas devinée"
            );
            assert_eq!(entete.cwd, None);
        }
        autre => panic!("en-tête attendu : {autre:?}"),
    }
}

#[test]
fn une_premiere_ligne_geante_n_est_pas_un_entete() {
    // ⚠️ La borne D09 : au-delà de 64 KiB sans saut de ligne, on ne lit pas
    // la suite du fichier — absence d'en-tête, jamais une lecture totale.
    let atelier = ouvre_atelier("soutien-jsonl-entete-borne", "{\"type\":\"session\"");
    let geant = "x".repeat(history::ENTETE_MAX_OCTETS);
    match std::fs::write(&atelier.fichier, &geant) {
        Ok(()) => (),
        Err(cause) => panic!("écriture : {cause}"),
    }
    match history::en_tete(&atelier.fichier) {
        Ok(None) => (),
        autre => panic!("absence d'en-tête attendue : {autre:?}"),
    }
}

#[test]
fn un_octet_invalide_ne_casse_pas_la_lecture_de_l_entete() {
    // Un agent peut être coupé au milieu d'un caractère : la ligne reste
    // lisible en UTF-8 tolérant (aucune erreur de lecture).
    let atelier = ouvre_atelier("soutien-jsonl-entete-utf8", r#"{"type":"session"}"#);
    let mut octets = std::fs::read(&atelier.fichier).unwrap_or_else(|cause| panic!("{cause}"));
    // L'octet invalide est posé **après** le marqueur : un agent coupé au
    // milieu d'un caractère ne doit pas rendre l'en-tête illisible.
    let fin = octets
        .iter()
        .position(|octet| *octet == b'\n')
        .unwrap_or(octets.len());
    octets.insert(fin, 0xFF);
    match std::fs::write(&atelier.fichier, &octets) {
        Ok(()) => (),
        Err(cause) => panic!("écriture : {cause}"),
    }
    match history::en_tete(&atelier.fichier) {
        Ok(Some(entete)) => assert!(entete.brut.contains("session"), "{}", entete.brut),
        Ok(None) => panic!("l'en-tête se lit malgré l'octet invalide"),
        Err(cause) => panic!("lecture refusée : {cause}"),
    }
}
