//! Les **propriétés** du lecteur JSONL et des curseurs (T064).
//!
//! ⚠️ **Pourquoi un fichier de propriétés, et pas un test de plus.** Les tests
//! unitaires vérifient des cas écrits à la main : ils disent « ces coupures-là
//! marchent ». Une propriété dit « **aucune** coupure ne perd une ligne, pour
//! n'importe quelle suite d'écritures et n'importe quelle taille de page » —
//! et c'est cette phrase-là qui doit être vraie, parce que les agents coupent
//! leurs écritures au hasard, jamais aux endroits qui arrangent.
//!
//! ⚠️ **Reproductible sans dépendance** : le générateur est un LCG explicite,
//! la graine est fixe et chaque échec affiche la graine et le pas. Un test
//! pseudo-aléatoire qu'on ne peut pas rejouer n'est pas une preuve, c'est une
//! rumeur.
//!
//! Invariants prouvés ici :
//! 1. **Ni perte ni duplication** : rejouer un fichier par pages, de tailles
//!    variables, rend exactement les lignes du fichier, une fois chacune, dans
//!    l'ordre.
//! 2. **L'offset ne dépasse jamais les octets consommés** (C02) : un offset
//!    posé au-delà du dernier cadre complet perdrait la ligne en cours.
//! 3. **Une queue incomplète est en attente, jamais rendue** : la page suivante
//!    la relit entière.
//! 4. **Le curseur est fidèle** : `decode(encode(…))` rend la même position, et
//!    un curseur d'une autre source ou d'une autre session est refusé.

use sessions::cursor::{decode, encode};
use sessions::storage::jsonl::identity::{CurseurFichier, identite_de};
use sessions::storage::jsonl::reader::page_avant;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static NONCE: AtomicU32 = AtomicU32::new(0);

/// Un générateur congruentiel minimal — déterministe, rejouable, sans
/// dépendance.
struct Hasard {
    etat: u64,
}

impl Hasard {
    fn nouveau(graine: u64) -> Self {
        Self {
            etat: graine
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1),
        }
    }

    fn suivant(&mut self) -> u64 {
        // Les constantes de Numerical Recipes : suffisant pour des tailles et
        // des coupures, et strictement reproductible.
        self.etat = self
            .etat
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.etat
    }

    /// Un entier dans `[min, max]` (bornes incluses).
    fn entre(&mut self, min: u64, max: u64) -> u64 {
        min + self.suivant() % (max - min + 1)
    }
}

fn racine(prefixe: &str) -> PathBuf {
    let chemin = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match fs::create_dir_all(&chemin) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    chemin
}

fn curseur_initial(fichier: &std::path::Path) -> CurseurFichier {
    match identite_de(fichier) {
        Ok(identite) => CurseurFichier {
            dev: identite.curseur.dev,
            ino: identite.curseur.ino,
            offset: 0,
        },
        Err(cause) => panic!("identité refusée : {cause}"),
    }
}

#[test]
fn aucune_page_ne_perd_ni_ne_duplique_une_ligne() {
    // Vingt fichiers, chacun écrit par tranches de tailles aléatoires (l'agent
    // coupe où il veut), relu après chaque tranche par pages de tailles
    // aléatoires. Les lignes observées doivent être, à tout instant, un
    // **préfixe exact** de ce qui a été écrit.
    for graine in 1..=20_u64 {
        let mut hasard = Hasard::nouveau(graine);
        let racine = racine("propriete-jsonl");
        let fichier = racine.join("session.jsonl");
        let attendues: Vec<String> = (0..40)
            .map(|indice| format!("{{\"n\":{indice},\"graine\":{graine}}}"))
            .collect();
        let complet = format!("{}\n", attendues.join("\n"));
        match fs::write(&fichier, "") {
            Ok(()) => (),
            Err(cause) => panic!("écriture refusée : {cause}"),
        }
        let mut curseur = curseur_initial(&fichier);
        let mut lues: Vec<String> = Vec::new();
        let mut ecrits = 0_usize;
        while ecrits < complet.len() {
            let pas = hasard.entre(1, 37) as usize;
            ecrits = (ecrits + pas).min(complet.len());
            match fs::write(&fichier, &complet[..ecrits]) {
                Ok(()) => (),
                Err(cause) => panic!("écriture refusée (graine {graine}) : {cause}"),
            }
            loop {
                let cible = hasard.entre(1, 45) as usize;
                let page = match page_avant(&fichier, &curseur, cible) {
                    Ok(page) => page,
                    Err(cause) => panic!("page refusée (graine {graine}) : {cause}"),
                };
                // ⚠️ C02 : l'offset ne dépasse jamais les octets consommés.
                let consomme: u64 = page.cadres.iter().map(|cadre| cadre.consomme).sum();
                assert!(
                    page.curseur.offset <= curseur.offset + consomme,
                    "graine {graine} : offset {} > consommé {}",
                    page.curseur.offset,
                    curseur.offset + consomme
                );
                for cadre in &page.cadres {
                    lues.push(cadre.brut.clone());
                }
                curseur = page.curseur;
                if page.a_rattrape || page.cadres.is_empty() {
                    break;
                }
            }
            // À tout instant, ce qui est lu est un préfixe exact de l'écrit :
            // ni ligne perdue, ni ligne en double, ni ligne inventée.
            assert_eq!(
                lues,
                attendues[..lues.len()].to_vec(),
                "graine {graine} : les lignes lues sont un préfixe exact"
            );
        }
        assert_eq!(
            lues, attendues,
            "graine {graine} : à la fin, toutes les lignes et seulement elles"
        );
        let _ = fs::remove_dir_all(&racine);
    }
}

