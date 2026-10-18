//! Le journal d'événements (T042, E04, C11) : bornes par nombre ET par
//! octets, identifiants `<boot>:<sequence>`, resync pour trou / éviction /
//! futur / boot étranger / curseur legacy — un seul resync, jamais deux.

use application::events::journal::{ErreurJournal, IdJournal, JOURNAL_OCTETS, Journal};
use std::sync::Arc;

fn journal_borne(evenements: usize, octets: usize, evenement: usize) -> Journal {
    Journal::avec_limites(evenements, octets, evenement)
}

fn publie(
    journal: &Journal,
    genre: &str,
    octets: usize,
) -> application::events::journal::EvenementJournal {
    journal
        .publie(genre, vec![b'x'; octets])
        .unwrap_or_else(|_| panic!("la publication doit réussir"))
}

#[test]
fn les_identifiants_sont_monotones_depuis_un() {
    // E04 : séquences monotones à partir de 1, un boot unique par journal.
    let journal = Journal::nouveau();
    let un = publie(&journal, "agent_status", 4);
    let deux = publie(&journal, "agent_status", 4);
    assert_eq!(un.id.sequence, 1);
    assert_eq!(deux.id.sequence, 2);
    assert_eq!(un.id.boot, journal.boot());
    assert_eq!(un.id.opaque(), format!("{}:1", journal.boot()));
    assert_eq!(
        journal
            .dernier_id()
            .unwrap_or_else(|| panic!("un dernier id")),
        deux.id
    );
}

#[test]
fn le_rattrapage_rend_exactement_ce_qui_manque() {
    // E05 : depuis un curseur, les événements strictement postérieurs, en
    // ordre, sans resync.
    let journal = Journal::nouveau();
    let un = publie(&journal, "a", 4);
    let _deux = publie(&journal, "b", 4);
    let trois = publie(&journal, "c", 4);
    let rattrapage = journal.depuis(&un.id.opaque());
    assert!(!rattrapage.resync_requis);
    let sequences: Vec<u64> = rattrapage
        .evenements
        .iter()
        .map(|e| e.id.sequence)
        .collect();
    assert_eq!(sequences, vec![2, 3]);
    assert_eq!(rattrapage.reprendre_de, trois.id);
    // Le curseur courant ne rejoue rien.
    let vide = journal.depuis(&trois.id.opaque());
    assert!(vide.evenements.is_empty());
    assert!(!vide.resync_requis);
}

#[test]
fn un_trou_ou_une_eviction_provoque_un_resync() {
    // E04/E05 : les plus anciens partent au-delà de la capacité — un curseur
    // dans le trou demande un resync, jamais une continuité inventée.
    let journal = journal_borne(3, JOURNAL_OCTETS, 1024);
    let un = publie(&journal, "a", 4);
    let _ = publie(&journal, "b", 4);
    let _ = publie(&journal, "c", 4);
    let _ = publie(&journal, "d", 4); // évince « un »
    let _ = publie(&journal, "e", 4); // évince « b »
    assert_eq!(journal.nb_evenements(), 3);
    // Le curseur « un » (1) est maintenant dans le trou (le plus ancien
    // retenu est 3) : resync.
    let trou = journal.depuis(&un.id.opaque());
    assert!(trou.resync_requis, "le curseur évincé demande un resync");
    // Le filtre reste honnête : ce qui est strictement après le curseur est
    // rendu — c'est le resync qui dit de recharger l'état d'abord (T053
    // décide de les envoyer ou non).
    let sequences: Vec<u64> = trou.evenements.iter().map(|e| e.id.sequence).collect();
    assert_eq!(sequences, vec![3, 4, 5]);
    // Le resync porte le curseur courant : repartir de là ne re-resync pas.
    let reprise = journal.depuis(&trou.reprendre_de.opaque());
    assert!(!reprise.resync_requis, "un seul resync, jamais deux (B04)");
    // Un curseur juste avant le plus ancien retenu rejoue tout ce qui reste
    // (continu, pas de resync).
    let bord = journal.depuis(
        &IdJournal {
            boot: String::from(journal.boot()),
            sequence: 2,
        }
        .opaque(),
    );
    assert!(!bord.resync_requis, "à la frontière, la continuité tient");
    assert_eq!(bord.evenements.len(), 3);
}

#[test]
fn l_eviction_par_octets_rompt_la_continuite_explicitement() {
    // C11 : la cardinalité ne borne pas la taille — le plafond d'octets
    // évince les anciens, et le resync le signale.
    let journal = journal_borne(100, 32, 1024);
    let un = publie(&journal, "a", 4);
    let _ = publie(&journal, "b", 20);
    let _ = publie(&journal, "c", 20); // 4+20+20 > 32 → évince « un » (et « b »)
    assert_eq!(journal.nb_evenements(), 1);
    assert_eq!(journal.octets(), 20);
    let trou = journal.depuis(&un.id.opaque());
    assert!(
        trou.resync_requis,
        "l'éviction par octets rompt la continuité"
    );
}

#[test]
fn un_curseur_futur_provoque_un_resync() {
    // C11 : une séquence indisponible (future) resynchronise.
    let journal = Journal::nouveau();
    let _ = publie(&journal, "a", 4);
    let futur = IdJournal {
        boot: String::from(journal.boot()),
        sequence: 999,
    };
    let rattrapage = journal.depuis(&futur.opaque());
    assert!(rattrapage.resync_requis, "un curseur futur resynchronise");
    assert!(rattrapage.evenements.is_empty());
}

