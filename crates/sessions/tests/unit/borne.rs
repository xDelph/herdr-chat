//! Le bornage du forward (T025/C18) : cible 2 MiB, plafond 16 MiB,
//! caughtUp au seul watermark complet, observe=0/1, 422 sans avancer.

use sessions::cursor::{Curseur, decode, encode};
use sessions::storage::jsonl::identity::CurseurFichier;
use sessions::storage::jsonl::reader::{
    ErreurBorne, PLAFOND_ABSOLU_OCTETS, observe_valide, page_bornee,
};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static NONCE: AtomicU32 = AtomicU32::new(0);

fn temporaire(prefixe: &str) -> PathBuf {
    let base = std::env::temp_dir();
    let chemin = base.join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match fs::create_dir(&chemin) {
        Ok(()) => chemin,
        Err(cause) => panic!("racine refusée : {cause}"),
    }
}

fn ouvre_atelier(prefixe: &str, semence: &str) -> (PathBuf, CurseurFichier) {
    let racine = temporaire(prefixe);
    let fichier = racine.join("session.jsonl");
    match fs::write(&fichier, format!("{semence}\n")) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let identite = match sessions::storage::jsonl::identity::identite_de(&fichier) {
        Ok(identite) => identite,
        Err(cause) => panic!("identité refusée : {cause}"),
    };
    (fichier, identite.curseur)
}

#[test]
fn le_delta_32mib_se_lit_sans_perte_ni_duplication() {
    // 32 MiB de lignes : paginées à la cible, le total consommé = la
    // taille du fichier, chaque ligne vue UNE fois.
    let (fichier, mut curseur) = ouvre_atelier("soutien-borne-delta", r#"{"n":0}"#);
    let mut flux = match fs::OpenOptions::new().append(true).open(&fichier) {
        Ok(flux) => flux,
        Err(cause) => panic!("append refusé : {cause}"),
    };
    let total_lignes = 2_000_usize;
    for n in 1..=total_lignes {
        // ~16 Ko par ligne → ~32 MiB au total.
        let ligne = format!("{{\"n\":{n},\"remplissage\":\"{}\"}}\n", "x".repeat(16_000));
        match flux.write_all(ligne.as_bytes()) {
            Ok(()) => (),
            Err(cause) => panic!("append refusé : {cause}"),
        }
    }
    match flux.flush() {
        Ok(()) => (),
        Err(cause) => panic!("flush refusé : {cause}"),
    }
    drop(flux);
    let mut vues: Vec<u64> = Vec::new();
    let mut pages = 0_usize;
    let mut rattrape;
    #[allow(unused_assignments)]
    {
        rattrape = false;
    }
    loop {
        match page_bornee(&fichier, &curseur, true) {
            Ok(page) => {
                for cadre in &page.cadres {
                    // La numérotation du contenu (n=0..2000) : chaque ligne
                    // vue UNE fois.
                    let n = cadre
                        .brut
                        .split("\"n\":")
                        .nth(1)
                        .map(|suite| {
                            suite
                                .split([',', '}'])
                                .next()
                                .and_then(|nombre| nombre.parse::<u64>().ok())
                                .unwrap_or(u64::MAX)
                        })
                        .unwrap_or(u64::MAX);
                    vues.push(n);
                }
                curseur = page.curseur;
                pages += 1;
                if page.a_rattrape {
                    rattrape = true;
                    break;
                }
                assert!(pages < 1_000, "la pagination doit finir : {pages} pages");
            }
            Err(cause) => panic!("page bornée refusée : {cause:?}"),
        }
    }
    assert!(rattrape, "le watermark complet est atteint");
    assert!(
        pages > 1,
        "32 MiB ne tiennent pas en une page : {pages} pages"
    );
    assert!(
        vues.len() == total_lignes + 1,
        "chaque ligne vue UNE fois : {} vs {}",
        vues.len(),
        total_lignes + 1
    );
    // Sans perte ni duplication : les n vus sont exactement 0..=2000.
    for (rang, n) in vues.iter().enumerate() {
        assert!(
            *n == rang as u64,
            "la ligne {rang} porte n={n} — pas de saut ni de doublon"
        );
    }
}

#[test]
fn caught_up_est_vrai_au_seul_watermark_complet() {
    let (fichier, initial) = ouvre_atelier("soutien-borne-caughtup", r#"{"n":0}"#);
    // Rattrapage : la position de départ = la fin de la semence.
    let rattrapee = match page_bornee(&fichier, &initial, true) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause:?}"),
    };
    let mut curseur = rattrapee.curseur;
    // Une queue PENDANTE (sans saut de ligne) : le watermark n'est PAS
    // complet — caught_up reste faux même si la page a tout rendu.
    {
        let mut flux = match fs::OpenOptions::new().append(true).open(&fichier) {
            Ok(flux) => flux,
            Err(cause) => panic!("append refusé : {cause}"),
        };
        match flux.write_all(b"{\"n\":1,\"texte\":\"en cours d'\xc3\xa9crit") {
            Ok(()) => (),
            Err(cause) => panic!("append refusé : {cause}"),
        }
        match flux.flush() {
            Ok(()) => (),
            Err(cause) => panic!("flush refusé : {cause}"),
        }
    }
    let page = match page_bornee(&fichier, &curseur, true) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause:?}"),
    };
    assert!(page.cadres.is_empty(), "la queue pendante ne se rend pas");
    assert!(
        !page.a_rattrape,
        "une queue en attente = PAS de watermark complet"
    );
    // La queue se complète : le watermark arrive.
    {
        let mut flux = match fs::OpenOptions::new().append(true).open(&fichier) {
            Ok(flux) => flux,
            Err(cause) => panic!("append refusé : {cause}"),
        };
        match flux.write_all(b"ue\"}\n") {
            Ok(()) => (),
            Err(cause) => panic!("append refusé : {cause}"),
        }
        match flux.flush() {
            Ok(()) => (),
            Err(cause) => panic!("flush refusé : {cause}"),
        }
    }
    let page = match page_bornee(&fichier, &curseur, true) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause:?}"),
    };
    assert!(page.cadres.len() == 1, "la ligne complétée arrive");
    assert!(page.a_rattrape, "maintenant le watermark est complet");
    curseur = page.curseur;
    // Et le curseur VERSIONNÉ porte la position — l'aller-retour tient.
    let opaque = encode("src", "sess", 1, curseur.offset as i64);
    match decode(&opaque) {
        Ok(Curseur::Versionne { position, .. }) => assert!(position == curseur.offset as i64),
        autre => panic!("le curseur opaque reste lisible : {autre:?}"),
    }
}