#[test]
fn une_queue_incomplete_est_en_attente_puis_relue_entiere() {
    // Une queue sans saut de ligne n'est jamais rendue : elle est relue
    // complète une fois l'agent ayant fini d'écrire.
    let racine = racine("propriete-attente");
    let fichier = racine.join("session.jsonl");
    let complete = "{\"n\":1}\n";
    let partielle = "{\"n\":2,\"fin\":";
    match fs::write(&fichier, format!("{complete}{partielle}")) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let curseur = curseur_initial(&fichier);
    let page = match page_avant(&fichier, &curseur, 4096) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert_eq!(page.cadres.len(), 1, "la queue incomplète reste en attente");
    assert!(!page.a_rattrape, "le fichier n'est pas rattrapé");
    match fs::write(&fichier, format!("{complete}{partielle}\"x\"}}\n")) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let suite = match page_avant(&fichier, &page.curseur, 4096) {
        Ok(suite) => suite,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert_eq!(suite.cadres.len(), 1, "la ligne est relue une seule fois");
    assert_eq!(suite.cadres[0].brut, "{\"n\":2,\"fin\":\"x\"}");
    let _ = fs::remove_dir_all(&racine);
}

#[test]
fn le_curseur_ne_ment_jamais_sur_la_source_ni_sur_la_session() {
    let mut hasard = Hasard::nouveau(7);
    for _ in 0..200 {
        let position = hasard.entre(0, 1_000_000) as i64;
        let source = format!("src-{}", hasard.entre(0, 5));
        let session = format!("ses-{}", hasard.entre(0, 5));
        let encoded = encode(&source, &session, hasard.entre(0, 3), position);
        let decode_ = match decode(&encoded) {
            Ok(curseur) => curseur,
            Err(cause) => panic!("décodage refusé : {cause:?}"),
        };
        match decode_.lie_a(&source, &session) {
            Ok(lie) => assert_eq!(
                lie.position, position,
                "la position est rendue telle quelle"
            ),
            Err(cause) => panic!("le curseur de sa propre source est accepté : {cause:?}"),
        }
        // Une autre source ou une autre session ne peut pas se l'approprier.
        assert!(
            decode_.lie_a(&format!("{source}-autre"), &session).is_err(),
            "un curseur d'une autre source est refusé"
        );
        assert!(
            decode_.lie_a(&source, &format!("{session}-autre")).is_err(),
            "un curseur d'une autre session est refusé"
        );
    }
}

#[test]
fn un_curseur_altere_est_illisible_pas_devine() {
    // Un curseur forgé ne doit jamais être « réparé » en une position
    // arbitraire : il est refusé.
    let encoded = encode("source", "session", 1, 42);
    let mut octets = encoded.into_bytes();
    let dernier = match octets.pop() {
        Some(octet) => octet,
        None => panic!("un curseur vide n'existe pas"),
    };
    octets.push(if dernier == b'A' { b'B' } else { b'A' });
    let forge = match String::from_utf8(octets) {
        Ok(texte) => texte,
        Err(cause) => panic!("UTF-8 : {cause}"),
    };
    assert_ne!(forge, encode("source", "session", 1, 42));
    // Un base64 valide peut décoder un JSON inchangé : ce qui compte est que
    // la valeur rendue ne soit **jamais** une position inventée.
    let rejoue = decode(&forge)
        .ok()
        .and_then(|curseur| curseur.lie_a("source", "session").ok());
    assert!(
        rejoue.is_none() || rejoue.map(|lie| lie.position) == Some(42),
        "aucune position n'est inventée"
    );
}