#[test]
fn un_boot_etranger_provoque_un_resync() {
    // C11 : un curseur d'une autre époque ne peut pas être suivi.
    let journal = Journal::nouveau();
    let _ = publie(&journal, "a", 4);
    let etranger = IdJournal {
        boot: String::from("boot-ancien"),
        sequence: 1,
    };
    let rattrapage = journal.depuis(&etranger.opaque());
    assert!(rattrapage.resync_requis, "un boot étranger resynchronise");
    assert!(rattrapage.evenements.is_empty());
}

#[test]
fn un_curseur_legacy_numerique_provoque_un_resync() {
    // C11 : les anciens clients envoient un entier nu — un resync, puis la
    // reprise sur le curseur courant.
    let journal = Journal::nouveau();
    let _ = publie(&journal, "a", 4);
    let rattrapage = journal.depuis("42");
    assert!(rattrapage.resync_requis, "legacy numérique resynchronise");
    assert_eq!(
        rattrapage.reprendre_de,
        journal.dernier_id().unwrap_or_else(|| panic!("un id"))
    );
    assert!(
        IdJournal::depuis_opaque("42").is_none(),
        "42 n'est pas opaque"
    );
}

#[test]
fn un_curseur_absent_ne_rejoue_pas_l_historique() {
    // C11 : pas de Last-Event-ID → frontière courante après ready, sans
    // rejouer tout l'historique dans une nouvelle fenêtre.
    let journal = Journal::nouveau();
    let _ = publie(&journal, "a", 4);
    let _ = publie(&journal, "b", 4);
    let rattrapage = journal.depuis("");
    assert!(!rattrapage.resync_requis, "aucun resync sans curseur");
    assert!(rattrapage.evenements.is_empty(), "rien rejoué");
    assert_eq!(
        rattrapage.reprendre_de,
        journal.dernier_id().unwrap_or_else(|| panic!("un id")),
        "on repart de la frontière courante"
    );
}

#[test]
fn un_evenement_trop_gros_est_refuse_jamais_tronque() {
    // C11 : 256 KiB maximum — un dépassement est refusé, jamais coupé.
    let journal = journal_borne(10, JOURNAL_OCTETS, 256);
    let resultat = journal.publie("agent_status", vec![b'x'; 257]);
    assert!(
        matches!(resultat, Err(ErreurJournal::EvenementTropGros)),
        "le dépassement est refusé"
    );
    assert_eq!(journal.nb_evenements(), 0);
    assert_eq!(journal.octets(), 0);
    // Juste sous la limite : accepté.
    let accepte = journal.publie("agent_status", vec![b'x'; 256]);
    assert!(accepte.is_ok());
}

#[test]
fn la_borne_par_nombre_est_appliquee() {
    let journal = journal_borne(2, JOURNAL_OCTETS, 1024);
    let _un = publie(&journal, "a", 4);
    let _ = publie(&journal, "b", 4);
    let _ = publie(&journal, "c", 4);
    assert_eq!(journal.nb_evenements(), 2, "au plus 2 événements");
    // « un » (1) est évincé (le plus ancien retenu est 2) : le curseur 0,
    // qui a manqué l'événement 1, demande un resync.
    let trou = journal.depuis(
        &IdJournal {
            boot: String::from(journal.boot()),
            sequence: 0,
        }
        .opaque(),
    );
    assert!(trou.resync_requis);
}

#[test]
fn le_journal_vide_repond_avec_la_frontiere_zero() {
    let journal = Journal::nouveau();
    assert!(journal.dernier_id().is_none());
    let rattrapage = journal.depuis("");
    assert!(!rattrapage.resync_requis);
    assert_eq!(rattrapage.reprendre_de.sequence, 0);
    assert_eq!(rattrapage.reprendre_de.boot, journal.boot());
    assert_eq!(journal.prochaine_sequence(), 1);
}

#[test]
fn deux_journaux_ont_des_boots_distincts() {
    // E04 : chaque démarrage change d'époque — deux journaux ne se
    // confondent jamais.
    let premier = Journal::nouveau();
    let second = Journal::nouveau();
    assert_ne!(premier.boot(), second.boot());
}

#[test]
fn la_publication_est_une_seule_etape() {
    // E04 : l'attribution de l'identifiant et la rétention sont atomiques —
    // huit publicateurs concurrents, aucun trou, aucun doublon, la borne
    // respectée.
    let journal = Arc::new(Journal::nouveau());
    let porteurs: Vec<_> = (0..8)
        .map(|_| {
            let journal = Arc::clone(&journal);
            std::thread::spawn(move || {
                for _ in 0..100 {
                    let _ = journal.publie("agent_status", vec![b'x'; 8]);
                }
            })
        })
        .collect();
    for porteur in porteurs {
        porteur
            .join()
            .unwrap_or_else(|_| panic!("publicateur joint"));
    }
    assert_eq!(journal.nb_evenements(), 500, "800 publiés, 500 retenus");
    // Depuis la frontière zéro, les séquences retenues sont contiguës.
    let rattrapage = journal.depuis(
        &IdJournal {
            boot: String::from(journal.boot()),
            sequence: 0,
        }
        .opaque(),
    );
    let sequences: Vec<u64> = rattrapage
        .evenements
        .iter()
        .map(|e| e.id.sequence)
        .collect();
    let attendues: Vec<u64> = (sequences[0]..=sequences[sequences.len() - 1]).collect();
    assert_eq!(sequences, attendues, "aucun trou, aucun doublon");
}