#[test]
fn un_record_hors_plafond_refuse_422_sans_avancer() {
    let (fichier, initial) = ouvre_atelier("soutien-borne-422", r#"{"n":0}"#);
    // Rattrapage : la position = la fin de la semence.
    let rattrapee = match page_bornee(&fichier, &initial, true) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause:?}"),
    };
    let curseur = rattrapee.curseur;
    // Un record de 17 MiB : au-delà du plafond de 16 MiB.
    let geant = format!("{{\"gros\":\"{}\"}}\n", "g".repeat(17 * 1024 * 1024));
    {
        let mut flux = match fs::OpenOptions::new().append(true).open(&fichier) {
            Ok(flux) => flux,
            Err(cause) => panic!("append refusé : {cause}"),
        };
        match flux.write_all(geant.as_bytes()) {
            Ok(()) => (),
            Err(cause) => panic!("append refusé : {cause}"),
        }
        match flux.flush() {
            Ok(()) => (),
            Err(cause) => panic!("flush refusé : {cause}"),
        }
    }
    match page_bornee(&fichier, &curseur, true) {
        Err(ErreurBorne::RecordHorsPlafond { taille }) => {
            assert!(
                taille as usize > PLAFOND_ABSOLU_OCTETS,
                "la taille parle : {taille}"
            );
        }
        Ok(_) => panic!("un record de 17 MiB ne se sert PAS"),
        Err(cause) => panic!("hors plafond attendu : {cause:?}"),
    }
    // Un record au-dessus de la CIBLE mais sous le PLAFOND : rendu SEUL
    // (le curseur avance — c'est la règle du géant).
    let (fichier2, initial2) = ouvre_atelier("soutien-borne-geant-moyen", r#"{"n":0}"#);
    let rattrapee2 = match page_bornee(&fichier2, &initial2, true) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause:?}"),
    };
    let curseur2 = rattrapee2.curseur;
    let moyen = format!("{{\"gros\":\"{}\"}}\n", "g".repeat(3 * 1024 * 1024));
    {
        let mut flux = match fs::OpenOptions::new().append(true).open(&fichier2) {
            Ok(flux) => flux,
            Err(cause) => panic!("append refusé : {cause}"),
        };
        match flux.write_all(moyen.as_bytes()) {
            Ok(()) => (),
            Err(cause) => panic!("append refusé : {cause}"),
        }
        match flux.flush() {
            Ok(()) => (),
            Err(cause) => panic!("flush refusé : {cause}"),
        }
    }
    match page_bornee(&fichier2, &curseur2, true) {
        Ok(page) => {
            assert!(
                page.cadres.len() == 1,
                "le moyen rendu SEUL : {}",
                page.cadres.len()
            );
            assert!(page.curseur.offset > curseur2.offset, "le curseur avance");
        }
        Err(cause) => panic!("un géant sous plafond se sert : {cause:?}"),
    }
}

#[test]
fn observe_refuse_tout_sauf_0_et_1() {
    assert!(observe_valide(None).unwrap_or(false), "défaut = 1");
    assert!(observe_valide(Some("1")).unwrap_or(false), "1 = observer");
    assert!(
        !observe_valide(Some("0")).unwrap_or(true),
        "0 = ne pas renouveler le lease"
    );
    assert!(observe_valide(Some("2")).is_err(), "2 = 400");
    assert!(observe_valide(Some("vrai")).is_err(), "vrai = 400");
    assert!(observe_valide(Some("")).is_err(), "vide = 400");
    // La page bornée PORTE le paramètre (le lease se renouvelle ailleurs,
    // T027) — la lecture ne dépend pas de lui.
    let (fichier, curseur) = ouvre_atelier("soutien-borne-observe", r#"{"n":0}"#);
    match page_bornee(&fichier, &curseur, false) {
        Ok(page) => assert!(page.a_rattrape, "la lecture marche sans renouvellement"),
        Err(cause) => panic!("observe=0 ne bloque pas la lecture : {cause:?}"),
    }
}
